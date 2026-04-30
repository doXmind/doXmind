"use client";

import { useEffect } from "react";
import { CheckCircle2, Download, Loader2, AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useMarkerStore } from "@/stores/marker-store";

function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

/**
 * Settings → "Offline OCR engine" section.
 *
 * Lets the user pre-install Marker's ~2GB Surya weights so the next
 * scanned PDF (or "Import with OCR" click) doesn't have to wait. We
 * deliberately delegate the actual download UX to the existing global
 * `MarkerDownloadPrompt` modal — clicking Install just opens the
 * prompt with `reason: "settings"`. That keeps progress / error /
 * cancel logic in one place.
 */
export function OcrEngineSection() {
  const t = useTranslations("settings");

  const status = useMarkerStore((s) => s.status);
  const error = useMarkerStore((s) => s.error);
  const phase = useMarkerStore((s) => s.phase);
  const bytesDownloaded = useMarkerStore((s) => s.bytesDownloaded);
  const bytesTotalEstimate = useMarkerStore((s) => s.bytesTotalEstimate);
  const refreshStatus = useMarkerStore((s) => s.refreshStatus);
  const openInstallPrompt = useMarkerStore((s) => s.openInstallPrompt);

  // Pull the live state on mount so the button reflects what the
  // backend actually says, not the stale store default.
  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const isInstalled = status === "installed";
  const isDownloading = status === "downloading";
  const isError = status === "error";

  const pct = isDownloading
    ? Math.min(
        99,
        Math.max(2, Math.round((bytesDownloaded / Math.max(1, bytesTotalEstimate)) * 100))
      )
    : isInstalled
      ? 100
      : 0;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">{t("ocrSection")}</h2>
      <div className="space-y-3 rounded-lg border border-border/40 bg-card p-4">
        <p className="text-sm text-muted-foreground">{t("ocrSectionDescription")}</p>

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            {isInstalled && (
              <>
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <span className="text-foreground">{t("ocrInstalled")}</span>
              </>
            )}
            {isDownloading && (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-muted-foreground">{t("ocrDownloading")}</span>
              </>
            )}
            {isError && (
              <>
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <span className="text-muted-foreground">
                  {t("ocrError", { error: error ?? "—" })}
                </span>
              </>
            )}
            {!isInstalled && !isDownloading && !isError && (
              <span className="text-muted-foreground">—</span>
            )}
          </div>

          {!isInstalled && (
            <Button
              size="sm"
              onClick={openInstallPrompt}
              disabled={isDownloading}
              className="gap-2"
            >
              <Download className="h-3.5 w-3.5" />
              {isError ? t("ocrRetry") : t("ocrInstall")}
            </Button>
          )}
        </div>

        {isDownloading && (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate text-muted-foreground">{phase ?? "preparing"}</span>
              <span className="shrink-0 tabular-nums text-foreground">
                {formatBytes(bytesDownloaded)} / {formatBytes(bytesTotalEstimate)} · {pct}%
              </span>
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
      </div>
    </section>
  );
}
