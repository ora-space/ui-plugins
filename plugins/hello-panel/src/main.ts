import { defineWorkbenchPlugin } from "@ora-space/plugin-sdk";
import { Counters } from "./handlers/counter.ts";

/**
 * A package-shipped workbench page whose buttons round-trip through this
 * process.
 *
 * The page (`assets/`) is a view only: the counter lives here and every answer
 * carries the whole state, so a page reload loses nothing. The v1 workbench
 * contract has no plugin-to-page push channel; the page always pulls through
 * `window.ora.invoke`, which the host forwards to exactly the methods below.
 */
const counters = new Counters();

const workbench = defineWorkbenchPlugin({
  methods: {
    "counter/get": (call) => counters.apply("get", call),
    "counter/increment": (call) => counters.apply("increment", call),
    "counter/decrement": (call) => counters.apply("decrement", call),
    "counter/reset": (call) => counters.apply("reset", call),
  },
});

await workbench.run();
