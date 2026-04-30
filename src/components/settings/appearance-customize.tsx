"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { APPEARANCE_LIMITS, useAppearanceStore } from "@/stores/appearance-store";
import { useLayoutStore } from "@/stores/layout-store";
import {
  getVisibleFontOptionsGrouped,
  resolveFontOption,
  type FontCategory,
  type FontFamilyId,
} from "@/lib/font-options";

type NumberField = "uiFontSize" | "codeFontSize";

function NumberRow({ title, desc, field }: { title: string; desc: string; field: NumberField }) {
  const value = useAppearanceStore((s) => s[field]);
  const setUi = useAppearanceStore((s) => s.setUiFontSize);
  const setCode = useAppearanceStore((s) => s.setCodeFontSize);
  const setter = field === "uiFontSize" ? setUi : setCode;
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const next = Number(draft);
    if (Number.isFinite(next)) setter(next);
    else setDraft(String(value));
  };

  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0 pr-2">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Input
          type="number"
          inputMode="numeric"
          min={APPEARANCE_LIMITS.min}
          max={APPEARANCE_LIMITS.max}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              setDraft(String(value));
              e.currentTarget.blur();
            }
          }}
          className="h-8 w-16 text-right text-xs"
        />
        <span className="text-xs text-muted-foreground">px</span>
      </div>
    </div>
  );
}

function ToggleRow({
  title,
  desc,
  checked,
  onChange,
}: {
  title: string;
  desc: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0 pr-2">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

function SegmentedRow<T extends string>({
  title,
  desc,
  value,
  options,
  onChange,
}: {
  title: string;
  desc: string;
  value: T;
  options: readonly SegmentOption<T>[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0 pr-2">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border/40 bg-background/40 p-0.5">
        {options.map((opt) => {
          const isActive = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={cn(
                "h-6 rounded px-2 text-xs font-medium transition-colors",
                isActive
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const CATEGORY_ORDER: FontCategory[] = ["sans", "serif", "mono"];

function FontPickerRow({
  title,
  desc,
  value,
  onChange,
}: {
  title: string;
  desc: string;
  value: FontFamilyId;
  onChange: (next: FontFamilyId) => void;
}) {
  const t = useTranslations("settings");
  const grouped = getVisibleFontOptionsGrouped();
  const current = resolveFontOption(value);
  const currentLabel = current?.label ?? value;

  const categoryLabel: Record<FontCategory, string> = {
    sans: t("sansSerif"),
    serif: t("serif"),
    mono: t("monospace"),
  };

  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0 pr-2">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-[var(--sidebar-hover)]"
            style={{ fontFamily: current?.stack ?? undefined }}
          >
            <span className="truncate">{currentLabel}</span>
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {CATEGORY_ORDER.map((cat, idx) => {
            const opts = grouped[cat];
            if (opts.length === 0) return null;
            return (
              <div key={cat}>
                {idx > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground/70">
                  {categoryLabel[cat]}
                </DropdownMenuLabel>
                {opts.map((opt) => {
                  const isActive = value === opt.id;
                  return (
                    <DropdownMenuItem
                      key={opt.id}
                      onClick={() => onChange(opt.id)}
                      className="flex items-center justify-between"
                    >
                      <span style={{ fontFamily: opt.stack ?? undefined }}>{opt.label}</span>
                      {isActive && <Check className="h-3.5 w-3.5 text-foreground" />}
                    </DropdownMenuItem>
                  );
                })}
              </div>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function AppearanceCustomize() {
  const t = useTranslations("settings");
  const pointerCursors = useAppearanceStore((s) => s.pointerCursors);
  const setPointerCursors = useAppearanceStore((s) => s.setPointerCursors);
  const reset = useAppearanceStore((s) => s.reset);

  const fontFamily = useLayoutStore((s) => s.fontFamily);
  const setFontFamily = useLayoutStore((s) => s.setFontFamily);
  const lineHeight = useLayoutStore((s) => s.lineHeight);
  const setLineHeight = useLayoutStore((s) => s.setLineHeight);

  const lineHeightOptions = [
    { value: "compact" as const, label: t("compact") },
    { value: "normal" as const, label: t("normal") },
    { value: "relaxed" as const, label: t("relaxed") },
  ];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">{t("customize")}</h2>
        <button
          type="button"
          onClick={reset}
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("reset")}
        </button>
      </div>

      <div className="divide-y divide-border/40 rounded-lg border border-border/40 bg-card px-4 py-2">
        <ToggleRow
          title={t("usePointerCursors")}
          desc={t("usePointerCursorsDesc")}
          checked={pointerCursors}
          onChange={setPointerCursors}
        />
        <NumberRow title={t("uiFontSize")} desc={t("uiFontSizeDesc")} field="uiFontSize" />
        <NumberRow title={t("codeFontSize")} desc={t("codeFontSizeDesc")} field="codeFontSize" />
        <FontPickerRow
          title={t("editorFontFamily")}
          desc={t("editorFontFamilyDesc")}
          value={fontFamily}
          onChange={setFontFamily}
        />
        <SegmentedRow
          title={t("editorLineSpacing")}
          desc={t("editorLineSpacingDesc")}
          value={lineHeight}
          options={lineHeightOptions}
          onChange={setLineHeight}
        />
      </div>
    </section>
  );
}
