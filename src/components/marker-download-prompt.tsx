"use client";

import { useEffect } from "react";
import { Download, AlertTriangle, Loader2, CheckCircle2 } from "lucide-react";
import { Modal, ModalHeader, ModalFooter } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useMarkerStore } from "@/stores/marker-store";

/**
 * One-time prompt for the offline OCR model download (~2GB).
 *
 * Mounted globally in providers.tsx. Visibility is driven entirely by
 * useMarkerStore.promptOpen — file-store.importFile flips it open when
 * a scanned PDF needs the Marker fallback and the weights aren't local.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

export function MarkerDownloadPrompt() {
  const promptOpen = useMarkerStore((s) => s.promptOpen);
  const promptReason = useMarkerStore((s) => s.promptReason);
  const status = useMarkerStore((s) => s.status);
  const phase = useMarkerStore((s) => s.phase);
  const error = useMarkerStore((s) => s.error);
  const bytesDownloaded = useMarkerStore((s) => s.bytesDownloaded);
  const bytesTotalEstimate = useMarkerStore((s) => s.bytesTotalEstimate);
  const queue = useMarkerStore((s) => s.queue);
  const confirmDownload = useMarkerStore((s) => s.confirmDownload);
  const dismiss = useMarkerStore((s) => s.dismiss);
  const refreshStatus = useMarkerStore((s) => s.refreshStatus);

  // If the prompt opens for any reason (queued import on a fresh boot,
  // user reopens after a transient error, etc.) make sure we read the
  // latest state from the backend before rendering buttons.
  useEffect(() => {
    if (promptOpen) {
      void refreshStatus();
    }
  }, [promptOpen, refreshStatus]);

  const isDownloading = status === "downloading";
  const isInstalled = status === "installed";
  const isError = status === "error";

  const pct = isDownloading
    ? Math.min(
        99,
        Math.max(2, Math.round((bytesDownloaded / Math.max(1, bytesTotalEstimate)) * 100))
      )
    : isInstalled
      ? 100
      : 0;

  const queuedNames = queue.map((q) => q.file.name);

  return (
    <Modal open={promptOpen} onClose={isDownloading ? () => {} : dismiss}>
      <ModalHeader onClose={isDownloading ? undefined : dismiss}>
        <span className="flex items-center gap-2">
          <Download className="h-5 w-5 text-primary" />
          {isInstalled ? "OCR engine ready" : "Download offline OCR engine"}
        </span>
      </ModalHeader>

      <div className="space-y-3 text-sm text-muted-foreground">
        {!isInstalled && !isError && !isDownloading && (
          <>
            <p>
              {promptReason === "explicit" &&
                "Import with OCR uses the Marker + Surya pipeline — better tables, math and multi-column layouts than the default fast path."}
              {promptReason === "fallback" &&
                "This PDF looks scanned or image-heavy, so the fast path couldn't extract its text. The Marker + Surya pipeline can OCR it."}
              {promptReason === "settings" &&
                "Pre-install the offline OCR engine so the next scanned PDF or Import-with-OCR runs without waiting."}
            </p>
            <p>
              It weighs about <span className="font-medium text-foreground">2 GB</span> and
              downloads once. Models stay on your machine — nothing is uploaded.
            </p>
            {queuedNames.length > 0 && (
              <div className="rounded-md border border-border bg-muted/40 p-3">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Will retry after install
                </div>
                <ul className="mt-1 space-y-0.5 text-foreground">
                  {queuedNames.map((name, i) => (
                    <li key={`${name}-${i}`} className="truncate">
                      {name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {isDownloading && (
          <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
            <div className="flex items-start gap-3">
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2 text-foreground">
                  <span>Downloading models…</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatBytes(bytesDownloaded)} / {formatBytes(bytesTotalEstimate)} · {pct}%
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {phase ?? "preparing"} — first run only, you can keep working in the editor.
                </div>
              </div>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full bg-primary transition-[width] duration-700 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {isInstalled && (
          <div className="flex items-start gap-3 rounded-md border border-border bg-muted/40 p-3">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            <div>
              <div className="text-foreground">Models installed.</div>
              <div className="text-xs text-muted-foreground">
                {queue.length > 0 ? "Retrying queued imports…" : "Ready for OCR imports."}
              </div>
            </div>
          </div>
        )}

        {isError && (
          <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div>
              <div className="text-foreground">Download failed.</div>
              <div className="break-all text-xs text-muted-foreground">
                {error ?? "Unknown error"}
              </div>
            </div>
          </div>
        )}
      </div>

      <ModalFooter>
        {isDownloading ? (
          <Button variant="outline" disabled>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Downloading…
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={dismiss}>
              {isError ? "Close" : "Not now"}
            </Button>
            {!isInstalled && (
              <Button onClick={confirmDownload}>
                <Download className="mr-2 h-4 w-4" />
                {isError ? "Retry download" : "Download (~2 GB)"}
              </Button>
            )}
          </>
        )}
      </ModalFooter>
    </Modal>
  );
}
