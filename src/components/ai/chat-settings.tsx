"use client";

import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useSettingsStore } from "@/stores/settings-store";

export function ChatSettings() {
  const { webSearchEnabled, setWebSearchEnabled } = useSettingsStore();

  return (
    <Tooltip content={webSearchEnabled ? "Web search enabled" : "Enable web search"} side="top">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setWebSearchEnabled(!webSearchEnabled)}
        className={`h-7 w-7 ${webSearchEnabled ? "text-blue-500 bg-blue-500/10" : "text-muted-foreground"}`}
        aria-label={webSearchEnabled ? "Disable web search" : "Enable web search"}
      >
        <Globe className="h-4 w-4" />
      </Button>
    </Tooltip>
  );
}
