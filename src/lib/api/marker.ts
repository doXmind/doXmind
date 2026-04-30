/**
 * Marker (offline OCR / layout) lifecycle API.
 *
 * Backend lives at /api/import/marker. The frontend hits these endpoints
 * to check whether the ~2GB Surya weights have been downloaded and to
 * trigger / poll the one-time download.
 */

import { ApiClient } from "./client";

export type MarkerStatus = {
  status: "idle" | "downloading" | "installed" | "error";
  installed: boolean;
  phase: string | null;
  started_at: number | null;
  finished_at: number | null;
  installed_at: number | null;
  error: string | null;
  /** Bytes the HF cache has grown by since the download started. */
  bytes_downloaded: number;
  /** Best-effort total used as the progress bar denominator. */
  bytes_total_estimate: number;
  marker_version: string;
};

declare module "./client" {
  interface ApiClient {
    getMarkerStatus(signal?: AbortSignal): Promise<MarkerStatus>;
    triggerMarkerDownload(): Promise<MarkerStatus>;
  }
}

ApiClient.prototype.getMarkerStatus = async function (this: ApiClient, signal?: AbortSignal) {
  return this.request<MarkerStatus>("/api/import/marker/status", {
    method: "GET",
    cache: "no-store",
    signal,
  });
};

ApiClient.prototype.triggerMarkerDownload = async function (this: ApiClient) {
  return this.request<MarkerStatus>("/api/import/marker/download", {
    method: "POST",
  });
};
