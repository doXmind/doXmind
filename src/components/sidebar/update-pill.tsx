"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAppUpdate } from "@/hooks/use-app-update";

/**
 * Quiet "update ready — restart" affordance above the sidebar's Settings row.
 * Appears only when the desktop shell has finished staging an update in the
 * background (Squirrel download complete); clicking restarts into the new
 * version. Invisible everywhere else — browser dev, up-to-date installs,
 * checks in flight.
 */
export function UpdatePill() {
  const t = useTranslations("sidebar");
  const { state, restartToUpdate } = useAppUpdate();

  if (state.status !== "downloaded") return null;

  const version = state.availableVersion ? `v${state.availableVersion.replace(/^v/, "")}` : "";

  return (
    <button
      type="button"
      onClick={() => void restartToUpdate()}
      title={t("updateRestartHint")}
      className="text-ui-base mx-1.5 mb-1 flex h-8 items-center gap-2.5 rounded-lg border border-primary/25 bg-primary/10 px-2 font-medium text-foreground transition-colors hover:bg-primary/20"
      data-testid="update-pill"
    >
      <RefreshCw className="h-4 w-4 text-primary" />
      <span className="truncate">
        {version ? t("updateReadyVersion", { version }) : t("updateReady")}
      </span>
    </button>
  );
}
