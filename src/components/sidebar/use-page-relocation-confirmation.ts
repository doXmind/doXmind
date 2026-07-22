"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";

import type { FolderLinkRelocationPlan, PageLinkRelocationPlan } from "@/lib/page-link-relocation";

/** Present one source-backed impact summary before a Page path changes. */
export function usePageRelocationConfirmation() {
  const t = useTranslations("sidebar");
  return useCallback(
    (plan: PageLinkRelocationPlan | FolderLinkRelocationPlan) => {
      const links = plan.writes.reduce((count, write) => count + write.replacements.length, 0);
      const pages = plan.writes.length;
      const skipped = plan.skipped.length;
      if (links === 0 && skipped === 0) return true;
      return window.confirm(t("confirmPageRelocation", { links, pages, skipped }));
    },
    [t]
  );
}
