"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { APPEARANCE_LIMITS, useAppearanceStore } from "@/stores/appearance-store";

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

export function AppearanceCustomize() {
  const t = useTranslations("settings");
  const pointerCursors = useAppearanceStore((s) => s.pointerCursors);
  const setPointerCursors = useAppearanceStore((s) => s.setPointerCursors);
  const reset = useAppearanceStore((s) => s.reset);

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
      </div>
    </section>
  );
}
