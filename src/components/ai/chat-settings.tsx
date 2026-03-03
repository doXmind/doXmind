"use client";

import { Globe } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useSettingsStore } from "@/stores/settings-store";

export function ChatSettings() {
  const t = useTranslations("chat");
  const { webSearchEnabled, setWebSearchEnabled } = useSettingsStore();

  return (
    <div className="flex items-center gap-1">
      <Tooltip content={webSearchEnabled ? t("webSearchEnabled") : t("enableWebSearch")} side="top">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setWebSearchEnabled(!webSearchEnabled)}
          className={`h-8 w-8 rounded-full ${webSearchEnabled ? "bg-blue-500/10 text-blue-500" : "text-muted-foreground"}`}
          aria-label={webSearchEnabled ? t("disableWebSearch") : t("enableWebSearch")}
        >
          <Globe className="h-4 w-4" />
        </Button>
      </Tooltip>
    </div>
  );
}
