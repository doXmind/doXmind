"use client";

import { useEffect } from "react";
import { useAppearanceStore } from "@/stores/appearance-store";
import { useLayoutStore } from "@/stores/layout-store";
import { resolveFontStack, type FontFamilyId } from "@/lib/font-options";

const STYLE_ID = "doxmind-appearance-style";

interface AppearanceSnapshot {
  uiFontSize: number;
  codeFontSize: number;
  fontFamily: FontFamilyId;
}

/**
 * Writes user appearance preferences (UI/code font size, font family) into a
 * single dynamically-injected `<style>` element on the document. Subscribing
 * directly to the Zustand stores
 * (rather than re-rendering React on each change) keeps the entire UI
 * in sync without forcing a tree update.
 */
function buildCss(s: AppearanceSnapshot): string {
  const rules: string[] = [];

  rules.push(
    `:root {
      --ui-font-size-base: ${s.uiFontSize}px;
      --ui-code-font-size-base: ${s.codeFontSize}px;
    }`
  );

  // Apply font-family at the <html>/<body> level so the entire app —
  // chrome sidebar, header, dropdowns, editor — share one font. We
  // need `!important` because layout.tsx puts Tailwind's `.font-sans`
  // utility on <body>, which has higher specificity than a plain html
  // selector. Code surfaces (`code/kbd/pre/.font-mono`) keep their mono
  // stack via the rule in globals.css. `null` from resolveFontStack
  // (e.g. for the default "system" preset) emits no rule and falls
  // back to body's `font-sans` utility.
  const familyStack = resolveFontStack(s.fontFamily);
  if (familyStack) {
    rules.push(`html, body { font-family: ${familyStack} !important; }`);
  }

  return rules.join("\n");
}

function readSnapshot(): AppearanceSnapshot {
  const a = useAppearanceStore.getState();
  const l = useLayoutStore.getState();
  return {
    uiFontSize: a.uiFontSize,
    codeFontSize: a.codeFontSize,
    fontFamily: l.fontFamily,
  };
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
      el!.textContent = buildCss(readSnapshot());
    };

    apply();
    const unsubA = useAppearanceStore.subscribe(apply);
    const unsubL = useLayoutStore.subscribe(apply);
    return () => {
      unsubA();
      unsubL();
    };
  }, []);

  return null;
}
