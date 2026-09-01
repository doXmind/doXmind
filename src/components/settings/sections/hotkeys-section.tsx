"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { RotateCcw, X } from "lucide-react";

import { WORKSPACE_COMMANDS, bindingForEvent, formatBinding } from "@/lib/commands";
import { bindingFor, conflictingCommandIds, useHotkeysStore } from "@/stores/hotkeys-store";
import { cn } from "@/lib/utils";
import { FlatCard, FlatRow, RowLabel, SettingsSection } from "../settings-atoms";

export function HotkeysSection() {
  const t = useTranslations("settings");
  const tCommands = useTranslations("commands");
  const overrides = useHotkeysStore((state) => state.overrides);
  const setBinding = useHotkeysStore((state) => state.setBinding);
  const resetBinding = useHotkeysStore((state) => state.resetBinding);
  const resetAll = useHotkeysStore((state) => state.resetAll);
  const [recording, setRecording] = useState<string | null>(null);

  const conflicts = conflictingCommandIds(overrides);
  const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

  return (
    <SettingsSection id="hotkeys" title={t("hotkeys")} desc={t("hotkeysDesc")}>
      <FlatCard className="mb-2">
        {WORKSPACE_COMMANDS.map((command, index) => {
          const binding = bindingFor(command, overrides);
          const isRecording = recording === command.id;
          return (
            <FlatRow key={command.id} first={index === 0}>
              <RowLabel
                title={tCommands(command.labelKey)}
                desc={conflicts.has(command.id) ? t("hotkeyConflict") : undefined}
              />
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label={t("rebind", { command: tCommands(command.labelKey) })}
                  onClick={() => setRecording(isRecording ? null : command.id)}
                  // The chord is captured on keydown while this button holds focus, which is the
                  // only way to read a combination the app itself also binds.
                  onKeyDown={(event) => {
                    if (!isRecording) return;
                    event.preventDefault();
                    event.stopPropagation();
                    if (event.key === "Escape") {
                      setRecording(null);
                      return;
                    }
                    const next = bindingForEvent(event.nativeEvent);
                    if (!next) return;
                    setBinding(command.id, next);
                    setRecording(null);
                  }}
                  className={cn(
                    "min-w-[92px] rounded-[6px] border px-2 py-1 font-mono text-[12px]",
                    isRecording
                      ? "border-[var(--focus-ring)] text-muted-foreground"
                      : conflicts.has(command.id)
                        ? "border-destructive text-destructive"
                        : "border-border text-foreground"
                  )}
                >
                  {isRecording
                    ? t("pressKeys")
                    : binding
                      ? formatBinding(binding, isMac)
                      : t("unbound")}
                </button>
                <button
                  type="button"
                  aria-label={t("clearBinding", { command: tCommands(command.labelKey) })}
                  onClick={() => setBinding(command.id, null)}
                  className="rounded-[6px] p-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={t("resetBinding", { command: tCommands(command.labelKey) })}
                  onClick={() => resetBinding(command.id)}
                  className="rounded-[6px] p-1 text-muted-foreground hover:text-foreground"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </div>
            </FlatRow>
          );
        })}
      </FlatCard>
      <button
        type="button"
        onClick={resetAll}
        className="text-[12px] text-muted-foreground hover:text-foreground"
      >
        {t("resetAllHotkeys")}
      </button>
    </SettingsSection>
  );
}
