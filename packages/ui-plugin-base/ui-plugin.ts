import { createPlugin } from "@ora-space/plugin-sdk";
import {
  type CompletedDownload,
  parseDownloadCompleted,
  parseSurfaceSession,
  type SurfaceSession,
  UI_DOWNLOAD_COMPLETED,
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
}

/**
 * Maps class methods onto the JSON-RPC requests the Ora host invokes.
 *
 * The wire names are fixed by the host contract, so the mapping is explicit:
 * a renamed method would otherwise silently stop serving its request.
 */
export const UI_METHOD_ROUTES = {
  onDownloadCompleted: UI_DOWNLOAD_COMPLETED,
} as const;

/** Maps class methods onto the host notifications they consume. */
export const UI_NOTIFICATION_ROUTES = {
  onSurfaceOpened: UI_SURFACE_OPENED,
  onSurfaceClosed: UI_SURFACE_CLOSED,
} as const;

/**
 * Base class for a `kind: "ui"` plugin, exposing ui contract version 1.
 *
 * Required APIs are `abstract` so the compiler rejects an incomplete plugin,
 * while optional APIs ship a no-op default. Each method may also be mounted
 * as a field (`override onDownloadCompleted = handleDownloadCompleted`) so a
 * plugin can keep handlers in separate modules.
 */
export abstract class UiPlugin {
  readonly type = "ui";

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
   * directory. Required: it is the only reason a remoteSite plugin runs.
   */
  abstract onDownloadCompleted(
    session: SurfaceSession,
    download: CompletedDownload,
  ): void | Promise<void>;
}

/** One entry of the flattened dispatch table, bound to its plugin instance. */
type BoundHandler = (...args: never[]) => unknown;

/**
 * Serves one UI plugin instance until the host shuts the process down.
 *
 * The instance is flattened into a wire-name keyed table so dispatch never
 * walks the prototype chain, then wired onto the SDK. Every handler passes
 * through the session registry so per-session order matches wire order.
 */
export async function runUiPlugin(
  plugin: UiPlugin,
  context: PluginContext,
): Promise<void> {
  const routes = flattenRoutes(plugin);
  protectProtocolStdout();
  await plugin.onActivate(context);

  const sessions = new SurfaceSessionRegistry();
  const sdk = createPlugin();
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
  sdk.registerMethod(UI_DOWNLOAD_COMPLETED, async (params) => {
    const { session, download } = parseDownloadCompleted(params);
    await sessions.run(
      session,
      () => invoke(routes, UI_DOWNLOAD_COMPLETED, session, download),
    );
    return {};
  });

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

/** Walks the prototype chain once, returning names of callable members. */
function collectCallableNames(instance: object): Set<string> {
  const names = new Set<string>();
  const source = instance as Record<string, unknown>;
  let current: object | null = instance;
  while (current !== null && current !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(current)) {
      if (name !== "constructor" && typeof source[name] === "function") {
        names.add(name);
      }
    }
    current = Object.getPrototypeOf(current);
  }
  return names;
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
