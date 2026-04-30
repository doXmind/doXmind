import { FolderKanban, Settings, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface SettingsTab {
  id: string;
  icon: LucideIcon;
  labelKey: string;
}

export const SETTINGS_TABS = [
  { id: "general", icon: Settings, labelKey: "tabGeneral" },
  { id: "workspace", icon: FolderKanban, labelKey: "tabWorkspace" },
  { id: "trash", icon: Trash2, labelKey: "tabTrash" },
] as const satisfies readonly SettingsTab[];

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

export const SETTINGS_TAB_IDS = new Set<string>(SETTINGS_TABS.map((t) => t.id));

export const toSettingsTabId = (value: string | null | undefined): SettingsTabId =>
  SETTINGS_TAB_IDS.has(value ?? "") ? (value as SettingsTabId) : "general";
