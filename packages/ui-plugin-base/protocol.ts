import { type JsonValue, PluginMethodError } from "@ora-space/plugin-sdk";

/** Contract version this base class implements; the manifest must declare it. */
export const UI_CONTRACT_VERSION = 1;
/** Host → plugin notification: one Surface instance became visible. */
export const UI_SURFACE_OPENED = "ui/surfaceOpened";
/** Host → plugin notification: one Surface instance was torn down. */
export const UI_SURFACE_CLOSED = "ui/surfaceClosed";
/** Host → plugin request: a file landed in this plugin's data directory. */
export const UI_DOWNLOAD_COMPLETED = "ui/downloadCompleted";
/** Host → plugin request: a panel page sent one payload through the bridge. */
export const UI_REQUEST = "ui/request";
/** Plugin → host notification: push one payload to a panel page. */
export const UI_PUSH = "ui/push";
/** JSON-RPC code the host expects for malformed params. */
export const INVALID_PARAMS = -32602;
/** JSON-RPC code for a request the plugin does not serve. */
export const METHOD_NOT_FOUND = -32601;

/**
 * The content source of a declared Surface, mirroring `source.kind` in the
 * manifest. Each kind implies the methods the host requires at handshake:
 * `remoteSite` → `ui/downloadCompleted`, `panel` → `ui/request`.
 */
export type SurfaceSourceKind = "remoteSite" | "panel";

/**
 * Identifies one Surface instance served by one host process generation.
 *
 * All three fields are needed for identity: instance ids restart with the host
 * process, so `generation` disambiguates a reused id after a restart.
 */
export interface SurfaceSession {
  readonly surfaceId: string;
  readonly instanceId: number;
  readonly generation: number;
}

/** Describes a download the host already stored in the plugin data directory. */
export interface CompletedDownload {
  readonly id: number;
  /** URL of the page that triggered the download, or null when unknown. */
  readonly pageUrl: string | null;
  readonly sourceUrl: string;
  /** Final, sanitized and uniquified file name. */
  readonly fileName: string;
  /** Absolute path inside `<data-dir>/downloads/`. */
  readonly path: string;
  readonly sizeBytes: number;
  /** Local-time RFC 3339 timestamp. */
  readonly completedAt: string;
}

/**
 * Validates the session fields shared by every ui contract message.
 *
 * The host is trusted to send well-formed params, but a mismatch between
 * host and plugin versions must surface as a clear `-32602` instead of an
 * `undefined` propagating into plugin code.
 */
export function parseSurfaceSession(params: JsonValue): SurfaceSession {
  const record = asRecord(params, "params");
  return {
    surfaceId: readString(record, "surfaceId"),
    instanceId: readNumber(record, "instanceId"),
    generation: readNumber(record, "generation"),
  };
}

/** Validates `ui/downloadCompleted` params into session and download halves. */
export function parseDownloadCompleted(
  params: JsonValue,
): { session: SurfaceSession; download: CompletedDownload } {
  const session = parseSurfaceSession(params);
  const record = asRecord(params, "params");
  const download = asRecord(record.download ?? null, "download");
  const pageUrl = download.pageUrl ?? null;
  if (pageUrl !== null && typeof pageUrl !== "string") {
    throw invalid("download.pageUrl must be a string or null");
  }
  return {
    session,
    download: {
      id: readNumber(download, "id"),
      pageUrl,
      sourceUrl: readString(download, "sourceUrl"),
      fileName: readString(download, "fileName"),
      path: readString(download, "path"),
      sizeBytes: readNumber(download, "sizeBytes"),
      completedAt: readString(download, "completedAt"),
    },
  };
}

/**
 * Validates `ui/request` params into the session and the opaque payload.
 *
 * The payload is whatever the panel page sent; it is passed through untouched
 * (including `null` when absent) because its shape is the plugin's own protocol.
 */
export function parseRequest(
  params: JsonValue,
): { session: SurfaceSession; payload: JsonValue } {
  const session = parseSurfaceSession(params);
  const record = asRecord(params, "params");
  return { session, payload: record.payload ?? null };
}

function asRecord(
  value: JsonValue,
  label: string,
): Record<string, JsonValue> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid(`${label} must be an object`);
  }
  return value;
}

function readString(record: Record<string, JsonValue>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw invalid(`${key} must be a string`);
  }
  return value;
}

function readNumber(record: Record<string, JsonValue>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalid(`${key} must be a number`);
  }
  return value;
}

function invalid(message: string): PluginMethodError {
  return new PluginMethodError(INVALID_PARAMS, message);
}
