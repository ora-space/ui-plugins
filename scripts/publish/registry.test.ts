import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { parse as parseToml } from "jsr:@std/toml@1";
import {
  deriveRegistryManifest,
  registryEntryPath,
  validateRegistryManifest,
} from "./registry.ts";

const SHA = "a".repeat(64);
const URL =
  "https://github.com/ora-space/ui-plugins/releases/download/skillhub/v0.1.0/ora-space.skillhub-v0.1.0.orax";

const WEBVIEW = `resolver = 1
name = "ora-space.skillhub"
namespace = "official"
kind = "webview"
version = "0.1.0"
description = "Ora Space SkillHub surface"
homepage = "https://github.com/ora-space/ui-plugins"
license = "Apache-2.0"

[webview]
start_url = "https://www.skillhub.cn"
allowed_origins = ["https://www.skillhub.cn"]

[webview.downloads]
fallback = { reject = true }

[[webview.downloads.rules]]
page = { origin = "https://www.skillhub.cn", path_prefix = "/" }
action = { prompt = ["import_skill", "save_as"] }
`;

Deno.test("derives a webview entry that round-trips the package manifest", () => {
  const entry = deriveRegistryManifest(WEBVIEW, { url: URL, sha256: SHA });
  const parsed = parseToml(entry) as Record<string, unknown>;
  assertEquals(parsed, { ...parseToml(WEBVIEW), url: URL, sha256: SHA });
  // Scalars must precede the first table header or they would join it.
  assertEquals(entry.indexOf("sha256") < entry.indexOf("[webview]"), true);
});

Deno.test("adds resolver and replaces stale download fields", () => {
  const stale = `name = "ora-space.hello-panel"
namespace = "official"
kind = "workbench"
version = "0.2.0"
description = "sample"
url = "https://old.example/x.orax"
sha256 = "${"b".repeat(64)}"

[workbench]
methods = ["counter/get"]
`;
  const parsed = parseToml(
    deriveRegistryManifest(stale, { url: URL, sha256: SHA }),
  );
  assertEquals(parsed, {
    resolver: 1,
    name: "ora-space.hello-panel",
    namespace: "official",
    kind: "workbench",
    version: "0.2.0",
    description: "sample",
    url: URL,
    sha256: SHA,
    workbench: { methods: ["counter/get"] },
  });
});

Deno.test("rejects fields the desktop release form does not know", () => {
  assertThrows(
    () =>
      validateRegistryManifest({
        resolver: 1,
        name: "x",
        namespace: "official",
        kind: "agent",
        version: "1.0.0",
        description: "d",
        url: URL,
        sha256: SHA,
        title: "X",
      }),
    Error,
    "unknown field title",
  );
});

Deno.test("rejects a webview entry without its section", () => {
  assertThrows(
    () =>
      deriveRegistryManifest(
        `name = "n"\nnamespace = "official"\nkind = "webview"\nversion = "1.0.0"\ndescription = "d"\n`,
        { url: URL, sha256: SHA },
      ),
    Error,
    "requires a [webview] table",
  );
});

Deno.test("shards registry entries by the first letter of the name", () => {
  assertEquals(registryEntryPath("ora-space.skillhub"), [
    "registry",
    "o",
    "ora-space.skillhub",
  ]);
});
