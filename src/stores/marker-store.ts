/**
 * Marker (offline OCR) lifecycle store.
 *
 * Owns the state of the one-time ~2GB Surya weights download. The flow:
 *
 *   1. file-store.importFile() catches an `ImportError` with code
 *      `MARKER_MODELS_REQUIRED` and calls `enqueueImport()`.
 *   2. We push the file onto a retry queue and open the prompt modal.
 *   3. If the user confirms, `confirmDownload()` POSTs to the backend
 *      and starts polling status every 2s.
 *   4. When status flips to "installed", we drain the queue by
 *      re-invoking file-store.importFile() (the second attempt won't
 *      hit MARKER_MODELS_REQUIRED, since the models are now there).
 *   5. If the user dismisses, the queue is cleared and the in-flight
 *      import is treated as cancelled.
 *
 * We deliberately don't try to recover Marker's tqdm-driven download
 * progress as a real fraction — HF Hub doesn't surface that cleanly
 * without monkey-patching. Instead we show the backend's ``phase``
 * string ("loading layout + ocr models", "warming pipeline", ...) so
 * the user knows something is still happening.
 */

import { create } from "zustand";
import { api } from "@/lib/api";
import type { ImportMode } from "@/lib/api/files";
import type { MarkerStatus } from "@/lib/api/marker";
import { storeLogger } from "@/lib/logger";

const log = storeLogger.child("Marker");

// Snappier than 2s — during an active download we want the bar to
// advance frequently. The /status endpoint just serializes a dict, so
// 1Hz is essentially free.
const POLL_INTERVAL_MS = 1000;

export type PendingImport = {
  file: File;
  parentId?: string | null;
  options?: { silent?: boolean; mode?: ImportMode };
};

/**
 * Why the prompt is currently open. Drives the modal copy:
 *   "fallback" — auto router decided this PDF needs OCR; user is being
 *                informed after the fact.
 *   "explicit" — user clicked "Import with OCR…"; this is the path
 *                they asked for.
 *   "settings" — user opened Settings → Install offline OCR; no import
 *                is queued, just a pre-warm download.
 */
export type MarkerPromptReason = "fallback" | "explicit" | "settings";

interface MarkerStoreState {
  promptOpen: boolean;
  promptReason: MarkerPromptReason | null;
  status: MarkerStatus["status"];
  phase: string | null;
  error: string | null;
  bytesDownloaded: number;
  bytesTotalEstimate: number;
  queue: PendingImport[];

  enqueueImport: (item: PendingImport) => void;
  /** Open the prompt without queueing an import — used by Settings. */
  openInstallPrompt: () => void;
  refreshStatus: () => Promise<void>;
  confirmDownload: () => Promise<void>;
  dismiss: () => void;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollAbort: AbortController | null = null;

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (pollAbort) {
    pollAbort.abort();
    pollAbort = null;
  }
}

async function drainQueue(
  get: () => MarkerStoreState,
  set: (partial: Partial<MarkerStoreState>) => void
) {
  const queue = get().queue;
  if (queue.length === 0) return;

  // Late-bound to avoid a circular import: file-store imports api which
  // imports the marker-store transitively via prompt mounting.
  const { useFileStore } = await import("@/stores/file-store");
  const importFile = useFileStore.getState().importFile;

  set({ queue: [] });
  for (const item of queue) {
    try {
      await importFile(item.file, item.parentId, item.options);
    } catch (e) {
      log.error(`Retry import failed for ${item.file.name}`, e);
    }
  }
}

export const useMarkerStore = create<MarkerStoreState>((set, get) => ({
  promptOpen: false,
  promptReason: null,
  status: "idle",
  phase: null,
  error: null,
  bytesDownloaded: 0,
  bytesTotalEstimate: 2_000_000_000,
  queue: [],

  enqueueImport: (item) => {
    // If the user explicitly chose "Import with OCR" we tell the modal
    // to use the more direct copy. Otherwise this is the auto router's
    // fallback path and we explain *why* OCR is now being asked for.
    const reason: MarkerPromptReason = item.options?.mode === "ocr" ? "explicit" : "fallback";
    set((state) => ({
      promptOpen: true,
      promptReason: state.promptReason ?? reason,
      queue: [...state.queue, item],
    }));
    // Prime the modal with a fresh status read, so we don't show "idle"
    // when the backend has actually been downloading from a prior run.
    void get().refreshStatus();
  },

  openInstallPrompt: () => {
    set({ promptOpen: true, promptReason: "settings" });
    void get().refreshStatus();
  },

  refreshStatus: async () => {
    try {
      const status = await api.getMarkerStatus();
      set({
        status: status.status,
        phase: status.phase,
        error: status.error,
        bytesDownloaded: status.bytes_downloaded,
        bytesTotalEstimate: status.bytes_total_estimate,
      });
      if (status.status === "installed") {
        stopPolling();
        await drainQueue(get, set);
        // Auto-close the modal once the queue is drained — there is
        // nothing left for the user to do.
        if (get().queue.length === 0) {
          set({ promptOpen: false, promptReason: null });
        }
      } else if (status.status === "error") {
        stopPolling();
      }
    } catch (e) {
      log.error("Failed to read marker status", e);
    }
  },

  confirmDownload: async () => {
    set({ error: null, status: "downloading", phase: "starting" });
    try {
      await api.triggerMarkerDownload();
    } catch (e) {
      log.error("Failed to trigger marker download", e);
      set({ status: "error", error: (e as Error).message });
      return;
    }
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      void get().refreshStatus();
    }, POLL_INTERVAL_MS);
  },

  dismiss: () => {
    stopPolling();
    set({ promptOpen: false, promptReason: null, queue: [] });
  },
}));
