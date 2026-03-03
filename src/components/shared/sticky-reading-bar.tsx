"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Play, Search } from "lucide-react";
import { useLayoutStore } from "@/stores/layout-store";

interface StickyReadingBarProps {
  title: string;
  /** Ref to the original header element — sticky bar shows when this is out of view */
  triggerRef: React.RefObject<HTMLDivElement | null>;
}

export function StickyReadingBar({ title, triggerRef }: StickyReadingBarProps) {
  const t = useTranslations("sharedView");
  const [visible, setVisible] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        setVisible(!entry.isIntersecting);
      },
      { threshold: 0 }
    );

    observerRef.current.observe(trigger);
    return () => observerRef.current?.disconnect();
  }, [triggerRef]);

  if (!visible) return null;

  return (
    <div className="sticky top-0 z-30 border-b border-border/40 bg-background/95 backdrop-blur-sm">
      <div className="mx-auto flex h-12 max-w-3xl items-center justify-between gap-4 px-6 sm:px-8 lg:max-w-5xl">
        <h2 className="min-w-0 truncate text-sm font-medium text-foreground">{title}</h2>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => useLayoutStore.getState().setPresentationMode(true)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t("present")}
          >
            <Play className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => useLayoutStore.getState().setSearchBarOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t("searchInDocument")}
          >
            <Search className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
