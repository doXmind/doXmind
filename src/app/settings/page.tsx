"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { SettingsSidebar } from "@/components/settings/settings-sidebar";
import { GeneralTab } from "@/components/settings/general-tab";
import { toSettingsTabId, type SettingsTabId } from "@/components/settings/settings-tabs";

// General is the default landing tab — keep it eager so first paint has no
// chunk fetch. The other two tabs subscribe to the file store, pull in modal
// dialogs, native dialog bindings, etc., so deferring them keeps the initial
// /settings bundle small and the navigation snappy.
const TabFallback = () => <div className="h-32" aria-hidden />;

const WorkspaceTab = dynamic(
  () => import("@/components/settings/workspace-tab").then((m) => ({ default: m.WorkspaceTab })),
  { ssr: false, loading: TabFallback }
);

const TrashTab = dynamic(
  () => import("@/components/settings/trash-tab").then((m) => ({ default: m.TrashTab })),
  { ssr: false, loading: TabFallback }
);

// Resolve the initial tab synchronously from the URL so the first paint
// already shows the correct panel — avoids the "flash of General" that the
// previous useEffect-based parse caused when navigating to ?tab=trash.
function readInitialTab(): SettingsTabId {
  if (typeof window === "undefined") return "general";
  const params = new URLSearchParams(window.location.search);
  return toSettingsTabId(params.get("tab"));
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTabId>(readInitialTab);

  // Warm the lazy tab chunks during browser idle so subsequent tab switches
  // feel instant instead of waiting on a chunk fetch + parse on first click.
  useEffect(() => {
    const warm = () => {
      void import("@/components/settings/workspace-tab");
      void import("@/components/settings/trash-tab");
    };
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
    };
    if (typeof w.requestIdleCallback === "function") {
      const handle = w.requestIdleCallback(warm, { timeout: 1500 });
      return () => {
        const cancel = (window as Window & { cancelIdleCallback?: (handle: number) => void })
          .cancelIdleCallback;
        cancel?.(handle);
      };
    }
    const t = window.setTimeout(warm, 200);
    return () => window.clearTimeout(t);
  }, []);

  const navigateTab = useCallback((tab: SettingsTabId) => {
    setActiveTab(tab);
    window.history.replaceState({}, "", `/settings?tab=${tab}`);
  }, []);

  return (
    <div className="desktop-window-shell flex bg-background" style={{ height: "100dvh" }}>
      <SettingsSidebar activeTab={activeTab} onSelectTab={navigateTab} />

      <main className="desktop-content-surface flex min-w-0 flex-1 flex-col">
        {/* Empty drag-region strip so the window can still be dragged from
            the top of the content area and the traffic-light cluster has
            its usual top inset. The visible page heading is rendered by
            each tab below. */}
        <div data-tauri-drag-region className="h-11 shrink-0" />

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-8 pb-12 pt-2">
            {activeTab === "general" && <GeneralTab />}
            {activeTab === "workspace" && <WorkspaceTab />}
            {activeTab === "trash" && <TrashTab />}
          </div>
        </div>
      </main>
    </div>
  );
}
