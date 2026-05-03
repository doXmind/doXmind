"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { SettingsRail } from "@/components/settings/settings-rail";
import type { SettingsSectionDef } from "@/components/settings/settings-atoms";
import { AppearanceSection } from "@/components/settings/sections/appearance-section";
import { TypographySection } from "@/components/settings/sections/typography-section";
import { WorkspaceSection } from "@/components/settings/sections/workspace-section";
import { TrashSection } from "@/components/settings/sections/trash-section";
import { AboutSection } from "@/components/settings/sections/about-section";
import { useIsTauri } from "@/hooks/use-is-tauri";
import { cn } from "@/lib/utils";

const SECTION_IDS = ["appearance", "typography", "workspace", "trash", "about"] as const;
type SectionId = (typeof SECTION_IDS)[number];

const SECTION_ID_SET = new Set<string>(SECTION_IDS);

// Preserve back-compat with the old `?tab=workspace|trash|general` URLs the
// tray, header, and sidebar links still emit. Falls through to the default
// section when the value is unrecognised or missing.
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
  const { isTauri, platform } = useIsTauri();
  const isMacTauri = isTauri && platform === "macos";
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState<SectionId>("appearance");

  const sections: readonly SettingsSectionDef[] = useMemo(
    () => [
      { id: "appearance", label: t("appearance") },
      { id: "typography", label: t("typography") },
      { id: "workspace", label: t("workspace") },
      { id: "trash", label: t("tabTrash") },
      { id: "about", label: t("about") },
    ],
    [t]
  );

  const jump = useCallback((id: string) => {
    if (!SECTION_ID_SET.has(id)) return;
    setActive(id as SectionId);
    const sc = scrollerRef.current;
    const el = sc?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (sc && el) {
      sc.scrollTo({ top: el.offsetTop - 64, behavior: "smooth" });
    }
    window.history.replaceState({}, "", `/settings?section=${id}`);
  }, []);

  // On mount, jump to the section parsed from the URL — preserves deep links
  // from the old tab-based system.
  useEffect(() => {
    const initial = readInitialSection();
    setActive(initial);
    // Defer until after layout so offsetTop is correct.
    const raf = requestAnimationFrame(() => {
      const sc = scrollerRef.current;
      const el = sc?.querySelector<HTMLElement>(`#${CSS.escape(initial)}`);
      if (sc && el) sc.scrollTo({ top: el.offsetTop - 64 });
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  // Scroll spy — match design's behaviour: the section whose top is closest
  // above the current scroll position becomes active.
  useEffect(() => {
    const sc = scrollerRef.current;
    if (!sc) return;
    const onScroll = () => {
      const probe = sc.scrollTop + 120;
      let cur: SectionId = SECTION_IDS[0];
      for (const id of SECTION_IDS) {
        const el = sc.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
        if (el && el.offsetTop <= probe) cur = id;
      }
      setActive(cur);
    };
    sc.addEventListener("scroll", onScroll, { passive: true });
    return () => sc.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div ref={scrollerRef} className="settings-surface relative h-[100dvh] overflow-y-auto">
      {/* Sticky topbar — back link + page title only. Tauri drag region keeps
          the window draggable from this strip. Solid (no backdrop blur) so
          the surface reads as paper, not glass. */}
      <div
        data-tauri-drag-region
        className={cn(
          "sticky top-0 z-10 flex items-center gap-3.5 border-b border-border/70 bg-background px-6",
          "h-11",
          isMacTauri && "pl-[88px]"
        )}
      >
        <Link
          href="/editor"
          className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("backToEditor")}
        </Link>
        <span className="text-[13px] font-semibold text-foreground">{t("pageTitle")}</span>
      </div>

      <div className="mx-auto grid max-w-[880px] grid-cols-[180px_minmax(0,1fr)] gap-10 px-8 pb-20 pt-8">
        <SettingsRail
          sections={sections}
          active={active}
          onJump={jump}
          heading={t("railHeading")}
          footer={
            <>
              {t("railFooterLine1")}
              <br />
              {t("railFooterLine2")}
            </>
          }
        />

        <main>
          <AppearanceSection />
          <TypographySection />
          <WorkspaceSection />
          <TrashSection />
          <AboutSection />
        </main>
      </div>
    </div>
  );
}
