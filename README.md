# ui-plugins

Ora **UI plugins** (`kind: "ui"`), kept together in one repository because they
share a common base package. Each plugin contributes a Surface — a block of
content shown inside Ora, embedded as a side panel or popped out into its own
window — and runs its logic in a Deno process managed by Ora's plugin runtime.

## Planned layout

```
packages/ui-plugin-base/     UiPlugin base class, ui contract v1 types, host test driver
plugins/skillhub/            SkillHub skill marketplace (https://www.skillhub.cn)
plugins/huawei-agent-center/ Huawei Agent Center (https://ai.edevops.huawei.com/mcp/projects)
```

Every plugin is an ordinary Ora plugin package: a `package.json` with an `ora`
manifest, a Deno entrypoint under `src/`, and an `orax.toml` for release
packaging. Ora discovers packages as direct children of `<ORA_DATA_DIR>/plugins/`.

## Development

Requires [Deno](https://deno.com) 2.x.

```
deno task check     # type-check every workspace member
deno task lint
deno task format
deno task test      # host-simulator runs against each plugin
```

## License

Apache-2.0
