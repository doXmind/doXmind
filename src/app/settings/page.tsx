"use client";

import { useEffect, useMemo, useState } from "react";
import { Palette, Type, Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { SettingsNav, type SettingsNavItem } from "@/components/settings/settings-rail";
import { AppearanceSection } from "@/components/settings/sections/appearance-section";
import { TypographySection } from "@/components/settings/sections/typography-section";
import { AboutSection } from "@/components/settings/sections/about-section";

const SECTION_IDS = ["appearance", "typography", "about"] as const;
type SectionId = (typeof SECTION_IDS)[number];

const SECTION_ID_SET = new Set<string>(SECTION_IDS);

// Preserve back-compat with the old `?tab=workspace|general` URLs the tray,
// header, and sidebar links still emit. The legacy `?tab=trash` deep link
// (from before ADR 0005) falls through to the default section since the
// in-app Trash UI no longer exists — recovery is via OS Trash.
function readInitialSection(): SectionId {
  if (typeof window === "undefined") return "appearance";
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("section") ?? params.get("tab");
  if (raw && SECTION_ID_SET.has(raw)) return raw as SectionId;
  if (raw === "general") return "appearance";
  return "appearance";
}

export default function SettingsPage() {
  const t = useTranslations("settings");
  const [active, setActive] = useState<SectionId>("appearance");
  const [query, setQuery] = useState("");

  const items: readonly SettingsNavItem[] = useMemo(
    () => [
      { id: "appearance", label: t("appearance"), icon: Palette },
      { id: "typography", label: t("typography"), icon: Type },
      { id: "about", label: t("about"), icon: Info },
    ],
    [t]
  );

  // Honor deep links from the old tab-based system (e.g. the tray's
  // `?section=typography`) by selecting that section on mount.
  useEffect(() => {
    setActive(readInitialSection());
  }, []);

  const select = (id: string) => {
    if (!SECTION_ID_SET.has(id)) return;
    setActive(id as SectionId);
    window.history.replaceState({}, "", `/settings?section=${id}`);
  };

  return (
    <div className="settings-surface relative flex h-[100dvh] overflow-hidden">
      {/* Window-drag strip across the top. The traffic lights sit over its
          left end; the rail's back/search controls start below it (pt-[44px])
          so the Chromium drag region never swallows their clicks. */}
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 z-10 h-[38px]" />

      <SettingsNav
        items={items}
        active={active}
        onSelect={select}
        query={query}
        onQueryChange={setQuery}
        backLabel={t("backToApp")}
        searchPlaceholder={t("searchSettings")}
      />

      <main className="h-full flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[680px] px-10 pb-20 pt-[44px]">
          {active === "appearance" && <AppearanceSection />}
          {active === "typography" && <TypographySection />}
          {active === "about" && <AboutSection />}
        </div>
      </main>
    </div>
  );
}
