"use client";

import { useEffect } from "react";
import { useAppearanceStore } from "@/stores/appearance-store";

const STYLE_ID = "doxmind-appearance-style";

/**
 * Writes user appearance preferences (UI font size, code font size,
 * pointer-cursor preference) into a single dynamically-injected `<style>`
 * element on the document. Subscribing directly to the Zustand store
 * (instead of re-rendering on each change) keeps the entire UI in sync
 * without forcing a React tree update.
 */
function buildCss(state: ReturnType<typeof useAppearanceStore.getState>): string {
  const rules: string[] = [];

  rules.push(
    `:root {
      --ui-font-size-base: ${state.uiFontSize}px;
      --ui-code-font-size-base: ${state.codeFontSize}px;
    }`
  );

  if (state.pointerCursors) {
    rules.push(
      `button:not([disabled]),
       [role="button"]:not([aria-disabled="true"]),
       a[href],
       [role="link"],
       [role="tab"],
       [role="menuitem"],
       [role="option"],
       label[for],
       summary,
       select,
       input[type="checkbox"],
       input[type="radio"] { cursor: pointer; }`
    );
  }

  return rules.join("\n");
}

export function AppearanceInjector() {
  useEffect(() => {
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
      document.head.appendChild(el);
    }

    const apply = () => {
      el!.textContent = buildCss(useAppearanceStore.getState());
    };

    apply();
    return useAppearanceStore.subscribe(apply);
  }, []);

  return null;
}
