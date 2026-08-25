## {{change}} `{{name}}` v{{version}}

| | |
| --- | --- |
| Kind | `{{kind}}` |
| Source | `{{release_repo}}` tag [`{{tag}}`]({{release_url}}) |
| Asset | [`{{asset}}`]({{url}}) |
| SHA-256 | `{{sha256}}` |

The entry under `{{entry_path}}` was derived by `ui-plugins/scripts/publish.ts`
from the `orax.toml`, `README.md` and `logo.svg` inside the released archive;
the script downloaded the asset and verified its digest before opening this PR.
Please do not edit the entry by hand — re-run the script for a different build.

### Reviewer checklist

- [ ] The source repository is a trusted org repository.
- [ ] `webview`: `start_url`, `allowed_origins` and download rules are sensible.
- [ ] `workbench`: `[workbench].methods` matches what the README describes.
- [ ] The README reads well for end users.

### README excerpt

{{readme_excerpt}}
