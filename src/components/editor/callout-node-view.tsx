"use client";

import { useState, useRef, useEffect } from "react";
import { NodeViewWrapper, NodeViewContent, NodeViewProps } from "@tiptap/react";
import { Info, AlertTriangle, AlertCircle, Lightbulb } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { CalloutType } from "@/extensions/callout";

const calloutConfig: Record<
  CalloutType,
  {
    icon: React.ReactNode;
    labelKey: "info" | "warning" | "error" | "tip";
    bgClass: string;
    borderClass: string;
    iconClass: string;
  }
> = {
  info: {
    icon: <Info className="h-4 w-4" />,
    labelKey: "info",
    bgClass: "bg-blue-50 dark:bg-blue-950/30",
    borderClass: "border-blue-200 dark:border-blue-800",
    iconClass: "text-blue-600 dark:text-blue-400",
  },
  warning: {
    icon: <AlertTriangle className="h-4 w-4" />,
    labelKey: "warning",
    bgClass: "bg-amber-50 dark:bg-amber-950/30",
    borderClass: "border-amber-200 dark:border-amber-800",
    iconClass: "text-amber-600 dark:text-amber-400",
  },
  error: {
    icon: <AlertCircle className="h-4 w-4" />,
    labelKey: "error",
    bgClass: "bg-red-50 dark:bg-red-950/30",
    borderClass: "border-red-200 dark:border-red-800",
    iconClass: "text-red-600 dark:text-red-400",
  },
  tip: {
    icon: <Lightbulb className="h-4 w-4" />,
    labelKey: "tip",
    bgClass: "bg-emerald-50 dark:bg-emerald-950/30",
    borderClass: "border-emerald-200 dark:border-emerald-800",
    iconClass: "text-emerald-600 dark:text-emerald-400",
  },
};

const calloutTypes: CalloutType[] = ["info", "warning", "error", "tip"];

export function CalloutNodeView({ node, updateAttributes }: NodeViewProps) {
  const type = (node.attrs.type as CalloutType) || "info";
  const config = calloutConfig[type];
  const t = useTranslations("editor");
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on click outside and Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(false);
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown, true);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen]);

  return (
    <NodeViewWrapper>
      <div
        className={cn("my-2 flex gap-3 rounded-lg border p-3", config.bgClass, config.borderClass)}
      >
        {/* Icon button - click to open type selector */}
        <div className="relative" contentEditable={false}>
          <button
            ref={buttonRef}
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className={cn(
              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded transition-opacity hover:opacity-70",
              config.iconClass
            )}
            title={`${t(`callout.${config.labelKey}`)} - ${t("callout.changeType")}`}
          >
            {config.icon}
          </button>

          {/* Type selector popover */}
          {isOpen && (
            <div
              ref={popoverRef}
              className="animate-in fade-in-0 zoom-in-95 absolute left-0 top-full z-50 mt-1 w-[140px] rounded-lg border border-border bg-popover p-1 shadow-xl"
            >
              {calloutTypes.map((ct) => {
                const ctConfig = calloutConfig[ct];
                const isActive = ct === type;
                return (
                  <button
                    key={ct}
                    type="button"
                    onClick={() => {
                      updateAttributes({ type: ct });
                      setIsOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                      isActive
                        ? "bg-accent font-medium text-accent-foreground"
                        : "hover:bg-accent/50"
                    )}
                  >
                    <span className={ctConfig.iconClass}>{ctConfig.icon}</span>
                    <span>{t(`callout.${ctConfig.labelKey}`)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Content area - editable */}
        <NodeViewContent className="min-w-0 flex-1 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0" />
      </div>
    </NodeViewWrapper>
  );
}
