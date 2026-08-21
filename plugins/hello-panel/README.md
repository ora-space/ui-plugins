# ora-space.hello-panel

The sample **panel** UI plugin: instead of embedding a remote site, it ships its
own page (`ui/`) and routes every click through this Deno process.

- **Counter** — `−1` / `+1` / `归零` send `{ type }` through
  `acquireOraSurfaceApi().request(...)`; Ora forwards it as `ui/request`, the
  process mutates its state and answers with the whole state.
- **Stopwatch** — `开始` makes the process push `{ type: "tick", seconds }` once
  per second through `ui/push`; the page only renders what arrives.

The process is the only owner of state: reloading the page re-reads it with
`{ type: "get" }`, closing the surface stops its stopwatch, and a process
restart starts from zero on purpose.

## Layout

```
package.json                 Ora manifest (ora.kind = "ui", one panel surface: root "ui", entry "index.html")
deno.json                    developer tasks; Ora never reads it
orax.toml                    release manifest for the .orax archive
src/main.ts                  HelloPanelPlugin, wired through runUiPlugin with sources: ["panel"]
src/handlers/requests.ts     ui/request dispatch, per-session state, stopwatch timers
ui/index.html, app.js, app.css   the page; external JS/CSS only (panel CSP forbids inline)
tests/host-simulator.ts      drives this plugin the way the Ora host does
```

Only files below `ui/` are ever served to the page
(`ora-plugin://localhost/ora-space.hello-panel/counter/...`); `src/` and
`package.json` are unreachable from it.

## Page ⇄ process protocol

| Request payload                                              | Answer payload                             |
| ------------------------------------------------------------ | ------------------------------------------ |
| `{ "type": "get" \| "increment" \| "decrement" \| "reset" }` | `{ count, ticking, seconds }`              |
| `{ "type": "startTicking" \| "stopTicking" }`                | `{ count, ticking, seconds }`              |
| anything else                                                | plugin error `-32602 unknown request type` |

Push payload: `{ "type": "tick", "seconds": n }`.

## Commands

```
deno task check       # type-check entrypoint and simulator
deno task lint
deno task simulate    # register → surfaceOpened → requests → pushes → surfaceClosed → shutdown
deno task build       # dist/main.js, self-contained bundle (ui/ ships alongside)
```
