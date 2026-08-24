/**
 * Installs plugins of this workspace into an Ora data directory for local
 * end-to-end testing.
 *
 * Ora discovers plugins at
 * `<data-dir>/plugins/installed/<namespace>/<name>/<version>/orax.toml`; the
 * version directory must agree with the manifest version. Discovery ignores
 * symlinked package directories and requires `orax.toml` to be a regular
 * file, so the deployment is always a real copy of the installable set. What that set is
 * follows the manifest `kind`:
 *
 * - `workbench`: the bundled `main.js` (fixed entrypoint name; built here)
 *   and the page under `assets/`, plus `orax.toml`, `logo.svg`, `README.md`.
 * - `webview`: configuration only — `orax.toml`, `logo.svg`, `README.md`.
 *   Ora rejects a webview package that ships `main.js`, so nothing is built.
 *
 * Re-run the task after a rebuild or a page edit. Ora never passes a data
 * directory to the plugin; storage goes through `ora/storage/*`, so nothing
 * here is exported to the process.
 *
 * Usage:
 *   deno task install <plugin-dir-name>... <ora-data-dir>
 */
import { copy, ensureDir, exists } from "jsr:@std/fs@1";
import { join, resolve } from "jsr:@std/path@1";
import { parse as parseToml } from "jsr:@std/toml@1";

const args = [...Deno.args];
const dataDir = args.pop();
if (dataDir === undefined || args.length === 0) {
  console.error("usage: deno task install <plugin>... <ora-data-dir>");
  Deno.exit(2);
}

/** Files copied verbatim from the package root when present. */
const OPTIONAL_FILES = ["logo.svg", "README.md"];

/** Reads the manifest fields that decide the installed path and the file set. */
async function readManifest(
  source: string,
): Promise<{ name: string; namespace: string; version: string; kind: string }> {
  const manifest = parseToml(
    await Deno.readTextFile(join(source, "orax.toml")),
  ) as {
    name?: unknown;
    namespace?: unknown;
    version?: unknown;
    kind?: unknown;
  };
  for (const field of ["name", "namespace", "version", "kind"] as const) {
    if (typeof manifest[field] !== "string") {
      throw new Error(`${source}/orax.toml: missing string field ${field}`);
    }
  }
  return {
    name: manifest.name as string,
    namespace: manifest.namespace as string,
    version: manifest.version as string,
    kind: manifest.kind as string,
  };
}

/** Runs the plugin's `build` task so `main.js` exists before discovery runs. */
async function build(source: string): Promise<void> {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["task", "build"],
    cwd: source,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!result.success) {
    throw new Error(`build failed in ${source}`);
  }
}

/** Removes whatever currently occupies the package slot, symlink or tree. */
async function clearPackageDir(target: string): Promise<void> {
  try {
    const info = await Deno.lstat(target);
    await Deno.remove(target, { recursive: info.isDirectory });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

for (const plugin of args) {
  const source = resolve("plugins", plugin);
  const { name, namespace, version, kind } = await readManifest(source);
  // A webview plugin is configuration only; Ora rejects one that looks
  // runnable, so nothing is built or copied beyond the config set.
  const runnable = kind !== "webview";
  if (runnable) {
    await build(source);
    if (!(await exists(join(source, "main.js"), { isFile: true }))) {
      throw new Error(`${join(source, "main.js")} does not exist after build`);
    }
  }

  // One version per plugin locally: clear every version under the package
  // name so a bumped manifest never leaves a stale higher version behind.
  const packageDir = join(
    resolve(dataDir),
    "plugins",
    "installed",
    namespace,
    name,
  );
  const target = join(packageDir, version);
  await clearPackageDir(packageDir);
  await ensureDir(target);
  await copy(join(source, "orax.toml"), join(target, "orax.toml"));
  if (runnable) {
    await copy(join(source, "main.js"), join(target, "main.js"));
  }
  for (const file of OPTIONAL_FILES) {
    if (await exists(join(source, file))) {
      await copy(join(source, file), join(target, file));
    }
  }
  // Only workbench plugins ship a page; webview plugins have nothing to serve.
  if (await exists(join(source, "assets"))) {
    await copy(join(source, "assets"), join(target, "assets"));
  }
  console.log(`installed ${name} from ${source} into ${target}`);
}
