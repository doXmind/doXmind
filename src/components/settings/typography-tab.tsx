"use client";

import { useTranslations } from "next-intl";
import { TypographySettings } from "@/components/settings/typography-settings";

export function TypographyTab() {
  const t = useTranslations("settings");

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">{t("typography")}</h2>
      <TypographySettings />
    </div>
  );
}
