/**
 * Registers one released plugin in the marketplace by opening a pull request
 * from a local marketplace clone.
 *
 * Everything the PR needs is prepared here, under `dist/publish/<asset>/`:
 * the registry entry derived from the released archive (`publish/registry.ts`),
 * the PR body rendered from `publish/pr-body.md`, and `pr.json` with the
 * branch, title and labels. `--dry-run` stops after that so the result can be
 * reviewed before anything leaves the machine.
 *
 * The marketplace clone and the repositories involved come from `.env`
 * (see `.env.example`); the command line only says which plugin to publish.
 * The PR is created with the author's own `gh` login, so no cross-repository
 * token exists anywhere.
 *
 * Usage:
 *   deno task publish <plugin-dir> [--version x.y.z] [--dry-run] [--local-package]
 */
import { load as loadDotenv } from "jsr:@std/dotenv@0";
import { copy, ensureDir, exists } from "jsr:@std/fs@1";
import { fromFileUrl, join, resolve } from "jsr:@std/path@1";
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { parse as parseToml } from "jsr:@std/toml@1";
import {
  assetName,
  assetUrl,
  pluginDir,
  readIdentity,
  releaseTag,
  sha256File,
} from "./lib/plugin.ts";
import { packagePlugin } from "./package.ts";
import {
  deriveRegistryManifest,
  registryEntryPath,
} from "./publish/registry.ts";

const repoRoot = resolve(fromFileUrl(import.meta.url), "../..");

/** Machine-specific settings; defaults describe the official repositories. */
interface Settings {
  marketplaceDir: string;
  pushRemote: string;
  baseRemote: string;
  baseBranch: string;
  marketplaceRepo: string;
  releaseRepo: string;
}

/** Reads `.env`, falling back to defaults for everything but the clone path. */
async function loadSettings(): Promise<Settings> {
  const env = await loadDotenv({ envPath: join(repoRoot, ".env") });
  const marketplaceDir = env.MARKETPLACE_DIR;
  if (marketplaceDir === undefined) {
    throw new Error("MARKETPLACE_DIR is not set; copy .env.example to .env");
  }
  const pushRemote = env.MARKETPLACE_PUSH_REMOTE ?? "origin";
  return {
    marketplaceDir: resolve(marketplaceDir),
    pushRemote,
    baseRemote: env.MARKETPLACE_BASE_REMOTE ?? pushRemote,
    baseBranch: env.MARKETPLACE_BASE_BRANCH ?? "main",
    marketplaceRepo: env.MARKETPLACE_REPO ?? "ora-space/marketplace",
    releaseRepo: env.RELEASE_REPO ?? "ora-space/ui-plugins",
  };
}

/** Runs a command, returning trimmed stdout; throws with stderr on failure. */
async function run(
  command: string,
  args: string[],
  options: { cwd?: string; allowFailure?: boolean } = {},
): Promise<{ ok: boolean; stdout: string }> {
  const output = await new Deno.Command(command, {
    args,
    cwd: options.cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stdout = new TextDecoder().decode(output.stdout).trim();
  if (!output.success && !options.allowFailure) {
    const stderr = new TextDecoder().decode(output.stderr).trim();
    throw new Error(`${command} ${args.join(" ")} failed:\n${stderr}`);
  }
  return { ok: output.success, stdout };
}

/** `owner/repo` from an ssh or https GitHub remote URL. */
function repoFromRemoteUrl(url: string): string {
  const match = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  if (match === null) throw new Error(`not a GitHub remote: ${url}`);
  return match[1];
}

/** Mustache-style `{{key}}` substitution for the PR body template. */
function render(template: string, values: Record<string, string>): string {
  return template.replaceAll(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`template: no value for ${key}`);
    return value;
  });
}

const args = parseArgs(Deno.args, {
  string: ["version"],
  boolean: ["dry-run", "local-package"],
  default: { "dry-run": false, "local-package": false },
});
const dir = args._[0];
if (typeof dir !== "string") {
  console.error(
    "usage: deno task publish <plugin-dir> [--version x.y.z] [--dry-run] [--local-package]",
  );
  Deno.exit(2);
}
if (args["local-package"] && !args["dry-run"]) {
  // A local build is not what users will download, so it can only ever be rehearsed.
  throw new Error("--local-package requires --dry-run");
}

const settings = await loadSettings();
const source = pluginDir(repoRoot, dir);
const identity = await readIdentity(source);
const version = args.version ?? identity.version;
const tag = releaseTag(dir, version);
const asset = assetName({ ...identity, version });
const url = assetUrl(settings.releaseRepo, tag, asset);
const releaseUrl =
  `https://github.com/${settings.releaseRepo}/releases/tag/${tag}`;
const workDir = join(repoRoot, "dist", "publish", asset.replace(/\.orax$/, ""));
await Deno.remove(workDir, { recursive: true }).catch(() => {});
await ensureDir(workDir);
const archive = join(workDir, "package.orax");

// 1–2. Obtain the archive: the released asset, or a fresh local build for a rehearsal.
if (args["local-package"]) {
  const built = await packagePlugin({ dir, out: "dist", checkOnly: false });
  if (built === undefined) throw new Error("packaging produced nothing");
  await copy(built.archive, archive, { overwrite: true });
} else {
  const tags = await run("git", ["ls-remote", "--tags", "origin", tag], {
    cwd: repoRoot,
  });
  if (tags.stdout === "") {
    throw new Error(
      `tag ${tag} is not on origin; push the tag and wait for the release`,
    );
  }
  await run("gh", [
    "release",
    "download",
    tag,
    "--repo",
    settings.releaseRepo,
    "--pattern",
    asset,
    "--pattern",
    `${asset}.sha256`,
    "--dir",
    workDir,
  ]);
  await Deno.rename(join(workDir, asset), archive);
  const published = (await Deno.readTextFile(join(workDir, `${asset}.sha256`)))
    .split(/\s+/)[0];
  if (published !== await sha256File(archive)) {
    throw new Error("downloaded asset does not match its published .sha256");
  }
}
const sha256 = await sha256File(archive);

// 3. Derive the registry entry from what is inside the archive.
const unpacked = join(workDir, "package");
await run("unzip", ["-o", "-q", archive, "-d", unpacked]);
const packageManifest = await Deno.readTextFile(join(unpacked, "orax.toml"));
const packaged = parseToml(packageManifest) as {
  name?: unknown;
  version?: unknown;
};
if (packaged.name !== identity.name || packaged.version !== version) {
  throw new Error(
    `archive manifest is ${packaged.name} ${packaged.version}, expected ${identity.name} ${version}`,
  );
}
const entryPath = registryEntryPath(identity.name);
const entryDir = join(workDir, entryPath.join("/"));
await ensureDir(entryDir);
await Deno.writeTextFile(
  join(entryDir, "orax.toml"),
  deriveRegistryManifest(packageManifest, { url, sha256 }),
);
for (const file of ["README.md", "logo.svg"]) {
  if (await exists(join(unpacked, file), { isFile: true })) {
    await copy(join(unpacked, file), join(entryDir, file));
  }
}

// 4. PR materials. The previous version is read from the marketplace base branch.
const branch = `release/${identity.name}-v${version}`;
const title = `feat(registry): publish ${identity.name} v${version}`;
const marketplace = settings.marketplaceDir;
if (!(await exists(join(marketplace, ".git")))) {
  throw new Error(`${marketplace} is not a git clone`);
}
const remoteUrl =
  (await run("git", ["remote", "get-url", settings.pushRemote], {
    cwd: marketplace,
  })).stdout;
const headOwner = repoFromRemoteUrl(remoteUrl).split("/")[0];
await run(
  "git",
  ["fetch", "--quiet", settings.baseRemote, settings.baseBranch],
  {
    cwd: marketplace,
  },
);
const base = `${settings.baseRemote}/${settings.baseBranch}`;
const previous = await run(
  "git",
  ["show", `${base}:${[...entryPath, "orax.toml"].join("/")}`],
  { cwd: marketplace, allowFailure: true },
);
const previousVersion = previous.ok
  ? (parseToml(previous.stdout) as { version?: unknown }).version
  : undefined;
const change = previousVersion === undefined
  ? "Add"
  : previousVersion === version
  ? "Update"
  : `Upgrade ${previousVersion} → `;
const readme = await Deno.readTextFile(join(unpacked, "README.md")).catch(() =>
  ""
);
const body = render(
  await Deno.readTextFile(join(repoRoot, "scripts", "publish", "pr-body.md")),
  {
    change,
    name: identity.name,
    version,
    kind: identity.kind,
    release_repo: settings.releaseRepo,
    tag,
    release_url: releaseUrl,
    asset,
    url,
    sha256,
    entry_path: entryPath.join("/"),
    readme_excerpt: readme.split("\n").slice(0, 20).join("\n"),
  },
);
await Deno.writeTextFile(join(workDir, "pr-body.md"), body);
await Deno.writeTextFile(
  join(workDir, "pr.json"),
  JSON.stringify(
    {
      repo: settings.marketplaceRepo,
      base: settings.baseBranch,
      head: `${headOwner}:${branch}`,
      branch,
      title,
      labels: ["plugin-release", `kind:${identity.kind}`],
    },
    null,
    2,
  ) + "\n",
);
console.log(`prepared ${workDir}`);
if (args["dry-run"]) Deno.exit(0);

// 5. Commit the entry on a branch of the marketplace clone.
const dirty =
  (await run("git", ["status", "--porcelain"], { cwd: marketplace })).stdout;
if (dirty !== "") throw new Error(`${marketplace} has uncommitted changes`);
const originalBranch =
  (await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: marketplace,
  })).stdout;
try {
  // `-C` resets an existing branch onto the base so a rerun is idempotent.
  await run("git", ["switch", "--quiet", "-C", branch, base], {
    cwd: marketplace,
  });
  const target = join(marketplace, entryPath.join("/"));
  await Deno.remove(target, { recursive: true }).catch(() => {});
  await copy(entryDir, target);
  await run("git", ["add", "-A", "--", entryPath.join("/")], {
    cwd: marketplace,
  });
  const staged = await run("git", ["diff", "--cached", "--quiet"], {
    cwd: marketplace,
    allowFailure: true,
  });
  if (staged.ok) {
    // Not `Deno.exit`: that would skip the `finally` restoring the branch.
    console.log(
      `${identity.name} v${version} is already registered on ${base}`,
    );
  } else {
    await registerBranch();
  }
} finally {
  await run("git", ["switch", "--quiet", originalBranch], { cwd: marketplace });
}

/** Commits the entry, pushes the branch and creates or refreshes the PR. */
async function registerBranch(): Promise<void> {
  await run("git", ["commit", "--quiet", "-m", title], { cwd: marketplace });
  // The lease is checked against the tracking ref, which may be stale after
  // the previous PR's branch was deleted on the remote; refresh it first.
  await run("git", ["fetch", "--quiet", "--prune", settings.pushRemote], {
    cwd: marketplace,
  });
  await run("git", [
    "push",
    "--quiet",
    "--force-with-lease",
    "-u",
    settings.pushRemote,
    branch,
  ], {
    cwd: marketplace,
  });

  // 6. Create or refresh the PR.
  const existing = (await run("gh", [
    "pr",
    "list",
    "--repo",
    settings.marketplaceRepo,
    "--head",
    branch,
    "--state",
    "open",
    "--json",
    "number,url",
    "--jq",
    '.[0] | "\\(.number) \\(.url)"',
  ], { cwd: marketplace })).stdout;
  const bodyFile = join(workDir, "pr-body.md");
  if (existing === "") {
    const created = await run("gh", [
      "pr",
      "create",
      "--repo",
      settings.marketplaceRepo,
      "--base",
      settings.baseBranch,
      "--head",
      `${headOwner}:${branch}`,
      "--title",
      title,
      "--body-file",
      bodyFile,
    ], { cwd: marketplace });
    console.log(`created ${created.stdout}`);
  } else {
    // `gh pr edit` queries a deprecated GraphQL field on gh 2.46 and fails;
    // the REST endpoint updates title and body without that dependency.
    const [number, prUrl] = existing.split(" ");
    await run("gh", [
      "api",
      "--method",
      "PATCH",
      `repos/${settings.marketplaceRepo}/pulls/${number}`,
      "-f",
      `title=${title}`,
      "-F",
      `body=@${bodyFile}`,
    ], { cwd: marketplace });
    console.log(`updated ${prUrl}`);
  }
}
