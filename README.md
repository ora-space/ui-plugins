# ui-plugins

Ora **UI plugins**, kept together in one repository because they share a test
harness. Two kinds exist:

- a **webview** plugin (`kind = "webview"`) embeds an external HTTPS site inside
  an isolated Ora webview. It is configuration only — no process, no entrypoint
  — and its manifest declares the start URL, the exact allowed origins, and what
  the host does with files the site downloads (prompt the user to import as
  skill / save as, run an automatic action, or reject).
- a **workbench** plugin (`kind = "workbench"`) ships its own page inside the
  package and runs its logic in a Deno process managed by Ora's plugin runtime.
  The page calls the process through `window.ora.invoke(method,
  params)`,
  restricted to the method allowlist in the manifest.

Either kind is shown inside Ora, embedded as a side panel or popped out into its
own window.

## Layout

```
deno.json                         Deno workspace, shared import map, repository-wide tasks
.github/workflows/ci.yml          fmt / lint / script tests / package --check of every plugin
.github/workflows/release.yml     tag <plugin>/v* → builds that plugin's .orax → GitHub Release
scripts/lib/plugin.ts             manifest reading, installable file set, asset naming (one copy)
scripts/package.ts                deno task package: validates and zips one plugin into dist/
scripts/publish.ts                deno task publish: opens the marketplace registration PR
scripts/publish/registry.ts       derives the marketplace orax.toml from the packaged manifest
scripts/publish/pr-body.md        marketplace PR description template
scripts/install-local.ts          deno task install: deploys into an Ora data directory
packages/ui-plugin-testing/       @ora-space/ui-plugin-testing (workspace member, not on JSR)
  mod.ts                          public re-exports
  host-driver.ts                  WorkbenchHostDriver: launch / invoke / storage / shutdown
  storage.ts                      FakeStorage: in-memory ora/storage/* served to the plugin
  frames.ts                       host-side frame codec (independent of the SDK)
  tests/*.test.ts                 unit tests for the fake storage and the codec
plugins/
  skillhub/                       official/ora-space.skillhub       webview: https://www.skillhub.cn
  huawei-agent-center/            official/ora-space.huawei-agent-center
                                  webview: https://ai.edevops.huawei.com/mcp/projects
  hello-panel/                    official/ora-space.hello-panel    workbench sample: assets/ page +
                                  counter in the process
```

A webview plugin package is `orax.toml`, `logo.svg` and `README.md` — nothing
else; it must not ship `main.js`. A workbench plugin additionally ships
`src/main.ts` (bundled by `deno task build` into `main.js` at the package root,
gitignored; Ora loads exactly that file — the entrypoint name is fixed, there is
no `main` field) and its page under `assets/` with the fixed entry
`assets/index.html` (external JS/CSS only; the host's CSP forbids inline code).
`package.json` holds npm metadata only; Ora does not read it.

## Runtime and SDK

Workbench plugins are built directly on `@ora-space/plugin-sdk`:

- `defineWorkbenchPlugin({ methods })` registers exactly the given methods. The
  host wraps each page call in the envelope
  `{ surface: { instance_id, generation }, input }`, which the SDK unpacks into
  `WorkbenchCall { surface: { instanceId, generation }, input }`. The effective
  callable set is the manifest `[workbench].methods` intersected with this
  registration. The v1 contract has no plugin-to-page channel: a process only
  answers calls.
- `ui.storage` (`createStorage`) reads and writes the plugin's private data
  directory through `ora/storage/*` using logical paths.

Ora launches a workbench plugin on demand (first bridge call) with `cwd` =
package root, `--no-prompt` and **no permissions**: no filesystem, no
environment, no network. The plugin never learns where its data directory is;
everything goes through the SDK. The simulator launches the plugin the same way
and serves its `ora/storage/*` requests from a `FakeStorage`.

A webview plugin has no process at all: navigation, downloads, and the
user-facing download actions (skill import, save as) are owned by the host.

### SDK resolution

`@ora-space/plugin-sdk` is mapped in the root `deno.json` import map to
`jsr:@ora-space/plugin-sdk@^0.2.0`. `minimumDependencyAge` stays 0 so freshly
published versions resolve. The committed configuration never references a local
path.

Until the workbench SDK is on jsr, point the import at a local checkout via
`deno.local.json`: copy `deno.json`'s `workspace` and `compilerOptions` into an
untracked `deno.local.json` (it is gitignored) whose `imports` maps
`@ora-space/plugin-sdk` to `<desktop>/packages/plugin-sdk/src/mod.ts`, then run
every task with

```
export ORA_DENO_FLAGS="--config $PWD/deno.local.json"
deno task check && deno task test
```

`ORA_DENO_FLAGS` is spliced into each `deno check` / `deno run` / `deno bundle`
the tasks invoke, and `WorkbenchHostDriver` forwards it to the plugin child it
spawns, because neither `deno task` nor `--config` propagates to nested
processes. Leave the variable unset to resolve the SDK from jsr (what CI does).

## Contract (workbench)

| Direction     | Type    | Method                                 | Handled by                                   |
| ------------- | ------- | -------------------------------------- | -------------------------------------------- |
| host → plugin | request | `<method>` from `[workbench].methods`  | the matching `defineWorkbenchPlugin` handler |
| plugin → host | request | `ora/storage/{list,read,write,remove}` | `ui.storage.*`                               |

Inside a workbench page, Ora injects `window.ora`: `ora.invoke(method, params?)`
resolves with the plugin's result and rejects with `{ kind: "host", code }` for
host conditions (unknown method, payload too large, plugin unavailable, stale
instance after a process restart) or `{ kind: "plugin", code, message }` for a
`PluginMethodError` thrown by the handler.

## Manifests

```toml
# workbench (hello-panel)
resolver = 1
title = "Hello Panel"
identifier = "ora-space.hello-panel"
namespace = "official"
kind = "workbench"
version = "0.1.0"
description = "…"

[workbench]
methods = ["counter/get", "counter/increment"]
```

```toml
# webview (skillhub)
resolver = 1
title = "SkillHub"
identifier = "ora-space.skillhub"
namespace = "official"
kind = "webview"
version = "0.1.0"
description = "…"

[webview]
start_url = "https://www.skillhub.cn"
allowed_origins = ["https://www.skillhub.cn", "https://skillhub.cn"]

[webview.downloads]
fallback = { reject = true }

[[webview.downloads.rules]]
page = { origin = "https://www.skillhub.cn", path_prefix = "/" }
action = { prompt = ["import_skill", "save_as"] }
```

The icon is the fixed file `logo.svg` at the package root; it is not referenced
from the manifest.

## Local install

```
deno task install skillhub huawei-agent-center hello-panel ~/.ora
```

builds each workbench plugin, then copies the installable set into
`<data-dir>/plugins/installed/<namespace>/<identifier>/<version>/` (the version
directory must agree with the manifest). Ora discovers plugins there (symlinked
package directories are ignored, so the deployment is always a real copy).
Re-run the task after a rebuild or a page edit.

## Releasing to the marketplace

Only this repository is involved; the marketplace is a plain Git target.

1. Bump `version` in `plugins/<dir>/orax.toml` (workbench plugins: also
   `deno.json` and `package.json`), update the README (it is shown in the
   marketplace verbatim), merge to `main`.
2. Tag the merge commit `<dir>/v<version>` (for example `skillhub/v0.1.0`) and
   push the tag. `release.yml` validates that the tag version equals the
   manifest version, packages the plugin with `scripts/package.ts` and creates
   the GitHub Release with `<identifier>-v<version>.orax` and its `.sha256`. A
   pre-release version (`v0.2.0-beta.1`) is published as a pre-release and never
   registered.
3. Copy `.env.example` to `.env` (`MARKETPLACE_DIR` is a local clone of the
   marketplace repository; the other values only change when rehearsing against
   forks) and run

   ```
   deno task publish <dir> [--dry-run]
   ```

   The script downloads the released asset, checks its digest against the
   published `.sha256`, derives
   `registry/<n>/<identifier>/{orax.toml,README.md,logo.svg}` from the files
   **inside** the archive, renders the PR body, and writes all of it to
   `dist/publish/<identifier>-v<version>/` (`--dry-run` stops here). It then
   creates or resets the branch `release/<identifier>-v<version>` on the clone,
   commits the entry, pushes with `--force-with-lease`, and opens the pull
   request with your own `gh` login — or updates it when it already exists.
   Re-running for the same version is idempotent.

The registry manifest is the packaged `orax.toml` plus `resolver`, `url` and
`sha256` and nothing else, because Ora parses it with `deny_unknown_fields`;
never edit an entry by hand. A manifest identifies a plugin by `title` (display
name) plus `identifier` (the id); there is no `name` field.
`--local-package --dry-run` rehearses with a local build before the Release
exists.
