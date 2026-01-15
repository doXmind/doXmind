"use client";

import { useEffect } from "react";
import { useLayoutStore } from "@/stores/layout-store";

/**
 * Hook to apply high contrast mode on initial page load
 * This ensures the high-contrast class is applied based on persisted preference
 */
export function useHighContrast() {
  const isHighContrast = useLayoutStore((state) => state.isHighContrast);

  useEffect(() => {
    if (typeof document !== "undefined") {
      if (isHighContrast) {
        document.documentElement.classList.add("high-contrast");
      } else {
        document.documentElement.classList.remove("high-contrast");
      }
    }
  }, [isHighContrast]);
}
