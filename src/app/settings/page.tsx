"use client";

import { useEffect, useState } from "react";
import { SettingsSidebar } from "@/components/settings/settings-sidebar";
import { GeneralTab } from "@/components/settings/general-tab";
import { TypographyTab } from "@/components/settings/typography-tab";
import { toSettingsTabId, type SettingsTabId } from "@/components/settings/settings-tabs";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTabId>("general");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setActiveTab(toSettingsTabId(params.get("tab")));
  }, []);

  const navigateTab = (tab: SettingsTabId) => {
    setActiveTab(tab);
    const url = `/settings?tab=${tab}`;
    window.history.replaceState({}, "", url);
  };

  return (
    <div className="desktop-window-shell flex bg-background" style={{ height: "100dvh" }}>
      <SettingsSidebar activeTab={activeTab} onSelectTab={navigateTab} />

      <main className="desktop-content-surface flex min-w-0 flex-1 flex-col">
        {/* Empty drag-region strip so the window can still be dragged from
            the top of the content area and the traffic-light cluster has
            its usual top inset. The visible page heading is rendered by
            each tab below. */}
        <div data-tauri-drag-region className="h-14 shrink-0" />

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-8 pb-12 pt-2">
            {activeTab === "general" && <GeneralTab />}
            {activeTab === "typography" && <TypographyTab />}
          </div>
        </div>
      </main>
    </div>
  );
}
