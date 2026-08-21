import { type JsonValue, PluginMethodError } from "@ora-space/plugin-sdk";
import type { SurfaceSession, UiHost } from "@ora-space/ui-plugin-base";

/** Everything the page shows; returned whole after every request. */
export interface PanelState {
  readonly count: number;
  readonly ticking: boolean;
  readonly seconds: number;
}

/** The requests the page may send; anything else is a `-32602` error. */
export type PanelRequest =
  | { type: "get" }
  | { type: "increment" }
  | { type: "decrement" }
  | { type: "reset" }
  | { type: "startTicking" }
  | { type: "stopTicking" };

const INVALID_PARAMS = -32602;
const TICK_INTERVAL_MS = 1000;

/**
 * State of one panel instance, owned by the process.
 *
 * The page is only a view: every answer is the full state and every tick is
 * pushed from here, so a reload of the page loses nothing and the page never
 * has to reconcile a local copy.
 */
class InstanceState {
  count = 0;
  seconds = 0;
  timer: number | undefined;

  snapshot(): PanelState {
    return {
      count: this.count,
      ticking: this.timer !== undefined,
      seconds: this.seconds,
    };
  }
}

/**
 * Serves `ui/request` and owns the per-session state plus the stopwatch
 * timers. Keyed by the base class's session identity so two instances of the
 * same surface (or a host restart) never share a counter.
 */
export class PanelRequests {
  readonly #host: UiHost;
  readonly #states = new Map<string, InstanceState>();

  constructor(host: UiHost) {
    this.#host = host;
  }

  /** Applies one page request and returns the resulting state. */
  handle(session: SurfaceSession, payload: JsonValue): PanelState {
    const request = parseRequest(payload);
    const state = this.#state(session);
    switch (request.type) {
      case "get":
        break;
      case "increment":
        state.count += 1;
        break;
      case "decrement":
        state.count -= 1;
        break;
      case "reset":
        state.count = 0;
        state.seconds = 0;
        break;
      case "startTicking":
        this.#start(session, state);
        break;
      case "stopTicking":
        this.#stop(state);
        break;
    }
    return state.snapshot();
  }

  /** Drops the session: stops its timer so nothing is pushed to a closed page. */
  forget(session: SurfaceSession): void {
    const key = sessionKey(session);
    const state = this.#states.get(key);
    if (state !== undefined) {
      this.#stop(state);
      this.#states.delete(key);
    }
  }

  /** Stops every timer; used at deactivation so the process can exit cleanly. */
  dispose(): void {
    for (const state of this.#states.values()) {
      this.#stop(state);
    }
    this.#states.clear();
  }

  #state(session: SurfaceSession): InstanceState {
    const key = sessionKey(session);
    let state = this.#states.get(key);
    if (state === undefined) {
      state = new InstanceState();
      this.#states.set(key, state);
    }
    return state;
  }

  #start(session: SurfaceSession, state: InstanceState): void {
    if (state.timer !== undefined) return;
    state.timer = setInterval(() => {
      state.seconds += 1;
      // Best-effort by contract: a failed push (closed page, restarting host)
      // is logged and the next tick simply tries again.
      this.#host
        .push(session, { type: "tick", seconds: state.seconds })
        .catch((error) => console.warn(`push failed: ${error}`));
    }, TICK_INTERVAL_MS);
  }

  #stop(state: InstanceState): void {
    if (state.timer === undefined) return;
    clearInterval(state.timer);
    state.timer = undefined;
  }
}

/** Narrows the opaque payload to a known request or rejects it. */
function parseRequest(payload: JsonValue): PanelRequest {
  const type = typeof payload === "object" && payload !== null &&
      !Array.isArray(payload)
    ? payload.type
    : undefined;
  switch (type) {
    case "get":
    case "increment":
    case "decrement":
    case "reset":
    case "startTicking":
    case "stopTicking":
      return { type };
    default:
      throw new PluginMethodError(
        INVALID_PARAMS,
        `unknown request type ${JSON.stringify(type ?? null)}`,
      );
  }
}

function sessionKey(session: SurfaceSession): string {
  return `${session.surfaceId}#${session.instanceId}@${session.generation}`;
}
