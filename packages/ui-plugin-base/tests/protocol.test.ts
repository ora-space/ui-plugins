import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { PluginMethodError } from "@ora-space/plugin-sdk";
import {
  INVALID_PARAMS,
  parseDownloadCompleted,
  parseSurfaceSession,
} from "../protocol.ts";

const session = { surfaceId: "market", instanceId: 7, generation: 3 };
const download = {
  id: 12,
  pageUrl: "https://www.skillhub.cn/skills/abc",
  sourceUrl: "https://cdn.skillhub.cn/abc.zip",
  fileName: "abc.zip",
  path: "/tmp/plugin-data/ora-space.skillhub/downloads/abc.zip",
  sizeBytes: 10240,
  completedAt: "2026-08-20T16:30:00+08:00",
};

Deno.test("parseSurfaceSession accepts the contract shape", () => {
  assertEquals(parseSurfaceSession({ ...session, extra: true }), session);
});

Deno.test("parseSurfaceSession rejects missing fields with -32602", () => {
  const error = assertThrows(
    () => parseSurfaceSession({ surfaceId: "market", instanceId: 7 }),
    PluginMethodError,
  );
  assertEquals(error.code, INVALID_PARAMS);
});

Deno.test("parseSurfaceSession rejects non-object params", () => {
  assertThrows(() => parseSurfaceSession(null), PluginMethodError);
  assertThrows(() => parseSurfaceSession([1]), PluginMethodError);
});

Deno.test("parseDownloadCompleted splits session and download", () => {
  assertEquals(parseDownloadCompleted({ ...session, download }), {
    session,
    download,
  });
});

Deno.test("parseDownloadCompleted keeps a null pageUrl", () => {
  const parsed = parseDownloadCompleted({
    ...session,
    download: { ...download, pageUrl: null },
  });
  assertEquals(parsed.download.pageUrl, null);
});

Deno.test("parseDownloadCompleted rejects a malformed download", () => {
  const error = assertThrows(
    () =>
      parseDownloadCompleted({
        ...session,
        download: { ...download, sizeBytes: "big" },
      }),
    PluginMethodError,
  );
  assertEquals(error.code, INVALID_PARAMS);
  assertThrows(
    () => parseDownloadCompleted({ ...session }),
    PluginMethodError,
  );
});
