/**
 * Drives this plugin exactly the way Ora's host does for a panel surface.
 *
 * A temporary data directory stands in for `<data-dir>/plugin-data/<id>/`;
 * the process is granted read and write access to that directory only. The
 * scenario: register → surfaceOpened → counter requests → stopwatch pushes →
 * unknown request → surfaceClosed stops pushes → shutdown. Run it with:
 *   deno task simulate
 */
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  PluginRequestError,
  UiHostDriver,
} from "../../../packages/ui-plugin-base/testing/host-driver.ts";

/** Converts this module-relative URL into a host path, with drive prefix. */
const entrypoint = decodeURIComponent(
  new URL("../src/main.ts", import.meta.url).pathname,
).replace(/^\/([A-Za-z]:)/, "$1");

const dataDir = await Deno.makeTempDir({ prefix: "ora-ui-plugin-" });
const session = { surfaceId: "counter", instanceId: 1, generation: 1 };
let exitCode = 1;
try {
  const host = await UiHostDriver.launch({ entrypoint, dataDir });
  assertEquals(host.registration, {
    methods: ["ui/request"],
    emits: ["ui/push"],
  });
  console.log(`ok: register ${JSON.stringify(host.registration)}`);

  await host.surfaceOpened(session);
  console.log("ok: ui/surfaceOpened");

  // Counter: the state lives in the process and every answer is the whole state.
  const steps: Array<[string, number]> = [
    ["get", 0],
    ["increment", 1],
    ["increment", 2],
    ["decrement", 1],
    ["reset", 0],
  ];
  for (const [type, count] of steps) {
    assertEquals(await host.request(session, { type }), {
      count,
      ticking: false,
      seconds: 0,
    });
    console.log(`ok: ui/request ${type} -> count ${count}`);
  }

  // Stopwatch: starting makes the process push a tick per second.
  assertEquals(await host.request(session, { type: "startTicking" }), {
    count: 0,
    ticking: true,
    seconds: 0,
  });
  const first = await host.nextPush();
  assertEquals(first, {
    session,
    payload: { type: "tick", seconds: 1 },
  });
  console.log("ok: ui/push tick 1");
  assertEquals(await host.request(session, { type: "stopTicking" }), {
    count: 0,
    ticking: false,
    seconds: 1,
  });
  await assertRejects(() => host.nextPush(1500), Error, "no ui/push");
  console.log("ok: stopTicking ends pushes");

  // Unknown requests are plugin errors, which the bridge relays as kind=plugin.
  const error = await assertRejects(
    () => host.request(session, { type: "explode" }),
    PluginRequestError,
  );
  assertEquals(error.code, -32602);
  console.log(`ok: unknown request -> ${error.code} ${error.message}`);

  // Closing the surface stops a running stopwatch so nothing targets a dead page.
  await host.request(session, { type: "startTicking" });
  await host.surfaceClosed(session);
  await assertRejects(() => host.nextPush(1500), Error, "no ui/push");
  console.log("ok: ui/surfaceClosed stops pushes");

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
