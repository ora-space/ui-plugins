/**
 * Shared knowledge about what a plugin package is: how its manifest is read,
 * which files belong to the installable set, and how the release artifacts
 * are named. `package.ts`, `install-local.ts` and `publish.ts` all consume
 * this module so the file set and naming rules exist exactly once.
 */
import { exists } from "jsr:@std/fs@1";
import { join, resolve } from "jsr:@std/path@1";
import { parse as parseToml } from "jsr:@std/toml@1";

/** Manifest fields that decide packaging, installation and registration. */
export interface PluginIdentity {
  /** Human-readable display name. */
  title: string;
  /** Complete plugin id, e.g. `ora-space.skillhub`; names install paths and assets. */
  identifier: string;
  namespace: string;
  version: string;
  kind: string;
}

/** The plugin directory name is the tag prefix; `plugins/<dir>/v<version>`. */
export const PLUGIN_DIR_PATTERN = /^[a-z0-9-]+$/;

/** Reads the identity fields from `<source>/orax.toml`, failing on any gap. */
export async function readIdentity(source: string): Promise<PluginIdentity> {
  const manifest = parseToml(
    await Deno.readTextFile(join(source, "orax.toml")),
  ) as Record<string, unknown>;
  for (
    const field of [
      "title",
      "identifier",
      "namespace",
      "version",
      "kind",
    ] as const
  ) {
    if (typeof manifest[field] !== "string") {
      throw new Error(`${source}/orax.toml: missing string field ${field}`);
    }
  }
  return {
    title: manifest.title as string,
    identifier: manifest.identifier as string,
    namespace: manifest.namespace as string,
    version: manifest.version as string,
    kind: manifest.kind as string,
  };
}

/** Resolves `plugins/<dir>` relative to the repository root of this script. */
export function pluginDir(repoRoot: string, dir: string): string {
  if (!PLUGIN_DIR_PATTERN.test(dir)) {
    throw new Error(`invalid plugin directory name: ${dir}`);
  }
  return resolve(repoRoot, "plugins", dir);
}

/** A webview plugin is configuration only; anything runnable is rejected by Ora. */
export function isRunnable(kind: string): boolean {
  return kind !== "webview";
}

/** Package root files copied verbatim when present. */
const OPTIONAL_FILES = ["logo.svg", "README.md"];

/**
 * Lists the installable set of a plugin as paths relative to the package
 * root, in deterministic order. `assets/` is returned as a directory entry
 * so callers can copy or zip it recursively.
 */
export async function installableSet(
  source: string,
  kind: string,
): Promise<{ files: string[]; directories: string[] }> {
  const files = ["orax.toml"];
  if (isRunnable(kind)) {
    if (!(await exists(join(source, "main.js"), { isFile: true }))) {
      throw new Error(`${join(source, "main.js")} does not exist; build first`);
    }
    files.push("main.js");
  } else {
    // Ora refuses a webview package that ships an entrypoint, so refuse to
    // package one instead of silently dropping the file.
    for (const forbidden of ["main.js", "src"]) {
      if (await exists(join(source, forbidden))) {
        throw new Error(
          `${source}: webview plugins must not contain ${forbidden}`,
        );
      }
    }
  }
  for (const file of OPTIONAL_FILES) {
    if (await exists(join(source, file), { isFile: true })) files.push(file);
  }
  const directories: string[] = [];
  if (isRunnable(kind) && (await exists(join(source, "assets")))) {
    directories.push("assets");
  }
  return { files, directories };
}

/** Runs the plugin's `build` task so `main.js` exists before packaging. */
export async function build(source: string): Promise<void> {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["task", "build"],
    cwd: source,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!result.success) throw new Error(`build failed in ${source}`);
}

/** Release asset name: `<identifier>-v<version>.orax`. */
export function assetName(identity: PluginIdentity): string {
  return `${identity.identifier}-v${identity.version}.orax`;
}

/** Release tag: `<plugin dir>/v<version>`. */
export function releaseTag(dir: string, version: string): string {
  return `${dir}/v${version}`;
}

/** Download URL of a release asset on GitHub. */
export function assetUrl(
  repo: string,
  tag: string,
  asset: string,
): string {
  return `https://github.com/${repo}/releases/download/${tag}/${asset}`;
}

/** Hex SHA-256 of a file. */
export async function sha256File(path: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await Deno.readFile(path),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
