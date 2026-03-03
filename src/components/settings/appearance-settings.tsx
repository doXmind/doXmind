"use client";

import { useTranslations } from "next-intl";
import { Check, Monitor } from "lucide-react";
import { useThemeManager } from "@/hooks/use-theme-manager";
import { cn } from "@/lib/utils";
import type { ThemeDefinition } from "@/lib/themes/types";

function ThemeCard({
  theme,
  isActive,
  onSelect,
}: {
  theme: ThemeDefinition;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "group relative flex flex-col items-center gap-1.5 rounded-lg border p-1.5 transition-all",
        isActive
          ? "border-primary ring-2 ring-primary/20"
          : "border-border hover:border-foreground/30"
      )}
    >
      {/* Mini preview */}
      <div
        className="relative h-[68px] w-full overflow-hidden rounded-md"
        style={{ backgroundColor: theme.preview.backgroundColor }}
      >
        {/* Sidebar accent strip */}
        <div
          className="absolute bottom-0 left-0 top-0 w-1 rounded-l-md"
          style={{ backgroundColor: theme.preview.accentColor }}
        />
        {/* Fake text lines */}
        <div className="flex flex-col gap-[5px] p-2.5 pl-3.5">
          <div
            className="h-[5px] w-3/5 rounded-full"
            style={{
              backgroundColor: theme.preview.foregroundColor,
              opacity: 0.7,
            }}
          />
          <div
            className="h-[3px] w-full rounded-full"
            style={{
              backgroundColor: theme.preview.foregroundColor,
              opacity: 0.35,
            }}
          />
          <div
            className="h-[3px] w-5/6 rounded-full"
            style={{
              backgroundColor: theme.preview.foregroundColor,
              opacity: 0.35,
            }}
          />
          <div
            className="h-[3px] w-2/3 rounded-full"
            style={{
              backgroundColor: theme.preview.foregroundColor,
              opacity: 0.35,
            }}
          />
          <div
            className="h-[3px] w-4/5 rounded-full"
            style={{
              backgroundColor: theme.preview.foregroundColor,
              opacity: 0.25,
            }}
          />
        </div>
        {/* Active checkmark */}
        {isActive && (
          <div className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary">
            <Check className="h-2.5 w-2.5 text-primary-foreground" />
          </div>
        )}
      </div>
      {/* Theme name */}
      <span
        className={cn(
          "text-[11px] font-medium leading-tight",
          isActive ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {theme.name}
      </span>
    </button>
  );
}

export function AppearanceSettings() {
  const t = useTranslations("settings");
  const { currentThemeId, selectTheme, isSystemMode, setSystemMode, lightThemes, darkThemes } =
    useThemeManager();

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("chooseTheme")}</p>

      <div className="space-y-4 rounded-lg border p-4">
        {/* Light Themes */}
        <div className="space-y-2">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("light")}
          </span>
          <div className="grid grid-cols-4 gap-2">
            {lightThemes.map((theme) => (
              <ThemeCard
                key={theme.id}
                theme={theme}
                isActive={currentThemeId === theme.id}
                onSelect={() => selectTheme(theme.id)}
              />
            ))}
          </div>
        </div>

        {/* Dark Themes */}
        <div className="space-y-2">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("dark")}
          </span>
          <div className="grid grid-cols-4 gap-2">
            {darkThemes.map((theme) => (
              <ThemeCard
                key={theme.id}
                theme={theme}
                isActive={currentThemeId === theme.id}
                onSelect={() => selectTheme(theme.id)}
              />
            ))}
          </div>
        </div>

        {/* Follow System Toggle */}
        <div className="flex items-center justify-between border-t pt-3">
          <div className="flex items-center gap-2">
            <Monitor className="h-4 w-4 text-muted-foreground" />
            <div>
              <span className="text-sm font-medium">{t("followSystem")}</span>
              <p className="text-xs text-muted-foreground">{t("autoSwitch")}</p>
            </div>
          </div>
          <button
            onClick={() => setSystemMode(!isSystemMode)}
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors",
              isSystemMode ? "bg-primary" : "bg-muted"
            )}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow-sm ring-0 transition-transform",
                isSystemMode ? "translate-x-[18px]" : "translate-x-[2px]",
                "mt-[2px]"
              )}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
