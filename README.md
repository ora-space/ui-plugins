# ui-plugins

Ora **UI plugins** (`kind: "ui"`), kept together in one repository because they
share a common base package. Each plugin contributes a Surface — either a remote
site or a page shipped inside the package (a _panel_) — shown inside Ora,
embedded as a side panel or popped out into its own window, and runs its logic
in a Deno process managed by Ora's plugin runtime.

## Layout

```
deno.json                         Deno workspace + repository-wide tasks
deno.lock
.github/workflows/release.yml     tag <plugin>/v* → builds that plugin's .orax
packages/ui-plugin-base/          @ora-space/ui-plugin-base (workspace member, not on JSR)
  mod.ts                          public re-exports
  protocol.ts                     ui contract v1 types, method names, param parsers
  ui-plugin.ts                    UiPlugin base class, route tables, runUiPlugin
  session.ts                      SurfaceSessionRegistry (per-session serializer)
  stdout.ts                       protectProtocolStdout
  testing/frames.ts               host-side frame codec (independent of the SDK)
  testing/host-driver.ts          UiHostDriver: launch / notify / request / shutdown
  tests/*.test.ts                 unit tests for parsers and the session registry
plugins/
  skillhub/                       ora-space.skillhub      https://www.skillhub.cn
  huawei-agent-center/            ora-space.huawei-agent-center
                                  https://ai.edevops.huawei.com/mcp/projects
  hello-panel/                    ora-space.hello-panel   panel sample: ui/ page +
                                  counter/stopwatch in the process
```

Every plugin is an ordinary Ora plugin package: `package.json` with an `ora`
manifest, `src/main.ts` as the entrypoint, handler modules under `src/handlers/`
(`downloads.ts` for `ui/downloadCompleted`, `requests.ts` for `ui/request`),
`orax.toml` + `logo.svg` for release packaging, and `tests/host-simulator.ts`
driving the plugin through `UiHostDriver`. A panel plugin additionally ships its
page under `ui/` (external JS/CSS only; the host's CSP forbids inline code).

## Contract

| Direction     | Type         | Method                 | Surface kind | Handled by                                             |
| ------------- | ------------ | ---------------------- | ------------ | ------------------------------------------------------ |
| host → plugin | notification | `ui/surfaceOpened`     | all          | `UiPlugin.onSurfaceOpened`                             |
| host → plugin | notification | `ui/surfaceClosed`     | all          | `UiPlugin.onSurfaceClosed`                             |
| host → plugin | request      | `ui/downloadCompleted` | remoteSite   | `UiPlugin.onDownloadCompleted` → `{}`                  |
| host → plugin | request      | `ui/request`           | panel        | `UiPlugin.onRequest(session, payload)` → `{ payload }` |
| plugin → host | notification | `ui/push`              | panel        | `this.host.push(session, payload)`                     |

`runUiPlugin(plugin, { pluginId, sources })` registers exactly what the declared
`sources` require — `ui/downloadCompleted` for `"remoteSite"`, `ui/request` plus
`emits: ["ui/push"]` for `"panel"` — because Ora validates the registration
against the manifest at handshake. Every message is routed through
`SurfaceSessionRegistry`, so handlers for one
`(surfaceId, instanceId,
generation)` run in wire order while different sessions
run concurrently; this is why a panel's per-session state needs no locking. A
download for an unknown or already closed session is still served.

Inside a panel page, Ora injects `window.acquireOraSurfaceApi()` returning
`{ version: 1, request(payload), onPush(listener) }`; `request` rejects with
`{ kind: "host", code }` for host conditions and
`{ kind: "plugin", code,
message }` for a `PluginMethodError` thrown by
`onRequest`.

Ora launches a UI plugin with `cwd` = package root,
`--allow-read=<data-dir> --allow-write=<data-dir>` and
`ORA_PLUGIN_DATA_DIR=<data-dir>`. Deno discovers the workspace `deno.json`
upward from the package, so the bare `@ora-space/ui-plugin-base` import resolves
in development; the released `.orax` carries a single `deno bundle` output and
needs no workspace.

## Development

Requires [Deno](https://deno.com) 2.x. From the repository root:

```
deno task check     # type-check every workspace member
deno task lint
deno task format    # deno fmt (lineWidth 80)
deno task test      # base unit tests + host simulation of each plugin
```

Inside a plugin directory:

```
deno task simulate  # register → surfaceOpened → downloadCompleted | request/push → shutdown
deno task build     # dist/main.js, self-contained bundle
```

`minimumDependencyAge` is set to 0 in the root `deno.json` because the pinned
`jsr:@ora-space/plugin-sdk@0.1.3` is newer than Deno's default 24-hour policy.

## Local integration with the desktop app

Ora discovers plugins as real directories below `<data-dir>/plugins/` and does
not follow symlinks, and a checkout cannot be copied verbatim because the bare
`@ora-space/ui-plugin-base` import only resolves inside this workspace. The
`install` task bundles a plugin and copies the installable set (the shape of a
released `.orax`: `dist/main.js`, `ui/` for panels, logo, README, and a
`package.json` whose `ora.main` points at the bundle) into the data directory:

```
deno task install hello-panel <desktop>/.data     # repeat after every change
deno task install skillhub <desktop>/.data
task run:desktop                                   # in the desktop repository
```

Then enable the plugin in Settings → Plugins; its surfaces appear under the
globe button in the top-right corner.

## Release

Push a tag `<plugin>/v<version>` (for example `skillhub/v0.1.0`). The workflow
runs `deno task build` in `plugins/<plugin>`, zips `orax.toml`, `dist/main.js`,
`logo.svg` and `README.md` into `<ora.id>-v<version>.orax`, and creates a GitHub
Release for the tag; a panel plugin's `ui/` directory is added to the archive.

## License

Apache-2.0
