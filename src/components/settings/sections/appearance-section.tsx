"use client";

import { useTranslations } from "next-intl";
import { Check, ChevronDown, Monitor, Moon, Sun } from "lucide-react";
import { useThemeManager } from "@/hooks/use-theme-manager";
import { cn } from "@/lib/utils";
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME, getTheme } from "@/lib/themes/registry";
import type { ThemeDefinition } from "@/lib/themes/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FlatCard, SettingsSection } from "../settings-atoms";

type Mode = "light" | "dark" | "system";

export function AppearanceSection() {
  const t = useTranslations("settings");
  const {
    currentTheme,
    isSystemMode,
    setSystemMode,
    selectTheme,
    preferredLightTheme,
    preferredDarkTheme,
    lightThemes,
    darkThemes,
  } = useThemeManager();

  const mode: Mode = isSystemMode ? "system" : currentTheme.baseMode === "dark" ? "dark" : "light";

  const onPickMode = (next: Mode) => {
    if (next === "system") {
      setSystemMode(true);
      return;
    }
    selectTheme(next === "light" ? preferredLightTheme : preferredDarkTheme);
  };

  return (
    <SettingsSection id="appearance" title={t("appearance")} desc={t("appearanceDesc")}>
      <FlatCard className="mb-2">
        <div className="px-[18px] py-[18px]">
          <ThemePick value={mode} onChange={onPickMode} />
          {mode !== "system" && (
            <ThemePickerRow
              themes={mode === "light" ? lightThemes : darkThemes}
              activeId={currentTheme.id}
              onPick={selectTheme}
              label={mode === "light" ? t("lightThemeLabel") : t("darkThemeLabel")}
            />
          )}
          {mode === "system" && (
            <div className="mt-4 flex flex-col gap-3">
              <ThemePickerRow
                themes={lightThemes}
                activeId={preferredLightTheme}
                onPick={(id) => {
                  // Update the preferred light theme without leaving system mode.
                  selectTheme(id);
                  setSystemMode(true);
                }}
                label={t("lightThemeLabel")}
              />
              <ThemePickerRow
                themes={darkThemes}
                activeId={preferredDarkTheme}
                onPick={(id) => {
                  selectTheme(id);
                  setSystemMode(true);
                }}
                label={t("darkThemeLabel")}
              />
            </div>
          )}
        </div>
      </FlatCard>
    </SettingsSection>
  );
}

// Canonical defaults — the 3-mode picker always renders these so each chip
// is a stable representation of "light" vs "dark" as a category, not a
// proxy for whichever variant the user happens to have selected. Variant
// selection lives in the strip below.
const DEFAULT_LIGHT = getTheme(DEFAULT_LIGHT_THEME);
const DEFAULT_DARK = getTheme(DEFAULT_DARK_THEME);

function ThemePick({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  const t = useTranslations("settings");

  const opts: Array<{
    v: Mode;
    label: string;
    icon: React.ReactNode;
    background: string;
    border: string;
    /** Bar tone — design uses a subtle layer slightly contrasted from bg.
     *  Light cards: dim black overlay; Dark cards: dim white overlay. */
    bar: string;
  }> = [
    {
      v: "light",
      label: t("light"),
      icon: <Sun className="h-3.5 w-3.5" />,
      background: DEFAULT_LIGHT.preview.backgroundColor,
      border: hslToken(DEFAULT_LIGHT.tokens.border),
      bar: "rgba(0, 0, 0, 0.08)",
    },
    {
      v: "dark",
      label: t("dark"),
      icon: <Moon className="h-3.5 w-3.5" />,
      background: DEFAULT_DARK.preview.backgroundColor,
      border: hslToken(DEFAULT_DARK.tokens.border),
      bar: "rgba(255, 255, 255, 0.08)",
    },
    {
      v: "system",
      label: t("system"),
      icon: <Monitor className="h-3.5 w-3.5" />,
      background: `linear-gradient(135deg, ${DEFAULT_LIGHT.preview.backgroundColor} 0 50%, ${DEFAULT_DARK.preview.backgroundColor} 50% 100%)`,
      border: hslToken(DEFAULT_LIGHT.tokens.border),
      // Bars need to read against both halves of the gradient — a low-alpha
      // mid-grey works for both sides without flipping mid-rectangle.
      bar: "rgba(127, 127, 127, 0.22)",
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-2.5">
      {opts.map((o) => {
        const on = o.v === value;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={cn(
              "flex flex-col gap-2 rounded-[10px] p-2.5 text-left transition-colors",
              on
                ? "border-[1.5px] border-foreground bg-card"
                : "border border-border/70 bg-transparent hover:bg-card/50"
            )}
          >
            <div
              className="relative h-14 overflow-hidden rounded-md"
              style={{ background: o.background, border: `1px solid ${o.border}` }}
            >
              <div
                className="absolute left-1.5 right-1.5 top-1.5 h-1 rounded-sm"
                style={{ background: o.bar }}
              />
              <div
                className="absolute left-1.5 right-6 top-4 h-[3px] rounded-sm"
                style={{ background: o.bar, opacity: 0.7 }}
              />
              <div
                className="absolute left-1.5 right-3 top-6 h-[3px] rounded-sm"
                style={{ background: o.bar, opacity: 0.7 }}
              />
            </div>
            <div
              className={cn(
                "flex items-center gap-1.5 text-[12px]",
                on ? "font-semibold text-foreground" : "font-medium text-muted-foreground"
              )}
            >
              {o.icon}
              {o.label}
              {on && <Check className="ml-auto h-3 w-3" />}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// Picker row: label on the left ("Light theme" / "Dark theme") with a
// dropdown on the right showing every variant in that base mode. Mirrors
// Codex's affordance — a flat name list with a small accent swatch per
// item — but kept in our flat-card / cozy-density chrome.
function ThemePickerRow({
  themes,
  activeId,
  onPick,
  label,
}: {
  themes: ThemeDefinition[];
  activeId: string;
  onPick: (id: string) => void;
  label: string;
}) {
  if (themes.length === 0) return null;
  const current = themes.find((t) => t.id === activeId) ?? themes[0];
  return (
    <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/60 pt-3.5">
      <div className="text-[12px] font-medium text-foreground">{label}</div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex h-9 w-[220px] items-center gap-2.5 rounded-md border border-border bg-card px-2 text-[13px] font-medium text-foreground transition-colors hover:bg-secondary"
          >
            <ThemeSwatch theme={current} size={24} />
            <span className="min-w-0 flex-1 truncate text-left">{current.name}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        {/* Width matches the trigger so swatches + names hang in the same
            columns whether the menu is open or collapsed. p-1 + matching
            inner padding keep the swatch's left edge flush with the
            trigger's swatch. */}
        <DropdownMenuContent align="end" className="w-[220px] p-1">
          {themes.map((theme) => {
            const on = theme.id === activeId;
            return (
              <DropdownMenuItem
                key={theme.id}
                onClick={() => onPick(theme.id)}
                className="flex items-center gap-2.5 px-2 py-2 text-[13px]"
              >
                <ThemeSwatch theme={theme} size={24} />
                <span className="min-w-0 flex-1 truncate text-left">{theme.name}</span>
                {/* Reserve the check column on every row so the name's right
                    edge — and the swatch's left edge — stay columnar
                    regardless of which row is selected. */}
                <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                  {on && <Check className="h-3.5 w-3.5 text-foreground" />}
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// Codex-style "Aa" theme chip — a rounded square painted in the theme's
// background with the accent colour as the typeface. Lets the user read the
// palette intent (surface tone + accent contrast) at a glance, much more
// informative than a half-bg / half-accent puck.
function ThemeSwatch({ theme, size = 24 }: { theme: ThemeDefinition; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 select-none items-center justify-center rounded-md font-semibold leading-none"
      style={{
        width: size,
        height: size,
        background: theme.preview.backgroundColor,
        border: `1px solid ${hslToken(theme.tokens.border)}`,
        color: theme.preview.accentColor,
        fontFamily: "var(--brand-sans-stack)",
        fontSize: Math.round(size * 0.5),
        letterSpacing: "-0.04em",
      }}
    >
      Aa
    </span>
  );
}

// Theme tokens are stored as bare HSL triples (e.g. `60 4% 91%`) so they
// can interpolate into a CSS custom property as `hsl(var(--token))`. When
// using them as inline-style colour values we have to wrap them ourselves;
// otherwise the browser silently rejects the raw triple.
function hslToken(token: string): string {
  return `hsl(${token})`;
}
