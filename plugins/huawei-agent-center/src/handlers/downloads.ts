import type {
  CompletedDownload,
  SurfaceSession,
} from "@ora-space/ui-plugin-base";

/**
 * Serves `ui/downloadCompleted`.
 *
 * The host has already stored the file inside this plugin's data directory;
 * the only decision taken here today is whether it looks like a skill
 * archive. The verdict is logged and otherwise ignored so that a wrong guess
 * never loses the user's file. Installation comes later.
 */
export function handleDownloadCompleted(
  session: SurfaceSession,
  download: CompletedDownload,
): void {
  const verdict = isZipArchive(download.fileName) ? "zip" : "not-zip";
  console.info(
    `download ${download.id} (${download.fileName}, ${download.sizeBytes} bytes) from ${
      download.pageUrl ?? "unknown page"
    } via surface ${session.surfaceId}#${session.instanceId}: ${verdict}`,
  );
}

/** Checks the lowercase extension only; the host already sanitized the name. */
export function isZipArchive(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".zip");
}
