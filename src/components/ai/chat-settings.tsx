"use client";

import { useTranslations } from "next-intl";
import { useSettingsStore } from "@/stores/settings-store";

export function ChatSettings() {
  const t = useTranslations("chat");
  const { thinkingEnabled, setThinkingEnabled } = useSettingsStore();

  return (
    <button
      type="button"
      onClick={() => setThinkingEnabled(!thinkingEnabled)}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        thinkingEnabled
          ? "border-blue-500/30 bg-blue-500/10 text-blue-500"
          : "border-transparent bg-muted/50 text-muted-foreground hover:bg-muted"
      }`}
      aria-label={thinkingEnabled ? t("disableThinking") : t("enableThinking")}
    >
      <svg
        className="h-3.5 w-3.5 shrink-0"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M8 4.75V8H10.75"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className={thinkingEnabled ? "" : "line-through"}>{t("thinkingLabel")}</span>
    </button>
  );
}
