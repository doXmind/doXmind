"use client";

import { Type } from "lucide-react";
import { useLayoutStore } from "@/stores/layout-store";
import { cn } from "@/lib/utils";

const FONT_OPTIONS = [
  { value: "sans", label: "Sans-serif", preview: "font-sans" },
  { value: "serif", label: "Serif", preview: "font-serif" },
  { value: "mono", label: "Monospace", preview: "font-mono" },
] as const;

const SIZE_OPTIONS = [
  { value: "small", label: "Small" },
  { value: "normal", label: "Normal" },
  { value: "large", label: "Large" },
] as const;

const LINE_HEIGHT_OPTIONS = [
  { value: "compact", label: "Compact" },
  { value: "normal", label: "Normal" },
  { value: "relaxed", label: "Relaxed" },
] as const;

export function TypographySettings() {
  const { fontFamily, fontSize, lineHeight, setFontFamily, setFontSize, setLineHeight } =
    useLayoutStore();

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Customize the editor reading experience.</p>

      <div className="space-y-4 rounded-lg border p-4">
        {/* Font Family */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Type className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Font Family</span>
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
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Font Size */}
        <div className="space-y-2">
          <span className="text-sm font-medium">Font Size</span>
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
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Line Height */}
        <div className="space-y-2">
          <span className="text-sm font-medium">Line Spacing</span>
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
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Preview</span>
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
            The quick brown fox jumps over the lazy dog. Writing is an exploration. You start from
            nothing and learn as you go.
          </div>
        </div>
      </div>
    </div>
  );
}
