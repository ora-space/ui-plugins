# official/ora-space.hello-panel

The sample **workbench** plugin: it ships its own page (`assets/`) and routes
every click through this Deno process.

- **Counter** — `−1` / `+1` / `归零` call `window.ora.invoke("counter/…")`; Ora
  forwards the call to this process with a host-owned envelope, the process
  mutates its state and answers with the whole state.

The process is the only owner of state: reloading the page re-reads it with
`counter/get`, and state is keyed by the envelope's instance id and process
generation, so two open pages never share a counter. The v1 workbench contract
has no plugin-to-page push channel; the page always pulls.

## Layout

```
orax.toml                    manifest: kind = "workbench", the page-visible method allowlist
main.js                      built by `deno task build` (gitignored); the fixed entrypoint Ora loads
package.json                 npm metadata only; Ora never reads it
deno.json                    developer tasks; Ora never reads it
src/main.ts                  defineWorkbenchPlugin({ methods }) from @ora-space/plugin-sdk
src/handlers/counter.ts      per-instance counter state
assets/index.html, app.js, app.css   the page; external JS/CSS only (the workbench CSP forbids inline)
tests/host-simulator.ts      drives this plugin the way the Ora workbench bridge does
```

Only files below `assets/` are ever served to the page
(`ora-plugin://localhost/<instance>/…`); `src/` and `orax.toml` are unreachable
from it. The plugin process runs with no Deno permissions.

## Page ⇄ process protocol

| Invoke                                                                         | Answer      |
| ------------------------------------------------------------------------------ | ----------- |
| `counter/get` \| `counter/increment` \| `counter/decrement` \| `counter/reset` | `{ count }` |

Methods outside the manifest allowlist are refused by the host before the
process is ever reached.
