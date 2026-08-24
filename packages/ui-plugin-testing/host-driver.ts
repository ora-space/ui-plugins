import { decodeFrames, encodeFrame, type FrameJson } from "./frames.ts";
import { FakeStorage, StorageFault } from "./storage.ts";

/**
 * Identifies the page instance a workbench call claims to come from; the same
 * shape the SDK hands to method handlers, spelled in camelCase on this side
 * and as `instance_id` / `generation` inside the wire envelope.
 */
export interface WorkbenchSurface {
  readonly instanceId: number;
  readonly generation: number;
}

/** What the plugin announced in `ora/register`. */
export interface Registration {
  readonly methods: string[];
  readonly emits: string[];
}

/** Launch parameters mirroring what Ora passes to a UI plugin process. */
export interface LaunchOptions {
  /** Absolute path of the plugin's entry module. */
  readonly entrypoint: string;
  /** The data directory served through `ora/storage/*`; empty when omitted. */
  readonly storage?: FakeStorage;
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
 * states the scenario: register, invoke page-visible methods, shutdown. One
 * background reader demultiplexes stdout: responses are matched to their
 * request id, `ora/storage/*` requests are answered from the fake storage, and
 * anything else is logged. The process is launched exactly as Ora launches a
 * workbench plugin — `--no-prompt` and no permissions at all — so a plugin that
 * reaches for the filesystem or the environment fails here rather than in
 * production.
 */
export class WorkbenchHostDriver {
  readonly registration: Registration;
  readonly storage: FakeStorage;
  readonly #child: Deno.ChildProcess;
  readonly #writer: WritableStreamDefaultWriter<Uint8Array>;
  readonly #pending = new Map<number, Settle>();
  readonly #closed: Promise<void>;
  #nextId = 1;

  private constructor(
    child: Deno.ChildProcess,
    writer: WritableStreamDefaultWriter<Uint8Array>,
    inbound: AsyncIterator<unknown>,
    registration: Registration,
    storage: FakeStorage,
  ) {
    this.#child = child;
    this.#writer = writer;
    this.registration = registration;
    this.storage = storage;
    this.#closed = this.#pump(inbound);
  }

  /** Spawns the plugin and waits for its `ora/register` frame. */
  static async launch(options: LaunchOptions): Promise<WorkbenchHostDriver> {
    const child = new Deno.Command(Deno.execPath(), {
      args: ["run", ...localDenoFlags(), "--no-prompt", options.entrypoint],
      stdin: "piped",
      stdout: "piped",
      stderr: "inherit",
    }).spawn();
    const writer = child.stdin.getWriter();
    const inbound = decodeFrames(child.stdout)[Symbol.asyncIterator]();
    const register = await waitForRegister(inbound);
    const params = (register.params ?? {}) as Partial<Registration>;
    return new WorkbenchHostDriver(
      child,
      writer,
      inbound,
      { methods: params.methods ?? [], emits: params.emits ?? [] },
      options.storage ?? new FakeStorage(),
    );
  }

  /**
   * Invokes one page-visible method the way the workbench bridge does: the
   * params are the host envelope `{ surface: { instance_id, generation },
   * input }`, and the answer is the plugin's raw result.
   */
  invoke(
    method: string,
    surface: WorkbenchSurface,
    input: FrameJson,
  ): Promise<FrameJson> {
    return this.#request(method, {
      surface: {
        instance_id: surface.instanceId,
        generation: surface.generation,
      },
      input,
    });
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

  async #send(message: FrameJson): Promise<void> {
    await this.#writer.write(encodeFrame(message));
  }

  /** Reads stdout until it closes, routing responses, pushes, and host requests. */
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
      if (typeof frame.method === "string" && frame.id !== undefined) {
        await this.#answerHostRequest(
          frame.id as number | string,
          frame.method,
          (frame.params ?? null) as FrameJson,
        );
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

  /** Serves one plugin-to-host request; only storage exists on this host. */
  async #answerHostRequest(
    id: number | string,
    method: string,
    params: FrameJson,
  ): Promise<void> {
    if (!FakeStorage.serves(method)) {
      await this.#send({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unknown host method ${method}` },
      });
      return;
    }
    try {
      const result = this.storage.handle(method, params);
      await this.#send({ jsonrpc: "2.0", id, result });
    } catch (error) {
      if (!(error instanceof StorageFault)) throw error;
      await this.#send({
        jsonrpc: "2.0",
        id,
        error: {
          code: error.code,
          message: error.message,
          data: { kind: error.kind },
        },
      });
    }
  }
}

/**
 * Extra `deno run` flags for the plugin child, taken from `ORA_DENO_FLAGS`.
 *
 * `deno task` and `--config` do not propagate to spawned processes, so the
 * same variable the workspace tasks splice into their own commands (for
 * example `--config /path/to/deno.local.json`, which maps the SDK to a local
 * checkout) is forwarded here; otherwise the child would resolve
 * `@ora-space/plugin-sdk` from the committed `deno.json` only. Missing env
 * permission counts as unset so a simulator without the grant still runs.
 */
function localDenoFlags(): string[] {
  let value: string | undefined;
  try {
    value = Deno.env.get("ORA_DENO_FLAGS");
  } catch (error) {
    if (!(error instanceof Deno.errors.NotCapable)) throw error;
  }
  return value === undefined ? [] : value.split(/\s+/).filter(Boolean);
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
