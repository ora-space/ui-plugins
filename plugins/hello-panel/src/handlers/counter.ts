import type { WorkbenchCall } from "@ora-space/plugin-sdk";

/** Everything the page shows; returned whole after every call. */
// A type alias (not an interface) so it gets an implicit index signature and
// stays assignable to the SDK's JsonValue method result.
export type CounterState = { count: number };

/** The counter operations the page-visible methods map onto. */
export type CounterOp = "get" | "increment" | "decrement" | "reset";

/**
 * Per-instance counters, owned by the process.
 *
 * State is keyed by the host envelope's instance id and process generation:
 * two open pages of this workbench never share a counter, and a host talking
 * to a restarted process starts from zero on purpose (the host closes stale
 * instances on a generation change, so a live page never observes the reset).
 */
export class Counters {
  readonly #counts = new Map<string, number>();

  /** Applies one operation for the calling page instance and returns the state. */
  apply(op: CounterOp, call: WorkbenchCall): CounterState {
    const key = `${call.surface.instanceId}@${call.surface.generation}`;
    let count = this.#counts.get(key) ?? 0;
    switch (op) {
      case "get":
        break;
      case "increment":
        count += 1;
        break;
      case "decrement":
        count -= 1;
        break;
      case "reset":
        count = 0;
        break;
    }
    this.#counts.set(key, count);
    return { count };
  }
}
