"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { APPEARANCE_LIMITS, useAppearanceStore } from "@/stores/appearance-store";
import { useLayoutStore } from "@/stores/layout-store";
import {
  getVisibleFontOptionsGrouped,
  resolveFontOption,
  type FontCategory,
  type FontFamilyId,
} from "@/lib/font-options";
import { cn } from "@/lib/utils";
import { FlatCard, FlatRow, RowLabel, SettingsSection } from "../settings-atoms";

const CATEGORY_ORDER: FontCategory[] = ["sans", "serif", "mono"];

export function TypographySection() {
  const t = useTranslations("settings");
  const fontFamily = useLayoutStore((s) => s.fontFamily);
  const setFontFamily = useLayoutStore((s) => s.setFontFamily);
  const lineHeight = useLayoutStore((s) => s.lineHeight);
  const setLineHeight = useLayoutStore((s) => s.setLineHeight);

  return (
    <SettingsSection id="typography" title={t("typography")} desc={t("typographyDesc")}>
      <FlatCard>
        <FlatRow first>
          <RowLabel title={t("editorFontFamily")} desc={t("editorFontFamilyDesc")} />
          <FontPicker value={fontFamily} onChange={setFontFamily} />
        </FlatRow>
        <FlatRow>
          <RowLabel title={t("uiFontSize")} desc={t("uiFontSizeDesc")} />
          <NumberStepper field="uiFontSize" />
        </FlatRow>
        <FlatRow>
          <RowLabel title={t("codeFontSize")} desc={t("codeFontSizeDesc")} />
          <NumberStepper field="codeFontSize" />
        </FlatRow>
        <FlatRow>
          <RowLabel title={t("editorLineSpacing")} desc={t("editorLineSpacingDesc")} />
          <Segmented
            value={lineHeight}
            onChange={setLineHeight}
            options={[
              { value: "compact", label: t("compact") },
              { value: "normal", label: t("normal") },
              { value: "relaxed", label: t("relaxed") },
            ]}
          />
        </FlatRow>
      </FlatCard>
    </SettingsSection>
  );
}

function FontPicker({
  value,
  onChange,
}: {
  value: FontFamilyId;
  onChange: (id: FontFamilyId) => void;
}) {
  const t = useTranslations("settings");
  const grouped = getVisibleFontOptionsGrouped();
  const current = resolveFontOption(value);
  const categoryLabel: Record<FontCategory, string> = {
    sans: t("sansSerif"),
    serif: t("serif"),
    mono: t("monospace"),
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-[30px] shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-secondary"
          style={{ fontFamily: current?.stack ?? undefined }}
        >
          <span className="truncate">{current?.label ?? value}</span>
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
  );
}

function NumberStepper({ field }: { field: "uiFontSize" | "codeFontSize" }) {
  const value = useAppearanceStore((s) => s[field]);
  const setUi = useAppearanceStore((s) => s.setUiFontSize);
  const setCode = useAppearanceStore((s) => s.setCodeFontSize);
  const setter = field === "uiFontSize" ? setUi : setCode;
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const min = APPEARANCE_LIMITS.min;
  const max = APPEARANCE_LIMITS.max;
  const apply = (next: number) => {
    const clamped = Math.max(min, Math.min(max, next));
    setDraft(clamped);
    setter(clamped);
  };

  return (
    <div className="inline-flex items-center overflow-hidden rounded-md border border-border bg-card">
      <button
        type="button"
        aria-label="decrease"
        onClick={() => apply(draft - 1)}
        className="h-7 w-6 text-[14px] text-muted-foreground transition-colors hover:text-foreground"
      >
        −
      </button>
      <div className="w-[50px] text-center font-mono text-[12px] tabular-nums text-foreground">
        {draft}
        <span className="text-muted-foreground">px</span>
      </div>
      <button
        type="button"
        aria-label="increase"
        onClick={() => apply(draft + 1)}
        className="h-7 w-6 text-[14px] text-muted-foreground transition-colors hover:text-foreground"
      >
        +
      </button>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-secondary p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-md px-2.5 py-[5px] text-[12px] transition-colors",
              active
                ? "bg-card font-semibold text-foreground shadow-[0_1px_0_rgba(0,0,0,0.04),0_0_0_1px_var(--border)]"
                : "font-medium text-muted-foreground hover:text-foreground"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
