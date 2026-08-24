# official/ora-space.huawei-agent-center

An Ora **webview plugin** that embeds the Huawei Agent Center.

Ora renders `https://ai.edevops.huawei.com/mcp/projects` in an isolated webview
and restricts navigation to the exact origins declared in `orax.toml` (origins
are exact in the webview model — extend `allowed_origins` if the site's login
flow visits further origins). A webview plugin is configuration only: there is
no Deno process and no entrypoint. Downloads are owned entirely by the host — a
file downloaded from the site lands in this plugin's data directory and the user
is prompted to import it as a skill or save it elsewhere, per the
`[webview.downloads]` rules.

## Layout

```
orax.toml       manifest: kind = "webview"; start URL, allowed origins, download rules
logo.svg        plugin icon (fixed name; not referenced from the manifest)
```

A webview package must not ship `main.js`; Ora rejects a config-only kind that
looks runnable.
