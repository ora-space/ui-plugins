import type { FrameJson } from "./frames.ts";

/** One file the fake data directory holds, keyed by its logical path. */
export interface StoredFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** Mirrors the host's per-file read ceiling so a plugin sees `too_large` here too. */
const MAX_READ_BYTES = 8 * 1024 * 1024;

const STORAGE_METHODS = new Set([
  "ora/storage/list",
  "ora/storage/read",
  "ora/storage/write",
  "ora/storage/remove",
]);

/**
 * A storage failure rendered the way Ora renders it: a JSON-RPC error whose
 * `data.kind` is the stable classification the SDK exposes as
 * `HostRequestError.kind`.
 */
export class StorageFault extends Error {
  readonly kind: string;
  readonly code: number;

  constructor(kind: string, code: number, message: string) {
    super(message);
    this.name = "StorageFault";
    this.kind = kind;
    this.code = code;
  }
}

/**
 * In-memory stand-in for the plugin data directory Ora serves through
 * `ora/storage/*`.
 *
 * Plugins never touch the filesystem, so the simulator does not need one
 * either: files staged with `put` are what the plugin reads back, and every
 * logical path the plugin asked for is recorded in `reads` so a scenario can
 * assert the plugin used the path from the notification instead of guessing.
 * Directories are implicit, derived from the file paths, as on disk.
 */
export class FakeStorage {
  readonly #files = new Map<string, Uint8Array>();
  /** Logical paths passed to `ora/storage/read`, in call order. */
  readonly reads: string[] = [];

  /** Stages one file; parent directories exist implicitly. */
  put(path: string, bytes: Uint8Array): void {
    this.#files.set(normalize(path), bytes);
  }

  /** Returns the staged file at `path`, if any. */
  get(path: string): Uint8Array | undefined {
    return this.#files.get(normalize(path));
  }

  /** Whether `method` is one this fake serves. */
  static serves(method: string): boolean {
    return STORAGE_METHODS.has(method);
  }

  /** Answers one `ora/storage/*` request with the host's wire shapes. */
  handle(method: string, params: FrameJson): FrameJson {
    const record = isRecord(params) ? params : {};
    if (typeof record.path !== "string") {
      throw new StorageFault("invalid_params", -32602, "missing string path");
    }
    const path = validatePath(record.path);
    switch (method) {
      case "ora/storage/list":
        return { entries: this.#list(path) };
      case "ora/storage/read": {
        this.reads.push(path);
        const bytes = this.#files.get(path);
        if (bytes === undefined) {
          throw new StorageFault("not_found", -32004, `${path} does not exist`);
        }
        if (bytes.byteLength > MAX_READ_BYTES) {
          throw new StorageFault("too_large", -32005, `${path} is too large`);
        }
        return { bytes_base64: encodeBase64(bytes) };
      }
      case "ora/storage/write": {
        if (typeof record.bytes_base64 !== "string") {
          throw new StorageFault(
            "invalid_params",
            -32602,
            "missing string bytes_base64",
          );
        }
        this.#files.set(path, decodeBase64(record.bytes_base64));
        return null;
      }
      case "ora/storage/remove": {
        const prefix = `${path}/`;
        let removed = this.#files.delete(path);
        for (const key of [...this.#files.keys()]) {
          if (key.startsWith(prefix)) {
            this.#files.delete(key);
            removed = true;
          }
        }
        if (!removed) {
          throw new StorageFault("not_found", -32004, `${path} does not exist`);
        }
        return null;
      }
      default:
        throw new StorageFault(
          "method_not_found",
          -32601,
          `unknown method ${method}`,
        );
    }
  }

  /** Lists the direct children of `path`; `""` is the data directory itself. */
  #list(path: string): FrameJson[] {
    const prefix = path === "" ? "" : `${path}/`;
    const entries = new Map<string, FrameJson>();
    for (const [key, bytes] of this.#files) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash === -1) {
        entries.set(rest, {
          name: rest,
          kind: "file",
          size_bytes: bytes.byteLength,
        });
      } else {
        const name = rest.slice(0, slash);
        entries.set(name, { name, kind: "directory", size_bytes: 0 });
      }
    }
    if (path !== "" && entries.size === 0 && !this.#files.has(path)) {
      throw new StorageFault("not_found", -32004, `${path} does not exist`);
    }
    return [...entries.keys()].sort().map((name) => entries.get(name)!);
  }
}

/** Applies the host's path rules: relative, portable, no `..`, no web-profile. */
function validatePath(path: string): string {
  const normalized = normalize(path);
  const segments = normalized === "" ? [] : normalized.split("/");
  const invalid = path.startsWith("/") || /^[A-Za-z]:/.test(path) ||
    path.includes("\\") ||
    segments.some((segment) => segment === "" || segment === "..");
  if (invalid) {
    throw new StorageFault("invalid_path", -32602, `${path} is not allowed`);
  }
  if (segments[0] === "web-profile") {
    throw new StorageFault(
      "invalid_path",
      -32602,
      "web-profile is owned by the host",
    );
  }
  return normalized;
}

function normalize(path: string): string {
  return path.replace(/^\.\//, "").replace(/\/+$/, "");
}

function isRecord(value: FrameJson): value is { [key: string]: FrameJson } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
