import {
  createPlugin,
  type JsonValue,
  PluginMethodError,
} from "@ora-space/plugin-sdk";
import {
  type CompletedDownload,
  METHOD_NOT_FOUND,
  parseDownloadCompleted,
  parseRequest,
  parseSurfaceSession,
  type SurfaceSession,
  type SurfaceSourceKind,
  UI_DOWNLOAD_COMPLETED,
  UI_PUSH,
  UI_REQUEST,
  UI_SURFACE_CLOSED,
  UI_SURFACE_OPENED,
} from "./protocol.ts";
import { SurfaceSessionRegistry } from "./session.ts";
import { protectProtocolStdout } from "./stdout.ts";

/**
 * Carries the process-level facts a plugin instance may need outside any
 * Surface session. Session-scoped data travels with each contract message.
 */
export interface PluginContext {
  readonly pluginId: string;
  /**
   * The source kinds of the Surfaces this plugin declares in its manifest.
   * `runUiPlugin` registers exactly the contract methods those kinds require,
   * which is what the host checks at handshake.
   */
  readonly sources: readonly SurfaceSourceKind[];
}

/**
 * What a plugin can do towards the host on its own initiative.
 *
 * Handed to the plugin before activation so handlers in separate modules can
 * receive it as a plain argument instead of reaching for a global.
 */
export interface UiHost {
  /**
   * Pushes one payload to the panel page of `session` (`ui/push`). Best-effort:
   * the host drops pushes for closed instances or stale process generations,
   * and a page that needs consistency re-reads its state through a request.
   */
  push(session: SurfaceSession, payload: JsonValue): Promise<void>;
}

/**
 * Maps class methods onto the JSON-RPC requests the Ora host invokes.
 *
 * The wire names are fixed by the host contract, so the mapping is explicit:
 * a renamed method would otherwise silently stop serving its request.
 */
export const UI_METHOD_ROUTES = {
  onDownloadCompleted: UI_DOWNLOAD_COMPLETED,
  onRequest: UI_REQUEST,
} as const;

/** Maps class methods onto the host notifications they consume. */
export const UI_NOTIFICATION_ROUTES = {
  onSurfaceOpened: UI_SURFACE_OPENED,
  onSurfaceClosed: UI_SURFACE_CLOSED,
} as const;

/**
 * Base class for a `kind: "ui"` plugin, exposing ui contract version 1.
 *
 * Every contract API ships a default so a plugin only overrides what its
 * Surface kinds need: a remote-site plugin `onDownloadCompleted`, a panel
 * plugin `onRequest`. Each method may also be mounted as a field
 * (`override onRequest = handleRequest`) so a plugin can keep handlers in
 * separate modules.
 */
export abstract class UiPlugin {
  readonly type = "ui";
  #host: UiHost | undefined;

  /** The host-facing side of the bridge; available from `onActivate` onwards. */
  protected get host(): UiHost {
    if (this.#host === undefined) {
      throw new Error("UiPlugin.host is only available once the plugin runs");
    }
    return this.#host;
  }

  /** Wires the host before activation; called by `runUiPlugin` only. */
  attachHost(host: UiHost): void {
    this.#host = host;
  }

  /** Runs once before the plugin answers anything. */
  onActivate(_context: PluginContext): void | Promise<void> {}

  /** Runs once after the host closed the connection. */
  onDeactivate(): void | Promise<void> {}

  /** [ui/surfaceOpened] One Surface instance started. Defaults to no-op. */
  onSurfaceOpened(_session: SurfaceSession): void | Promise<void> {}

  /** [ui/surfaceClosed] One Surface instance ended. Defaults to no-op. */
  onSurfaceClosed(_session: SurfaceSession): void | Promise<void> {}

  /**
   * [ui/downloadCompleted] The host stored a file in this plugin's data
   * directory. Only invoked for remoteSite Surfaces; defaults to no-op.
   */
  onDownloadCompleted(
    _session: SurfaceSession,
    _download: CompletedDownload,
  ): void | Promise<void> {}

  /**
   * [ui/request] A panel page sent `payload` through the bridge; the returned
   * value travels back as the page's answer. Only invoked for panel Surfaces.
   * The default rejects, so a panel plugin that forgets it fails loudly on
   * the first click instead of answering `null`.
   */
  onRequest(
    _session: SurfaceSession,
    _payload: JsonValue,
  ): JsonValue | Promise<JsonValue> {
    throw new PluginMethodError(METHOD_NOT_FOUND, "ui/request is not served");
  }
}

/** One entry of the flattened dispatch table, bound to its plugin instance. */
type BoundHandler = (...args: never[]) => unknown;

/**
 * Serves one UI plugin instance until the host shuts the process down.
 *
 * The instance is flattened into a wire-name keyed table so dispatch never
 * walks the prototype chain, then wired onto the SDK. Only the methods the
 * declared Surface kinds require are registered, because the host validates
 * the registration against the manifest at handshake. Every handler passes
 * through the session registry so per-session order matches wire order.
 */
export async function runUiPlugin(
  plugin: UiPlugin,
  context: PluginContext,
): Promise<void> {
  const routes = flattenRoutes(plugin);
  protectProtocolStdout();
  const sdk = createPlugin();
  const sources = new Set(context.sources);
  if (sources.size === 0) {
    throw new Error("UI plugin must declare at least one surface source kind");
  }
  plugin.attachHost({
    push(session, payload) {
      return sdk.notify(UI_PUSH, { ...sessionParams(session), payload });
    },
  });
  await plugin.onActivate(context);

  const sessions = new SurfaceSessionRegistry();
  sdk.onNotification(UI_SURFACE_OPENED, (params) => {
    const session = parseSurfaceSession(params);
    return sessions.opened(
      session,
      () => invoke(routes, UI_SURFACE_OPENED, session),
    );
  });
  sdk.onNotification(UI_SURFACE_CLOSED, (params) => {
    const session = parseSurfaceSession(params);
    return sessions.closed(
      session,
      () => invoke(routes, UI_SURFACE_CLOSED, session),
    );
  });
  if (sources.has("remoteSite")) {
    sdk.registerMethod(UI_DOWNLOAD_COMPLETED, async (params) => {
      const { session, download } = parseDownloadCompleted(params);
      await sessions.run(
        session,
        () => invoke(routes, UI_DOWNLOAD_COMPLETED, session, download),
      );
      return {};
    });
  }
  if (sources.has("panel")) {
    // `ui/push` is declared even if the plugin never pushes: the declaration is
    // free and saves a plugin author from a confusing late failure in `host.push`.
    sdk.declareEmit(UI_PUSH);
    sdk.registerMethod(UI_REQUEST, async (params) => {
      const { session, payload } = parseRequest(params);
      let answer: JsonValue = null;
      await sessions.run(session, async () => {
        answer = await (invoke(routes, UI_REQUEST, session, payload) as
          | JsonValue
          | Promise<JsonValue>);
      });
      return { payload: answer };
    });
  }

  try {
    await sdk.run();
  } finally {
    await sessions.drain();
    await plugin.onDeactivate();
  }
}

/**
 * Collects every implemented API of one instance into a dispatch table.
 *
 * Both class methods and instance fields are scanned, because mounting a
 * handler module as a field is a supported way to organize a plugin. Own
 * properties win over inherited ones, so an override always shadows the base.
 */
function flattenRoutes(plugin: UiPlugin): Map<string, BoundHandler> {
  const routes = new Map<string, BoundHandler>();
  const implemented = collectCallableNames(plugin);
  const source = plugin as unknown as Record<string, BoundHandler>;
  for (
    const [name, method] of Object.entries({
      ...UI_METHOD_ROUTES,
      ...UI_NOTIFICATION_ROUTES,
    })
  ) {
    if (!implemented.has(name)) {
      throw new Error(
        `UI plugin does not implement ${name}, required for ${method}`,
      );
    }
    routes.set(method, source[name].bind(plugin));
  }
  return routes;
}

/**
 * Walks the prototype chain once, returning names of callable members.
 *
 * Descriptors are inspected instead of reading the property so accessors such
 * as `host` (which throws before the plugin runs) are never triggered here.
 */
function collectCallableNames(instance: object): Set<string> {
  const names = new Set<string>();
  let current: object | null = instance;
  while (current !== null && current !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, name);
      if (name !== "constructor" && typeof descriptor?.value === "function") {
        names.add(name);
      }
    }
    current = Object.getPrototypeOf(current);
  }
  return names;
}

/** Spells a session as the three wire fields every contract message carries. */
function sessionParams(
  session: SurfaceSession,
): { surfaceId: string; instanceId: number; generation: number } {
  return {
    surfaceId: session.surfaceId,
    instanceId: session.instanceId,
    generation: session.generation,
  };
}

/** Dispatches one wire method through the flattened table. */
function invoke(
  routes: Map<string, BoundHandler>,
  method: string,
  ...args: unknown[]
): unknown {
  const handler = routes.get(method);
  if (handler === undefined) {
    throw new Error(`Method '${method}' is not implemented by this plugin.`);
  }
  return handler(...(args as never[]));
}
