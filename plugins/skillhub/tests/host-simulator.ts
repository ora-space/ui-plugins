/**
 * Drives this plugin exactly the way Ora's host does.
 *
 * A temporary data directory stands in for `<data-dir>/plugin-data/<id>/`;
 * the plugin process is granted read and write access to that directory only,
 * matching the permissions Ora gives a UI plugin. Run it with:
 *   deno task simulate
 */
import { assertEquals } from "jsr:@std/assert@1";
import { UiHostDriver } from "../../../packages/ui-plugin-base/testing/host-driver.ts";
import type { CompletedDownload } from "@ora-space/ui-plugin-base";

/** Converts this module-relative URL into a host path, with drive prefix. */
const entrypoint = decodeURIComponent(
  new URL("../src/main.ts", import.meta.url).pathname,
).replace(/^\/([A-Za-z]:)/, "$1");

const dataDir = await Deno.makeTempDir({ prefix: "ora-ui-plugin-" });
const downloadsDir = `${dataDir}/downloads`;
await Deno.mkdir(downloadsDir);

/** Writes a placeholder file and describes it the way the host would. */
async function stageDownload(
  id: number,
  fileName: string,
): Promise<CompletedDownload> {
  const path = `${downloadsDir}/${fileName}`;
  const bytes = new TextEncoder().encode(`placeholder for ${fileName}`);
  await Deno.writeFile(path, bytes);
  return {
    id,
    pageUrl: "https://example.invalid/skills/abc",
    sourceUrl: `https://example.invalid/files/${fileName}`,
    fileName,
    path,
    sizeBytes: bytes.byteLength,
    completedAt: new Date().toISOString(),
  };
}

const session = { surfaceId: "market", instanceId: 1, generation: 1 };
let exitCode = 1;
try {
  const host = await UiHostDriver.launch({ entrypoint, dataDir });
  assertEquals(host.registration, {
    methods: ["ui/downloadCompleted"],
    emits: [],
  });
  console.log(`ok: register ${JSON.stringify(host.registration)}`);

  await host.surfaceOpened(session);
  console.log("ok: ui/surfaceOpened");

  for (const [id, fileName] of [[1, "a.zip"], [2, "a.tar.gz"]] as const) {
    const download = await stageDownload(id, fileName);
    const result = await host.downloadCompleted(session, download);
    assertEquals(result, {});
    console.log(`ok: ui/downloadCompleted ${fileName} -> {}`);
  }

  await host.surfaceClosed(session);
  console.log("ok: ui/surfaceClosed");

  exitCode = await host.shutdown();
  console.log(`plugin exited with code ${exitCode}`);
} finally {
  await Deno.remove(dataDir, { recursive: true });
}

console.log(
  exitCode === 0
    ? "ALL HOST SIMULATION CHECKS PASSED"
    : "PLUGIN EXITED NON-ZERO",
);
Deno.exit(exitCode === 0 ? 0 : 1);
