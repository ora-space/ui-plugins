import type { CompletedDownload, SurfaceSession } from "../protocol.ts";
import {
  UI_DOWNLOAD_COMPLETED,
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

/** Error response returned by the plugin for one request. */
export class PluginRequestError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "PluginRequestError";
    this.code = code;
  }
}

/**
 * Drives one UI plugin process the way Ora's host does.
 *
 * The driver owns the child process and the frame streams so a simulator only
 * states the scenario: register, open, download, close, shutdown. Permissions
 * and environment are the exact ones Ora grants, so a plugin that needs more
 * fails here rather than in production.
 */
export class UiHostDriver {
  readonly registration: Registration;
  readonly #child: Deno.ChildProcess;
  readonly #writer: WritableStreamDefaultWriter<Uint8Array>;
  readonly #inbound: AsyncIterator<unknown>;
  #nextId = 1;

  private constructor(
    child: Deno.ChildProcess,
    writer: WritableStreamDefaultWriter<Uint8Array>,
    inbound: AsyncIterator<unknown>,
    registration: Registration,
  ) {
    this.#child = child;
    this.#writer = writer;
    this.#inbound = inbound;
    this.registration = registration;
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
    const register = await waitFor(
      inbound,
      (message) => message.method === "ora/register",
      "ora/register",
    );
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

  /**
   * Invokes `ui/downloadCompleted` and returns the plugin's result.
   *
   * A JSON-RPC error response is rethrown as `PluginRequestError` so a
   * simulator can assert on expected rejections by code.
   */
  async downloadCompleted(
    session: SurfaceSession,
    download: CompletedDownload,
  ): Promise<FrameJson> {
    const id = this.#nextId++;
    await this.#send({
      jsonrpc: "2.0",
      id,
      method: UI_DOWNLOAD_COMPLETED,
      params: { ...sessionParams(session), download: { ...download } },
    });
    const response = await waitFor(
      this.#inbound,
      (message) => message.id === id,
      `${UI_DOWNLOAD_COMPLETED} response #${id}`,
    );
    if (response.error !== undefined) {
      const error = response.error as { code: number; message: string };
      throw new PluginRequestError(error.code, error.message);
    }
    return (response.result ?? null) as FrameJson;
  }

  /** Sends `ora/shutdown`, closes stdin, and returns the exit code. */
  async shutdown(): Promise<number> {
    await this.#send({ jsonrpc: "2.0", method: "ora/shutdown" });
    await this.#writer.close();
    const status = await this.#child.status;
    return status.code;
  }

  #notify(method: string, params: FrameJson): Promise<void> {
    return this.#send({ jsonrpc: "2.0", method, params });
  }

  async #send(message: FrameJson): Promise<void> {
    await this.#writer.write(encodeFrame(message));
  }
}

/** Reads frames until one satisfies `match`, logging anything skipped. */
async function waitFor(
  inbound: AsyncIterator<unknown>,
  match: (message: Record<string, unknown>) => boolean,
  label: string,
): Promise<Record<string, unknown>> {
  while (true) {
    const next = await inbound.next();
    if (next.done) {
      throw new Error(`plugin closed stdout while waiting for ${label}`);
    }
    const message = next.value as Record<string, unknown>;
    if (match(message)) {
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
