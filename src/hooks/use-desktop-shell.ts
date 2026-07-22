"use client";

import { useEffect, useState } from "react";
import { desktopPlatform, hasDesktopBridge, type DesktopPlatform } from "@/lib/native-shell";

/** Hydration-safe Electron shell detection for desktop-only affordances. */
export function useDesktopShell() {
  const [state, setState] = useState<{
    isDesktop: boolean;
    platform: DesktopPlatform | null;
  }>({ isDesktop: false, platform: null });

  useEffect(() => {
    const isDesktop = hasDesktopBridge();
    setState({ isDesktop, platform: isDesktop ? desktopPlatform() : null });
  }, []);

  return state;
}
