"use client";

import { useTranslations } from "next-intl";
import { ThemePickerPanel } from "@/components/shared/shared-theme-toggle";
import { AppearanceCustomize } from "@/components/settings/appearance-customize";

export function GeneralTab() {
  const t = useTranslations("settings");

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">{t("themeTab")}</h2>
        <div className="rounded-lg border border-border/40 bg-card p-4">
          <ThemePickerPanel />
        </div>
      </section>

      <AppearanceCustomize />
    </div>
  );
}
