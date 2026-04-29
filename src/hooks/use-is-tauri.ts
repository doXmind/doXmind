"use client";

import { useEffect, useState } from "react";

declare global {
  interface Window {
    __TAURI_PLATFORM__?: "macos" | "windows" | "linux";
  }
}

/**
 * Detect whether the page is running inside the Tauri shell, and if so on
 * which OS. The values come from the initialization script defined in
 * src-tauri/src/lib.rs, which runs before any frontend code.
 *
 * Returns { isTauri, platform } where `platform` is non-null only when
 * `isTauri` is true. The state starts at `{ isTauri: false }` so server-side
 * rendering and the first client paint agree — the real value is set in a
 * mount effect to avoid hydration mismatches.
 */
export function useIsTauri() {
  const [state, setState] = useState<{
    isTauri: boolean;
    platform: "macos" | "windows" | "linux" | null;
  }>({ isTauri: false, platform: null });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isTauri = !!window.__TAURI_BACKEND_URL__;
    setState({ isTauri, platform: isTauri ? (window.__TAURI_PLATFORM__ ?? null) : null });
  }, []);

  return state;
}
