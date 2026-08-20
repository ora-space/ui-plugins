# ora-space.huawei-agent-center

An Ora **UI plugin** that embeds the Huawei Agent Center as a remote-site
Surface.

Ora renders `https://ai.edevops.huawei.com/mcp/projects` in a webview, restricts
navigation to the hosts declared in `package.json`, and stores any file the site
downloads inside this plugin's data directory. This process is then told about
it through `ui/downloadCompleted` and decides whether the file looks like a
skill archive (`.zip`). Today the verdict is only logged.

## Layout

```
package.json                 Ora manifest (ora.kind = "ui", one remoteSite surface)
deno.json                    developer tasks; Ora never reads it
orax.toml                    release manifest for the .orax archive
src/main.ts                  HuaweiAgentCenterUiPlugin, wired through runUiPlugin
src/handlers/downloads.ts    ui/downloadCompleted
tests/host-simulator.ts      drives this plugin the way the Ora host does
```

The base class lives in `../../packages/ui-plugin-base` and is resolved through
the Deno workspace; `deno task build` inlines it into `dist/main.js`.

## Commands

```
deno task check       # type-check entrypoint and simulator
deno task lint
deno task simulate    # register → surfaceOpened → downloadCompleted → shutdown
deno task build       # dist/main.js, self-contained bundle
```

Ora launches UI plugins with `--allow-read=<data-dir> --allow-write=<data-dir>`
and `ORA_PLUGIN_DATA_DIR=<data-dir>`; the simulator uses the same flags.
