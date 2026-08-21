import {
  type CompletedDownload,
  type PluginContext,
  runUiPlugin,
  type SurfaceSession,
  UiPlugin,
} from "@ora-space/ui-plugin-base";
import { handleDownloadCompleted } from "./handlers/downloads.ts";

/** Must match `ora.id` in package.json. */
const PLUGIN_ID = "ora-space.huawei-agent-center";

/**
 * Embeds Huawei Agent Center as a remote-site Surface and inspects the archives Ora
 * saves from it. Navigation and downloads are handled by the host; this
 * process only learns about sessions and finished downloads.
 */
class HuaweiAgentCenterUiPlugin extends UiPlugin {
  override onActivate(context: PluginContext): void {
    console.info(`${context.pluginId} activated`);
  }

  override onSurfaceOpened = (session: SurfaceSession): void => {
    console.info(`surface ${session.surfaceId}#${session.instanceId} opened`);
  };

  override onSurfaceClosed = (session: SurfaceSession): void => {
    console.info(`surface ${session.surfaceId}#${session.instanceId} closed`);
  };

  override onDownloadCompleted = (
    session: SurfaceSession,
    download: CompletedDownload,
  ): void => handleDownloadCompleted(session, download);
}

await runUiPlugin(new HuaweiAgentCenterUiPlugin(), {
  pluginId: PLUGIN_ID,
  sources: ["remoteSite"],
});
