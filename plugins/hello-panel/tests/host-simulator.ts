/**
 * Drives this plugin exactly the way Ora's workbench bridge does.
 *
 * The process is launched with no permissions at all. The scenario:
 * register → counter calls for one instance → an independent second instance →
 * an unregistered method → shutdown. Run it with:
 *   deno task simulate
 */
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  PluginRequestError,
  WorkbenchHostDriver,
} from "@ora-space/ui-plugin-testing";

/** Converts this module-relative URL into a host path, with drive prefix. */
const entrypoint = decodeURIComponent(
  new URL("../src/main.ts", import.meta.url).pathname,
).replace(/^\/([A-Za-z]:)/, "$1");

const surface = { instanceId: 1, generation: 1 };

const host = await WorkbenchHostDriver.launch({ entrypoint });
assertEquals(host.registration, {
  methods: [
    "counter/get",
    "counter/increment",
    "counter/decrement",
    "counter/reset",
  ],
  emits: [],
});
console.log(`ok: register ${JSON.stringify(host.registration)}`);

// Counter: the state lives in the process and every answer is the whole state.
const steps: Array<[string, number]> = [
  ["counter/get", 0],
  ["counter/increment", 1],
  ["counter/increment", 2],
  ["counter/decrement", 1],
  ["counter/reset", 0],
];
for (const [method, count] of steps) {
  assertEquals(await host.invoke(method, surface, null), { count });
  console.log(`ok: ${method} -> count ${count}`);
}

// A second instance keeps its own counter.
await host.invoke("counter/increment", surface, null);
assertEquals(
  await host.invoke("counter/get", { instanceId: 2, generation: 1 }, null),
  { count: 0 },
);
console.log("ok: instances are independent");

// A method outside the registration is a plugin-side method_not_found.
await assertRejects(
  () => host.invoke("counter/unknown", surface, null),
  PluginRequestError,
);
console.log("ok: unregistered method rejected");

const code = await host.shutdown();
assertEquals(code, 0);
console.log("ok: shutdown 0");
