import type { JsonValue } from "@ora-space/plugin-sdk";
import {
  type PluginContext,
  runUiPlugin,
  type SurfaceSession,
  UiPlugin,
} from "@ora-space/ui-plugin-base";
import { PanelRequests } from "./handlers/requests.ts";

/** Must match `ora.id` in package.json. */
const PLUGIN_ID = "ora-space.hello-panel";

/**
 * A package-shipped panel whose buttons round-trip through this process.
 *
 * The page (`ui/`) is a view only: the counter and the stopwatch live here,
 * answers carry the whole state, and ticks are pushed with `host.push`. The
 * sample exists to show the three links of the bridge — page → host →
 * process → host → page — with as little business logic as possible.
 */
class HelloPanelPlugin extends UiPlugin {
  #requests: PanelRequests | undefined;

  override onActivate(context: PluginContext): void {
    // `host` is attached before activation, so the handler module can own it.
    this.#requests = new PanelRequests(this.host);
    console.info(`${context.pluginId} activated`);
  }

  override onDeactivate(): void {
    this.#requests?.dispose();
  }

  override onSurfaceOpened = (session: SurfaceSession): void => {
    console.info(`surface ${session.surfaceId}#${session.instanceId} opened`);
  };

  override onSurfaceClosed = (session: SurfaceSession): void => {
    this.#requests?.forget(session);
    console.info(`surface ${session.surfaceId}#${session.instanceId} closed`);
  };

  override onRequest = (
    session: SurfaceSession,
    payload: JsonValue,
  ): JsonValue => {
    if (this.#requests === undefined) {
      throw new Error("plugin received a request before activation");
    }
    return { ...this.#requests.handle(session, payload) };
  };
}

await runUiPlugin(new HelloPanelPlugin(), {
  pluginId: PLUGIN_ID,
  sources: ["panel"],
});
