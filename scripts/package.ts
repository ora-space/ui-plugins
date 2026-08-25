/**
 * Packages one plugin into the `.orax` archive that the release workflow
 * uploads and the marketplace links to.
 *
 * The archive root is flat: Ora loads `orax.toml` and the fixed entrypoint
 * `main.js` from the root, with the page under `assets/`. The file set comes
 * from `lib/plugin.ts`, shared with the local installer.
 *
 * Checks performed before anything is built (also run by CI as `--check`):
 * - the directory name is a valid tag prefix,
 * - `--expect-version` (the tag's version) equals the manifest version,
 * - workbench `deno.json` / `package.json` versions agree with the manifest,
 * - webview plugins ship no `main.js` / `src/`.
 *
 * Usage:
 *   deno task package <plugin-dir> [--out dist] [--expect-version 1.2.3] [--check]
 */
import { ensureDir } from "jsr:@std/fs@1";
import { fromFileUrl, join, resolve } from "jsr:@std/path@1";
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import {
  assetName,
  build,
  installableSet,
  isRunnable,
  pluginDir,
  readIdentity,
  sha256File,
} from "./lib/plugin.ts";

const repoRoot = resolve(fromFileUrl(import.meta.url), "../..");

/** Asserts the auxiliary version fields of a workbench plugin match the manifest. */
async function checkAuxiliaryVersions(
  source: string,
  version: string,
): Promise<void> {
  for (const file of ["deno.json", "package.json"]) {
    const path = join(source, file);
    try {
      const parsed = JSON.parse(await Deno.readTextFile(path));
      if (parsed.version !== undefined && parsed.version !== version) {
        throw new Error(
          `${path}: version ${parsed.version} differs from orax.toml ${version}`,
        );
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
}

/** Validates, optionally builds, and zips one plugin; returns the archive path. */
export async function packagePlugin(options: {
  dir: string;
  out: string;
  expectVersion?: string;
  checkOnly: boolean;
}): Promise<{ archive: string; sha256: string } | undefined> {
  const source = pluginDir(repoRoot, options.dir);
  const identity = await readIdentity(source);
  if (
    options.expectVersion !== undefined &&
    options.expectVersion !== identity.version
  ) {
    throw new Error(
      `tag version ${options.expectVersion} differs from orax.toml version ${identity.version}`,
    );
  }
  if (isRunnable(identity.kind)) {
    await checkAuxiliaryVersions(source, identity.version);
  }
  // A check must not depend on build output, so the runnable set is only
  // enumerated after the build in the real run.
  if (options.checkOnly) {
    if (!isRunnable(identity.kind)) await installableSet(source, identity.kind);
    console.log(
      `ok ${identity.identifier} v${identity.version} (${identity.kind})`,
    );
    return undefined;
  }
  if (isRunnable(identity.kind)) await build(source);
  const { files, directories } = await installableSet(source, identity.kind);

  const outDir = resolve(repoRoot, options.out);
  await ensureDir(outDir);
  const archive = join(outDir, assetName(identity));
  await Deno.remove(archive).catch(() => {});
  // `-X` drops platform extra fields so the same tree zips to the same bytes.
  const zip = await new Deno.Command("zip", {
    args: ["-X", "-r", archive, ...files, ...directories],
    cwd: source,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!zip.success) throw new Error(`zip failed for ${source}`);
  const sha256 = await sha256File(archive);
  await Deno.writeTextFile(
    `${archive}.sha256`,
    `${sha256}  ${assetName(identity)}\n`,
  );
  console.log(`packaged ${archive} sha256=${sha256}`);
  return { archive, sha256 };
}

if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    string: ["out", "expect-version"],
    boolean: ["check"],
    default: { out: "dist", check: false },
  });
  const dir = args._[0];
  if (typeof dir !== "string") {
    console.error(
      "usage: deno task package <plugin-dir> [--out dist] [--expect-version x.y.z] [--check]",
    );
    Deno.exit(2);
  }
  await packagePlugin({
    dir,
    out: args.out,
    expectVersion: args["expect-version"],
    checkOnly: args.check,
  });
}
