"use client";

import { useEffect } from "react";
import { AlertTriangle, CheckCircle2, Download, Loader2, ScanText } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMarkerStore } from "@/stores/marker-store";
import { cn } from "@/lib/utils";

/** "1.34 GB" / "684 MB" — 1000-based to match what the OS / HF report. */
function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

/**
 * Welcome-screen secondary row that surfaces the offline OCR engine.
 *
 * Replaces the "OCR is hidden in the sidebar dropdown" problem: a new
 * user can see — at the very first screen — whether the OCR engine is
 * installed, install it without leaving the page, and once installed
 * use it to import a scanned PDF.
 *
 * Click semantics:
 *   - status idle / error → fire ``confirmDownload()`` directly. The
 *     row's "Install (~2 GB)" / "Retry" label is the disclosure; we
 *     don't open the heavier MarkerDownloadPrompt modal because that
 *     would just be a second confirm with the same numbers.
 *   - status installed → call ``onUseOcr()`` so the parent can open
 *     a .pdf-only file picker that runs the import in mode="ocr".
 *   - status downloading → no-op (the row already shows progress).
 */
export function WelcomeOcrRow({ onUseOcr }: { onUseOcr: () => void }) {
  const t = useTranslations("welcome");

  const status = useMarkerStore((s) => s.status);
  const phase = useMarkerStore((s) => s.phase);
  const error = useMarkerStore((s) => s.error);
  const bytesDownloaded = useMarkerStore((s) => s.bytesDownloaded);
  const bytesTotalEstimate = useMarkerStore((s) => s.bytesTotalEstimate);
  const refreshStatus = useMarkerStore((s) => s.refreshStatus);
  const confirmDownload = useMarkerStore((s) => s.confirmDownload);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const isInstalled = status === "installed";
  const isDownloading = status === "downloading";
  const isError = status === "error";

  const handleClick = () => {
    if (isDownloading) return;
    if (isInstalled) {
      onUseOcr();
    } else {
      // idle or error — fire and forget; status will update via polling.
      void confirmDownload();
    }
  };

  // Downloading: clamp to 99% until the install sentinel actually
  // flips. The cache watcher slightly overshoots/undershoots the real
  // total — we don't want the bar to land at 100% before the model
  // actually loads (warming pipeline phase).
  const pct = isDownloading
    ? Math.min(
        99,
        Math.max(2, Math.round((bytesDownloaded / Math.max(1, bytesTotalEstimate)) * 100))
      )
    : isInstalled
      ? 100
      : 0;

  let icon: React.ReactNode;
  let label: React.ReactNode;
  let action: string | null;
  let stateClass = "border-border/40 bg-card hover:bg-[var(--sidebar-hover)]";

  if (isInstalled) {
    icon = <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    label = t("ocrInstalledLabel");
    action = t("ocrInstalledAction");
  } else if (isDownloading) {
    icon = <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
    label = (
      <span className="flex items-baseline gap-1.5">
        <span className="text-muted-foreground">{t("ocrDownloadingLabel")}</span>
        <span className="tabular-nums text-foreground">
          {formatBytes(bytesDownloaded)} / {formatBytes(bytesTotalEstimate)}
        </span>
        {phase && <span className="truncate text-[10px] text-muted-foreground/70">· {phase}</span>}
      </span>
    );
    action = `${pct}%`;
    stateClass = "border-border/40 bg-card cursor-default";
  } else if (isError) {
    icon = <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
    label = error ? `${t("ocrErrorLabel")} — ${error}` : t("ocrErrorLabel");
    action = t("ocrErrorAction");
  } else {
    icon = <ScanText className="h-3.5 w-3.5 text-muted-foreground" />;
    label = t("ocrIdleLabel");
    action = t("ocrIdleAction");
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isDownloading}
      aria-busy={isDownloading}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={isDownloading ? pct : undefined}
      className={cn(
        "group relative flex h-9 w-full items-center gap-2 overflow-hidden rounded-md border px-2.5 text-xs transition-colors",
        "focus:outline-none focus:ring-2 focus:ring-ring/40",
        stateClass
      )}
    >
      <span className="z-10 flex shrink-0 items-center">{icon}</span>
      <span className="z-10 min-w-0 flex-1 truncate text-left text-muted-foreground">{label}</span>
      {action && (
        <span className="z-10 flex shrink-0 items-center gap-1 font-medium tabular-nums text-foreground">
          {!isInstalled && !isError && !isDownloading && <Download className="h-3 w-3" />}
          {action}
        </span>
      )}
      {/* Progress strip — Chrome-download-bar style, sits at the bottom
          edge of the button. Width animates with a CSS transition for a
          smooth fill on each /status poll tick. */}
      {isDownloading && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-muted/40"
        >
          <span
            className="block h-full bg-primary transition-[width] duration-700 ease-out"
            style={{ width: `${pct}%` }}
          />
        </span>
      )}
    </button>
  );
}
