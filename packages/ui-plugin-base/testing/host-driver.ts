import type { CompletedDownload, SurfaceSession } from "../protocol.ts";
import {
  UI_DOWNLOAD_COMPLETED,
  UI_PUSH,
  UI_REQUEST,
  UI_SURFACE_CLOSED,
  UI_SURFACE_OPENED,
} from "../protocol.ts";
import { decodeFrames, encodeFrame, type FrameJson } from "./frames.ts";

/** What the plugin announced in `ora/register`. */
export interface Registration {
  readonly methods: string[];
  readonly emits: string[];
}

/** Launch parameters mirroring what Ora passes to a UI plugin process. */
export interface LaunchOptions {
  /** Absolute path of the plugin's `src/main.ts`. */
  readonly entrypoint: string;
  /** Directory granted as `--allow-read`/`--allow-write` and `ORA_PLUGIN_DATA_DIR`. */
  readonly dataDir: string;
}

/** One `ui/push` the plugin sent, as the host would route it to a panel. */
export interface PushedMessage {
  readonly session: SurfaceSession;
  readonly payload: FrameJson;
}

/** Error response returned by the plugin for one request. */
export class PluginRequestError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "PluginRequestError";
    this.code = code;
  }
}

type Frame = Record<string, unknown>;
type Settle = { resolve: (frame: Frame) => void; reject: (e: Error) => void };

/**
 * Drives one UI plugin process the way Ora's host does.
 *
 * The driver owns the child process and the frame streams so a simulator only
 * states the scenario: register, open, download or request, observe pushes,
 * close, shutdown. One background reader demultiplexes stdout: responses are
 * matched to their request id, `ui/push` notifications are queued for
 * `nextPush`, anything else is logged. Permissions and environment are the
 * exact ones Ora grants, so a plugin that needs more fails here rather than in
 * production.
 */
export class UiHostDriver {
  readonly registration: Registration;
  readonly #child: Deno.ChildProcess;
  readonly #writer: WritableStreamDefaultWriter<Uint8Array>;
  readonly #pending = new Map<number, Settle>();
  readonly #pushes: PushedMessage[] = [];
  readonly #pushWaiters: Array<(push: PushedMessage) => void> = [];
  readonly #closed: Promise<void>;
  #nextId = 1;

  private constructor(
    child: Deno.ChildProcess,
    writer: WritableStreamDefaultWriter<Uint8Array>,
    inbound: AsyncIterator<unknown>,
    registration: Registration,
  ) {
    this.#child = child;
    this.#writer = writer;
    this.registration = registration;
    this.#closed = this.#pump(inbound);
  }

  /** Spawns the plugin and waits for its `ora/register` frame. */
  static async launch(options: LaunchOptions): Promise<UiHostDriver> {
    const child = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--no-prompt",
        `--allow-read=${options.dataDir}`,
        `--allow-write=${options.dataDir}`,
        options.entrypoint,
      ],
      env: { ORA_PLUGIN_DATA_DIR: options.dataDir },
      stdin: "piped",
      stdout: "piped",
      stderr: "inherit",
    }).spawn();
    const writer = child.stdin.getWriter();
    const inbound = decodeFrames(child.stdout)[Symbol.asyncIterator]();
    const register = await waitForRegister(inbound);
    const params = (register.params ?? {}) as Partial<Registration>;
    return new UiHostDriver(child, writer, inbound, {
      methods: params.methods ?? [],
      emits: params.emits ?? [],
    });
  }

  /** Sends the `ui/surfaceOpened` notification. */
  surfaceOpened(session: SurfaceSession): Promise<void> {
    return this.#notify(UI_SURFACE_OPENED, sessionParams(session));
  }

  /** Sends the `ui/surfaceClosed` notification. */
  surfaceClosed(session: SurfaceSession): Promise<void> {
    return this.#notify(UI_SURFACE_CLOSED, sessionParams(session));
  }

  /** Invokes `ui/downloadCompleted` and returns the plugin's result. */
  downloadCompleted(
    session: SurfaceSession,
    download: CompletedDownload,
  ): Promise<FrameJson> {
    return this.#request(UI_DOWNLOAD_COMPLETED, {
      ...sessionParams(session),
      download: { ...download },
    });
  }

  /**
   * Invokes `ui/request` with `payload` and returns the answer's payload, the
   * way the bridge hands it to the panel page.
   */
  async request(
    session: SurfaceSession,
    payload: FrameJson,
  ): Promise<FrameJson> {
    const result = await this.#request(UI_REQUEST, {
      ...sessionParams(session),
      payload,
    });
    const record = (result ?? {}) as { [key: string]: FrameJson };
    return record.payload ?? null;
  }

  /**
   * Returns the next `ui/push`, waiting up to `timeoutMs` for one to arrive.
   * Pushes received earlier are delivered first, in wire order.
   */
  nextPush(timeoutMs = 3000): Promise<PushedMessage> {
    const queued = this.#pushes.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.#pushWaiters.indexOf(settle);
        if (index >= 0) this.#pushWaiters.splice(index, 1);
        reject(new Error(`no ui/push within ${timeoutMs} ms`));
      }, timeoutMs);
      const settle = (push: PushedMessage) => {
        clearTimeout(timer);
        resolve(push);
      };
      this.#pushWaiters.push(settle);
    });
  }

  /** Pushes received so far and not yet consumed by `nextPush`. */
  get pendingPushes(): readonly PushedMessage[] {
    return this.#pushes;
  }

  /** Sends `ora/shutdown`, closes stdin, and returns the exit code. */
  async shutdown(): Promise<number> {
    await this.#send({ jsonrpc: "2.0", method: "ora/shutdown" });
    await this.#writer.close();
    const status = await this.#child.status;
    await this.#closed;
    return status.code;
  }

  async #request(method: string, params: FrameJson): Promise<FrameJson> {
    const id = this.#nextId++;
    const response = new Promise<Frame>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });
    await this.#send({ jsonrpc: "2.0", id, method, params });
    const frame = await response;
    if (frame.error !== undefined) {
      const error = frame.error as { code: number; message: string };
      throw new PluginRequestError(error.code, error.message);
    }
    return (frame.result ?? null) as FrameJson;
  }

  #notify(method: string, params: FrameJson): Promise<void> {
    return this.#send({ jsonrpc: "2.0", method, params });
  }

  async #send(message: FrameJson): Promise<void> {
    await this.#writer.write(encodeFrame(message));
  }

  /** Reads stdout until it closes, routing responses and pushes. */
  async #pump(inbound: AsyncIterator<unknown>): Promise<void> {
    while (true) {
      const next = await inbound.next();
      if (next.done) break;
      const frame = next.value as Frame;
      if (typeof frame.id === "number" && frame.method === undefined) {
        const settle = this.#pending.get(frame.id);
        this.#pending.delete(frame.id);
        settle?.resolve(frame);
        continue;
      }
      if (frame.method === UI_PUSH) {
        const params = (frame.params ?? {}) as Record<string, FrameJson>;
        const push: PushedMessage = {
          session: {
            surfaceId: params.surfaceId as string,
            instanceId: params.instanceId as number,
            generation: params.generation as number,
          },
          payload: params.payload ?? null,
        };
        const waiter = this.#pushWaiters.shift();
        if (waiter !== undefined) {
          waiter(push);
        } else {
          this.#pushes.push(push);
        }
        continue;
      }
      console.log(`[host] << ${JSON.stringify(frame).slice(0, 160)}`);
    }
    const closed = new Error("plugin closed stdout before answering");
    for (const settle of this.#pending.values()) {
      settle.reject(closed);
    }
    this.#pending.clear();
  }
}

/** Reads frames until `ora/register`, logging anything the plugin sends first. */
async function waitForRegister(
  inbound: AsyncIterator<unknown>,
): Promise<Frame> {
  while (true) {
    const next = await inbound.next();
    if (next.done) {
      throw new Error("plugin closed stdout before ora/register");
    }
    const message = next.value as Frame;
    if (message.method === "ora/register") {
      return message;
    }
    console.log(`[host] << ${JSON.stringify(message).slice(0, 160)}`);
  }
}

function sessionParams(session: SurfaceSession): { [key: string]: FrameJson } {
  return {
    surfaceId: session.surfaceId,
    instanceId: session.instanceId,
    generation: session.generation,
  };
}
