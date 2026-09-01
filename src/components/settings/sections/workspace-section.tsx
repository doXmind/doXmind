"use client";

import { useTranslations } from "next-intl";
import {
  parseExcludedScanDirs,
  useWorkspaceSettingsStore,
} from "@/stores/workspace-settings-store";
import { FlatCard, SettingsSection } from "../settings-atoms";

export function WorkspaceSection() {
  const t = useTranslations("settings");
  const excludedScanDirs = useWorkspaceSettingsStore((s) => s.excludedScanDirs);
  const setExcludedScanDirs = useWorkspaceSettingsStore((s) => s.setExcludedScanDirs);

  return (
    <SettingsSection id="workspace" title={t("workspace")} desc={t("workspaceDesc")}>
      <FlatCard className="mb-2">
        <div className="px-[18px] py-[18px]">
          <label
            htmlFor="workspace-excludes"
            className="mb-1 block text-[13px] font-medium text-foreground"
          >
            {t("workspaceExcludes")}
          </label>
          <p className="mb-2.5 text-[12px] leading-[1.5] text-muted-foreground">
            {t("workspaceExcludesDesc")}
          </p>
          <textarea
            id="workspace-excludes"
            rows={4}
            spellCheck={false}
            // Uncontrolled between edits on purpose: normalizing on every keystroke would eat the
            // newline the user just typed before they could type the next name.
            defaultValue={excludedScanDirs.join("\n")}
            onBlur={(event) => setExcludedScanDirs(parseExcludedScanDirs(event.target.value))}
            placeholder={t("workspaceExcludesPlaceholder")}
            className="w-full resize-y rounded-[6px] border border-border bg-background px-2.5 py-2 font-mono text-[12px] leading-[1.6] text-foreground outline-none focus-visible:border-[var(--focus-ring)]"
          />
        </div>
      </FlatCard>
    </SettingsSection>
  );
}
