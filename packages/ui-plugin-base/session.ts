import type { SurfaceSession } from "./protocol.ts";

/** Work attached to one session; its result is irrelevant to ordering. */
type SessionTask = () => unknown;

/**
 * Serializes handler execution per Surface session.
 *
 * The SDK runs handlers concurrently, so wire order is not execution order.
 * Without this, a `downloadCompleted` could observe state that `surfaceOpened`
 * has not finished building. Each `(surfaceId, instanceId, generation)` owns
 * one promise chain; different sessions still run in parallel.
 */
export class SurfaceSessionRegistry {
  readonly #chains = new Map<string, Promise<void>>();
  readonly #inFlight = new Set<Promise<unknown>>();

  /** Starts a session with `handler` at the head of its chain. */
  opened(session: SurfaceSession, handler: SessionTask): Promise<void> {
    const key = sessionKey(session);
    if (this.#chains.has(key)) {
      // A duplicate open (host resend after restart) must not fork the chain;
      // treat it as ordinary work on the existing session.
      return this.run(session, handler);
    }
    const operation = this.#track(Promise.resolve().then(handler));
    this.#chains.set(key, settle(operation));
    return operation;
  }

  /**
   * Runs `task` after everything already queued on its session.
   *
   * A download may arrive after its session closed, or before this process
   * ever saw the instance open, so an unknown session runs the task directly
   * without creating a record: the contract says downloads never require a
   * session to exist.
   */
  run(session: SurfaceSession, task: SessionTask): Promise<void> {
    const key = sessionKey(session);
    const chain = this.#chains.get(key);
    if (chain === undefined) {
      return this.#track(Promise.resolve().then(task));
    }
    const operation = this.#track(chain.then(task));
    this.#chains.set(key, settle(operation));
    return operation;
  }

  /** Queues `handler` as the session's last step and forgets the session. */
  closed(session: SurfaceSession, handler: SessionTask): Promise<void> {
    const operation = this.run(session, handler);
    // Deleting immediately makes later `run` calls take the no-session path,
    // so draining never blocks on work the host considers finished.
    this.#chains.delete(sessionKey(session));
    return operation;
  }

  /** Waits for every queued task, used while the process shuts down. */
  async drain(): Promise<void> {
    while (this.#inFlight.size > 0) {
      await Promise.allSettled([...this.#inFlight]);
    }
  }

  /** Observes completion so `drain` can wait without swallowing errors. */
  #track<T>(operation: Promise<T>): Promise<void> {
    const result = operation.then(() => undefined);
    this.#inFlight.add(result);
    const forget = () => this.#inFlight.delete(result);
    result.then(forget, forget);
    return result;
  }
}

/** A failed handler must not poison the chain for later tasks. */
function settle(operation: Promise<void>): Promise<void> {
  return operation.catch(() => undefined);
}

function sessionKey(session: SurfaceSession): string {
  return `${session.surfaceId}#${session.instanceId}@${session.generation}`;
}
