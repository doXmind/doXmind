"use client";

import { useTranslations } from "next-intl";
import { Type } from "lucide-react";
import { useLayoutStore } from "@/stores/layout-store";
import { cn } from "@/lib/utils";

const FONT_OPTIONS = [
  { value: "sans", labelKey: "sansSerif", preview: "font-sans" },
  { value: "serif", labelKey: "serif", preview: "font-serif" },
  { value: "mono", labelKey: "monospace", preview: "font-mono" },
] as const;

const SIZE_OPTIONS = [
  { value: "small", labelKey: "small" },
  { value: "normal", labelKey: "normal" },
  { value: "large", labelKey: "large" },
] as const;

const LINE_HEIGHT_OPTIONS = [
  { value: "compact", labelKey: "compact" },
  { value: "normal", labelKey: "normal" },
  { value: "relaxed", labelKey: "relaxed" },
] as const;

export function TypographySettings() {
  const t = useTranslations("settings");
  const { fontFamily, fontSize, lineHeight, setFontFamily, setFontSize, setLineHeight } =
    useLayoutStore();

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("customizeReading")}</p>

      <div className="space-y-4 rounded-lg border p-4">
        {/* Font Family */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Type className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{t("fontFamily")}</span>
          </div>
          <div className="flex gap-2">
            {FONT_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => setFontFamily(option.value)}
                className={cn(
                  "flex-1 rounded-md border px-3 py-2 text-sm transition-colors",
                  option.preview,
                  fontFamily === option.value
                    ? "border-primary bg-primary/5 text-foreground"
                    : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                )}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* Font Size */}
        <div className="space-y-2">
          <span className="text-sm font-medium">{t("fontSize")}</span>
          <div className="flex gap-2">
            {SIZE_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => setFontSize(option.value)}
                className={cn(
                  "flex-1 rounded-md border px-3 py-2 text-sm transition-colors",
                  fontSize === option.value
                    ? "border-primary bg-primary/5 text-foreground"
                    : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                )}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* Line Height */}
        <div className="space-y-2">
          <span className="text-sm font-medium">{t("lineSpacing")}</span>
          <div className="flex gap-2">
            {LINE_HEIGHT_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => setLineHeight(option.value)}
                className={cn(
                  "flex-1 rounded-md border px-3 py-2 text-sm transition-colors",
                  lineHeight === option.value
                    ? "border-primary bg-primary/5 text-foreground"
                    : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                )}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">{t("preview")}</span>
          <div
            className={cn(
              "rounded-md border border-dashed p-3",
              fontFamily === "sans" && "font-sans",
              fontFamily === "serif" && "font-serif",
              fontFamily === "mono" && "font-mono",
              fontSize === "small" && "text-sm",
              fontSize === "normal" && "text-base",
              fontSize === "large" && "text-lg",
              lineHeight === "compact" && "leading-snug",
              lineHeight === "normal" && "leading-relaxed",
              lineHeight === "relaxed" && "leading-loose"
            )}
          >
            {t("previewText")}
          </div>
        </div>
      </div>
    </div>
  );
}
