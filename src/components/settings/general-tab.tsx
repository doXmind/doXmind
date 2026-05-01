"use client";

// New i18n keys added by this file:
//   settings.welcomeMode.title
//   settings.welcomeMode.desc
//   settings.welcomeMode.continuum
//   settings.welcomeMode.continuumDesc
//   settings.welcomeMode.stratigraphy
//   settings.welcomeMode.stratigraphyDesc
//   settings.welcomeMode.terminal
//   settings.welcomeMode.terminalDesc
//   settings.welcomeMode.paper
//   settings.welcomeMode.paperDesc

import { useTranslations } from "next-intl";
import { ThemePickerPanel } from "@/components/shared/shared-theme-toggle";
import { AppearanceCustomize } from "@/components/settings/appearance-customize";
import { WELCOME_MODES, useAppearanceStore, type WelcomeMode } from "@/stores/appearance-store";
import { cn } from "@/lib/utils";

function WelcomeModeSection() {
  const t = useTranslations("settings.welcomeMode");
  const welcomeMode = useAppearanceStore((s) => s.welcomeMode);
  const setWelcomeMode = useAppearanceStore((s) => s.setWelcomeMode);

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-foreground">{t("title")}</h2>
        <p className="text-xs text-muted-foreground">{t("desc")}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 rounded-lg border border-border/40 bg-card p-3">
        {WELCOME_MODES.map((mode) => {
          const isActive = welcomeMode === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setWelcomeMode(mode as WelcomeMode)}
              className={cn(
                "flex flex-col items-start gap-1 rounded-md border px-3 py-2.5 text-left transition-colors",
                isActive
                  ? "border-foreground/40 bg-[var(--sidebar-hover)]"
                  : "hover:bg-[var(--sidebar-hover)]/60 border-border/40 hover:border-border"
              )}
              aria-pressed={isActive}
            >
              <span className="text-sm font-medium text-foreground">{t(mode)}</span>
              <span className="text-xs text-muted-foreground">{t(`${mode}Desc`)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

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

      <WelcomeModeSection />

      <AppearanceCustomize />
    </div>
  );
}
