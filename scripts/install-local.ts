/**
 * Installs plugins of this workspace into an Ora data directory for local
 * end-to-end testing.
 *
 * Ora discovers plugins at
 * `<data-dir>/plugins/installed/<namespace>/<name>/<version>/orax.toml`; the
 * version directory must agree with the manifest version. Discovery ignores
 * symlinked package directories and requires `orax.toml` to be a regular
 * file, so the deployment is always a real copy of the installable set. That
 * set is defined once in `lib/plugin.ts` and shared with `package.ts`, so a
 * local install always contains exactly what a release archive contains.
 *
 * Re-run the task after a rebuild or a page edit. Ora never passes a data
 * directory to the plugin; storage goes through `ora/storage/*`, so nothing
 * here is exported to the process.
 *
 * Usage:
 *   deno task install <plugin-dir-name>... <ora-data-dir>
 */
import { copy, ensureDir } from "jsr:@std/fs@1";
import { fromFileUrl, join, resolve } from "jsr:@std/path@1";
import {
  build,
  installableSet,
  isRunnable,
  pluginDir,
  readIdentity,
} from "./lib/plugin.ts";

const repoRoot = resolve(fromFileUrl(import.meta.url), "../..");
const args = [...Deno.args];
const dataDir = args.pop();
if (dataDir === undefined || args.length === 0) {
  console.error("usage: deno task install <plugin>... <ora-data-dir>");
  Deno.exit(2);
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
  const source = pluginDir(repoRoot, plugin);
  const identity = await readIdentity(source);
  if (isRunnable(identity.kind)) await build(source);
  const { files, directories } = await installableSet(source, identity.kind);

  // One version per plugin locally: clear every version under the package
  // name so a bumped manifest never leaves a stale higher version behind.
  const packageDir = join(
    resolve(dataDir),
    "plugins",
    "installed",
    identity.namespace,
    identity.name,
  );
  const target = join(packageDir, identity.version);
  await clearPackageDir(packageDir);
  await ensureDir(target);
  for (const entry of [...files, ...directories]) {
    await copy(join(source, entry), join(target, entry));
  }
  console.log(`installed ${identity.name} from ${source} into ${target}`);
}
