"use client";

/**
 * Adaptive Nav (Mobile Bottom Navigation)
 *
 * Fixed bottom navigation with:
 * - Files button (opens file sidebar)
 *
 * Hidden when block selection is active (action bar shows instead).
 */

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { FolderOpen } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/stores/layout-store";
import { useBlockSelectionStore } from "@/stores/block-selection-store";
import { Z_INDEX, MOBILE_V2, MOBILE_SPRINGS } from "@/lib/constants";
import { haptics } from "@/lib/haptics";

export function AdaptiveNav() {
  const t = useTranslations("mobile");
  const { setMobileSidebarOpen, isMobileSidebarOpen } = useLayoutStore();
  const { isSelectionActive } = useBlockSelectionStore();

  const handleFiles = useCallback(() => {
    haptics.light();
    setMobileSidebarOpen(true);
  }, [setMobileSidebarOpen]);

  // Hide when block selection action bar should show
  if (isSelectionActive) {
    return null;
  }

  return (
    <motion.nav
      className={cn(
        "fixed bottom-0 left-0 right-0",
        "border-t border-border/50 bg-background/95 backdrop-blur-xl",
        "flex items-center justify-around",
        "md:hidden"
      )}
      style={{
        zIndex: Z_INDEX.BOTTOM_NAV,
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        height: MOBILE_V2.NAV_BAR_HEIGHT,
      }}
      initial={{ y: 100 }}
      animate={{ y: 0 }}
      transition={{ type: "spring", ...MOBILE_SPRINGS.SMOOTH }}
    >
      {/* Files Button */}
      <button
        type="button"
        onClick={handleFiles}
        className={cn(
          "flex flex-col items-center justify-center gap-0.5 rounded-xl transition-colors",
          "active:scale-95 active:bg-accent/50",
          isMobileSidebarOpen ? "text-primary" : "text-muted-foreground hover:text-foreground"
        )}
        style={{
          minWidth: MOBILE_V2.NAV_BUTTON_SIZE,
          height: MOBILE_V2.NAV_BUTTON_SIZE,
          padding: "8px 16px",
        }}
      >
        <div className="flex h-5 w-5 items-center justify-center">
          <FolderOpen className="h-5 w-5" />
        </div>
        <span className="text-ui-xs font-medium">{t("files")}</span>
      </button>
    </motion.nav>
  );
}
