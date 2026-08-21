/**
 * Installs one plugin of this workspace into an Ora data directory for local
 * end-to-end testing.
 *
 * Ora discovers plugins as real directories below `<data-dir>/plugins/` and
 * never follows symlinks, and a checkout cannot be copied as-is because the
 * bare `@ora-space/ui-plugin-base` import only resolves inside this workspace.
 * So this mirrors what a released `.orax` contains: the bundled `dist/main.js`,
 * the `ui/` page of a panel plugin, the logo and README, plus a `package.json`
 * whose `ora.main` points at the bundle. Usage:
 *   deno task install <plugin-dir-name> <ora-data-dir>
 */
import { copy, emptyDir, exists } from "jsr:@std/fs@1";
import { join, resolve } from "jsr:@std/path@1";

const [plugin, dataDir] = Deno.args;
if (plugin === undefined || dataDir === undefined) {
  console.error("usage: deno task install <plugin> <ora-data-dir>");
  Deno.exit(2);
}
const source = resolve("plugins", plugin);
const manifest = JSON.parse(
  await Deno.readTextFile(join(source, "package.json")),
);
const target = resolve(dataDir, "plugins", plugin);

const build = await new Deno.Command(Deno.execPath(), {
  args: ["task", "build"],
  cwd: source,
  stdout: "inherit",
  stderr: "inherit",
}).output();
if (!build.success) {
  Deno.exit(build.code);
}

await emptyDir(target);
await Deno.mkdir(join(target, "dist"));
await copy(join(source, "dist", "main.js"), join(target, "dist", "main.js"));
for (const file of ["logo.svg", "README.md", "orax.toml"]) {
  if (await exists(join(source, file))) {
    await copy(join(source, file), join(target, file));
  }
}
// Only panel plugins ship a page; remote-site plugins have nothing to serve.
if (await exists(join(source, "ui"))) {
  await copy(join(source, "ui"), join(target, "ui"));
}
manifest.ora.main = "./dist/main.js";
await Deno.writeTextFile(
  join(target, "package.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(`installed ${manifest.ora.id} into ${target}`);
