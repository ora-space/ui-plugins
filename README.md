# ui-plugins

Ora **UI plugins** (`kind: "ui"`), kept together in one repository because they
share a common base package. Each plugin contributes a Surface — a remote site
shown inside Ora, embedded as a side panel or popped out into its own window —
and runs its logic in a Deno process managed by Ora's plugin runtime.

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
```

Every plugin is an ordinary Ora plugin package: `package.json` with an `ora`
manifest, `src/main.ts` as the entrypoint, `src/handlers/downloads.ts` for
`ui/downloadCompleted`, `orax.toml` + `logo.svg` for release packaging, and
`tests/host-simulator.ts` driving the plugin through `UiHostDriver`.

## Contract

| Direction     | Type         | Method                 | Handled by                            |
| ------------- | ------------ | ---------------------- | ------------------------------------- |
| host → plugin | notification | `ui/surfaceOpened`     | `UiPlugin.onSurfaceOpened`            |
| host → plugin | notification | `ui/surfaceClosed`     | `UiPlugin.onSurfaceClosed`            |
| host → plugin | request      | `ui/downloadCompleted` | `UiPlugin.onDownloadCompleted` → `{}` |

`runUiPlugin` registers `{ methods: ["ui/downloadCompleted"], emits: [] }` and
routes every message through `SurfaceSessionRegistry`, so handlers for one
`(surfaceId, instanceId, generation)` run in wire order while different sessions
run concurrently. A download for an unknown or already closed session is still
served.

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
deno task simulate  # register → surfaceOpened → downloadCompleted → shutdown
deno task build     # dist/main.js, self-contained bundle
```

`minimumDependencyAge` is set to 0 in the root `deno.json` because the pinned
`jsr:@ora-space/plugin-sdk@0.1.3` is newer than Deno's default 24-hour policy.

## Local integration with the desktop app

```
ln -s <this-repo>/plugins/skillhub <desktop>/.data/plugins/skillhub
ln -s <this-repo>/plugins/huawei-agent-center <desktop>/.data/plugins/huawei-agent-center
task run:desktop
```

## Release

Push a tag `<plugin>/v<version>` (for example `skillhub/v0.1.0`). The workflow
runs `deno task build` in `plugins/<plugin>`, zips `orax.toml`, `dist/main.js`,
`logo.svg` and `README.md` into `<ora.id>-v<version>.orax`, and creates a GitHub
Release for the tag.

## License

Apache-2.0
