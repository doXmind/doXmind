"use client";

import { NodeViewWrapper, NodeViewContent, NodeViewProps } from "@tiptap/react";
import { Info, AlertTriangle, AlertCircle, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CalloutType } from "@/extensions/callout";

const calloutConfig: Record<
  CalloutType,
  {
    icon: React.ReactNode;
    label: string;
    bgClass: string;
    borderClass: string;
    iconClass: string;
  }
> = {
  info: {
    icon: <Info className="h-4 w-4" />,
    label: "Info",
    bgClass: "bg-blue-50 dark:bg-blue-950/30",
    borderClass: "border-blue-200 dark:border-blue-800",
    iconClass: "text-blue-600 dark:text-blue-400",
  },
  warning: {
    icon: <AlertTriangle className="h-4 w-4" />,
    label: "Warning",
    bgClass: "bg-amber-50 dark:bg-amber-950/30",
    borderClass: "border-amber-200 dark:border-amber-800",
    iconClass: "text-amber-600 dark:text-amber-400",
  },
  error: {
    icon: <AlertCircle className="h-4 w-4" />,
    label: "Error",
    bgClass: "bg-red-50 dark:bg-red-950/30",
    borderClass: "border-red-200 dark:border-red-800",
    iconClass: "text-red-600 dark:text-red-400",
  },
  tip: {
    icon: <Lightbulb className="h-4 w-4" />,
    label: "Tip",
    bgClass: "bg-emerald-50 dark:bg-emerald-950/30",
    borderClass: "border-emerald-200 dark:border-emerald-800",
    iconClass: "text-emerald-600 dark:text-emerald-400",
  },
};

const calloutTypes: CalloutType[] = ["info", "warning", "error", "tip"];

export function CalloutNodeView({ node, updateAttributes }: NodeViewProps) {
  const type = (node.attrs.type as CalloutType) || "info";
  const config = calloutConfig[type];

  const cycleType = () => {
    const currentIndex = calloutTypes.indexOf(type);
    const nextIndex = (currentIndex + 1) % calloutTypes.length;
    updateAttributes({ type: calloutTypes[nextIndex] });
  };

  return (
    <NodeViewWrapper>
      <div
        className={cn("my-2 flex gap-3 rounded-lg border p-3", config.bgClass, config.borderClass)}
      >
        {/* Icon button - click to cycle through types */}
        <button
          type="button"
          onClick={cycleType}
          contentEditable={false}
          className={cn(
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded transition-opacity hover:opacity-70",
            config.iconClass
          )}
          title={`${config.label} - Click to change type`}
        >
          {config.icon}
        </button>

        {/* Content area - editable */}
        <NodeViewContent className="min-w-0 flex-1 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0" />
      </div>
    </NodeViewWrapper>
  );
}
