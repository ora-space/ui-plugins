/**
 * Public surface of the UI plugin base package.
 *
 * Plugins import only this module so the internal file layout can change
 * without touching every plugin in the workspace.
 */
export {
  type CompletedDownload,
  INVALID_PARAMS,
  METHOD_NOT_FOUND,
  parseDownloadCompleted,
  parseRequest,
  parseSurfaceSession,
  type SurfaceSession,
  type SurfaceSourceKind,
  UI_CONTRACT_VERSION,
  UI_DOWNLOAD_COMPLETED,
  UI_PUSH,
  UI_REQUEST,
  UI_SURFACE_CLOSED,
  UI_SURFACE_OPENED,
} from "./protocol.ts";
export {
  type PluginContext,
  runUiPlugin,
  UI_METHOD_ROUTES,
  UI_NOTIFICATION_ROUTES,
  type UiHost,
  UiPlugin,
} from "./ui-plugin.ts";
export { SurfaceSessionRegistry } from "./session.ts";
export { protectProtocolStdout } from "./stdout.ts";
