/**
 * Host-side test harness for Ora UI plugins.
 *
 * Plugin runtime code lives in `@ora-space/plugin-sdk`
 * (`defineWorkbenchPlugin`, `createStorage`); this package only plays Ora's
 * side of the protocol so a plugin can be driven end to end from a simulator
 * script. Plugins import only this module so the internal layout can change
 * without touching them.
 */
export { FakeStorage, type StoredFile } from "./storage.ts";
export {
  type LaunchOptions,
  PluginRequestError,
  type Registration,
  WorkbenchHostDriver,
  type WorkbenchSurface,
} from "./host-driver.ts";
export { decodeFrames, encodeFrame, type FrameJson } from "./frames.ts";
