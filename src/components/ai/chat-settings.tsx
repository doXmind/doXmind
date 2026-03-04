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
      className={`flex items-center rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        thinkingEnabled
          ? "border-purple-500/30 bg-purple-500/10 text-purple-500"
          : "border-transparent bg-muted/50 text-muted-foreground hover:bg-muted"
      }`}
      aria-label={thinkingEnabled ? t("disableThinking") : t("enableThinking")}
    >
      <span className={thinkingEnabled ? "" : "line-through"}>{t("thinkingLabel")}</span>
    </button>
  );
}
