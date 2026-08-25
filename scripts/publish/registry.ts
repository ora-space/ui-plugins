/**
 * Derives a marketplace registry entry from the manifest shipped inside a
 * release archive.
 *
 * The desktop parses registry manifests with `ora-plugin-manifest`'s release
 * form: the installed manifest's fields plus mandatory `resolver`, `url` and
 * `sha256`, with unknown fields rejected. So the entry is the package
 * manifest, re-serialised, with only those three fields added or replaced —
 * never hand-edited and never carrying fields the package does not have.
 */
import {
  parse as parseToml,
  stringify as stringifyToml,
} from "jsr:@std/toml@1";

/** Fields the release form requires; missing ones fail before any PR is made. */
const REQUIRED_FIELDS = [
  "resolver",
  "name",
  "namespace",
  "kind",
  "version",
  "description",
  "url",
  "sha256",
] as const;

/** Fields the release form accepts (`deny_unknown_fields` on the desktop side). */
const KNOWN_FIELDS = new Set<string>([
  ...REQUIRED_FIELDS,
  "homepage",
  "license",
  "head",
  "dependencies",
  "workbench",
  "webview",
]);

/** Hosts the released `.orax` on GitHub; the desktop only accepts https. */
const HTTPS_PREFIX = "https://";

/** Returns the release-form TOML for `packageManifest` pointing at `url`. */
export function deriveRegistryManifest(
  packageManifest: string,
  release: { url: string; sha256: string },
): string {
  const parsed = parseToml(packageManifest) as Record<string, unknown>;
  // Scalars first so the file reads like the package manifest; tables follow
  // because a top-level scalar after a `[table]` header would belong to it.
  const entry: Record<string, unknown> = {
    resolver: typeof parsed.resolver === "number" ? parsed.resolver : 1,
  };
  for (const [key, value] of Object.entries(parsed)) {
    if (key === "resolver" || key === "url" || key === "sha256") continue;
    if (typeof value !== "object" || value === null) entry[key] = value;
  }
  entry.url = release.url;
  entry.sha256 = release.sha256;
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "object" && value !== null) entry[key] = value;
  }
  validateRegistryManifest(entry);
  return stringifyToml(entry);
}

/** Mirrors the desktop's structural rules so a bad entry fails locally. */
export function validateRegistryManifest(entry: Record<string, unknown>): void {
  for (const field of REQUIRED_FIELDS) {
    if (entry[field] === undefined) {
      throw new Error(`registry manifest: missing required field ${field}`);
    }
  }
  for (const key of Object.keys(entry)) {
    if (!KNOWN_FIELDS.has(key)) {
      throw new Error(`registry manifest: unknown field ${key}`);
    }
  }
  if (entry.resolver !== 1) {
    throw new Error(
      `registry manifest: unsupported resolver ${entry.resolver}`,
    );
  }
  if (typeof entry.url !== "string" || !entry.url.startsWith(HTTPS_PREFIX)) {
    throw new Error("registry manifest: url must be an https URL");
  }
  if (
    typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256)
  ) {
    throw new Error(
      "registry manifest: sha256 must be 64 lowercase hex digits",
    );
  }
  const kind = entry.kind;
  if (kind === "webview" && entry.webview === undefined) {
    throw new Error(
      "registry manifest: kind webview requires a [webview] table",
    );
  }
  if (kind !== "webview" && entry.webview !== undefined) {
    throw new Error(
      `registry manifest: [webview] is not allowed for kind ${kind}`,
    );
  }
  if (kind !== "workbench" && entry.workbench !== undefined) {
    throw new Error(
      `registry manifest: [workbench] is not allowed for kind ${kind}`,
    );
  }
}

/** Registry path of an entry: `registry/<first letter of name>/<name>`. */
export function registryEntryPath(name: string): string[] {
  return ["registry", name[0], name];
}
