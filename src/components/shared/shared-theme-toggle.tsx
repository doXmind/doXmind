"use client";

import { Check, Crown, Lock, Monitor, Palette } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useThemeManager } from "@/hooks/use-theme-manager";
import { cn } from "@/lib/utils";
import type { ThemeDefinition } from "@/lib/themes/types";

function MiniThemeCard({
  theme,
  isActive,
  isLocked,
  onSelect,
}: {
  theme: ThemeDefinition;
  isActive: boolean;
  isLocked: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "group relative flex flex-col items-center gap-1 rounded-md border p-1 transition-all",
        isActive
          ? "border-primary ring-1 ring-primary/20"
          : "border-transparent hover:border-border"
      )}
    >
      <div
        className={cn(
          "relative h-[40px] w-full overflow-hidden rounded-sm",
          isLocked && "opacity-50 grayscale-[40%]"
        )}
        style={{ backgroundColor: theme.preview.backgroundColor }}
      >
        {/* Accent strip */}
        <div
          className="absolute bottom-0 left-0 top-0 w-[3px]"
          style={{ backgroundColor: theme.preview.accentColor }}
        />
        {/* Text lines */}
        <div className="flex flex-col gap-[3px] p-1.5 pl-2">
          <div
            className="h-[3px] w-3/5 rounded-full"
            style={{ backgroundColor: theme.preview.foregroundColor, opacity: 0.6 }}
          />
          <div
            className="h-[2px] w-full rounded-full"
            style={{ backgroundColor: theme.preview.foregroundColor, opacity: 0.3 }}
          />
          <div
            className="h-[2px] w-4/5 rounded-full"
            style={{ backgroundColor: theme.preview.foregroundColor, opacity: 0.3 }}
          />
          <div
            className="h-[2px] w-2/3 rounded-full"
            style={{ backgroundColor: theme.preview.foregroundColor, opacity: 0.2 }}
          />
        </div>
        {isActive && !isLocked && (
          <div className="absolute right-0.5 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary">
            <Check className="h-2 w-2 text-primary-foreground" />
          </div>
        )}
        {isLocked && (
          <div className="absolute right-0.5 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-muted-foreground/60">
            <Lock className="h-2 w-2 text-background" />
          </div>
        )}
      </div>
      <span
        className={cn(
          "text-[10px] leading-tight",
          isActive ? "font-medium text-foreground" : "text-muted-foreground"
        )}
      >
        {theme.name}
      </span>
    </button>
  );
}

export function ThemeQuickPicker() {
  const t = useTranslations("settings");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={t("chooseTheme")}
        >
          <Palette className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[280px] p-3">
        <ThemePickerPanel />
      </PopoverContent>
    </Popover>
  );
}

export function ThemePickerPanel() {
  const t = useTranslations("settings");
  const {
    currentThemeId,
    selectTheme,
    canAccessTheme,
    isSystemMode,
    setSystemMode,
    freeLightThemes,
    freeDarkThemes,
    premiumLightThemes,
    premiumDarkThemes,
  } = useThemeManager();

  const freeThemes = [...freeLightThemes, ...freeDarkThemes];
  const proThemes = [...premiumLightThemes, ...premiumDarkThemes];

  const handleThemeSelect = (themeId: string) => {
    if (!canAccessTheme(themeId)) {
      toast(t("premiumThemeRequired"), {
        action: {
          label: t("upgradeNow"),
          onClick: () => {
            window.location.href = "/pricing";
          },
        },
      });
      return;
    }
    selectTheme(themeId);
  };

  return (
    <div className="space-y-3">
      {/* Free themes (Notion + Midnight together) */}
      <div className="space-y-1.5">
        <div className="grid grid-cols-4 gap-1">
          {freeThemes.map((theme) => (
            <MiniThemeCard
              key={theme.id}
              theme={theme}
              isActive={currentThemeId === theme.id}
              isLocked={false}
              onSelect={() => handleThemeSelect(theme.id)}
            />
          ))}
        </div>
      </div>

      {/* Pro themes (light-themed first, then dark-themed) */}
      {proThemes.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Crown className="h-3 w-3 text-amber-500" />
            <span className="text-[10px] font-medium uppercase tracking-wider text-amber-500">
              {t("proThemes")}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {proThemes.map((theme) => (
              <MiniThemeCard
                key={theme.id}
                theme={theme}
                isActive={currentThemeId === theme.id}
                isLocked={!canAccessTheme(theme.id)}
                onSelect={() => handleThemeSelect(theme.id)}
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-t pt-2">
        <div className="flex items-center gap-1.5">
          <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{t("followSystem")}</span>
        </div>
        <button
          onClick={() => setSystemMode(!isSystemMode)}
          className={cn(
            "relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full transition-colors",
            isSystemMode ? "bg-primary" : "bg-muted"
          )}
        >
          <span
            className={cn(
              "pointer-events-none inline-block h-3 w-3 transform rounded-full bg-background shadow-sm ring-0 transition-transform",
              isSystemMode ? "translate-x-[14px]" : "translate-x-[2px]",
              "mt-[2px]"
            )}
          />
        </button>
      </div>
    </div>
  );
}

/** @deprecated Use ThemeQuickPicker instead */
export function SharedThemeToggle() {
  return <ThemeQuickPicker />;
}
