import { describe, it, expect, beforeEach } from "vitest";
import { getMermaidThemeKey, subscribeMermaidTheme } from "@/lib/mermaid-renderer";

describe("mermaid-renderer theme subscription", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.classList.remove("dark");
  });

  it("derives a stable theme key from <html> attributes", () => {
    expect(getMermaidThemeKey()).toBe("notion-light");

    document.documentElement.classList.add("dark");
    expect(getMermaidThemeKey()).toBe("dark-dark");

    document.documentElement.setAttribute("data-theme", "solarized");
    expect(getMermaidThemeKey()).toBe("solarized-dark");

    document.documentElement.classList.remove("dark");
    expect(getMermaidThemeKey()).toBe("solarized-light");
  });

  it("notifies subscribers when data-theme flips", async () => {
    const calls: string[] = [];
    const unsubscribe = subscribeMermaidTheme(() => calls.push(getMermaidThemeKey()));

    document.documentElement.setAttribute("data-theme", "github");

    // MutationObserver fires on a microtask boundary.
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    expect(calls).toContain("github-light");
    unsubscribe();
  });

  it("notifies subscribers when the dark class flips", async () => {
    const calls: string[] = [];
    const unsubscribe = subscribeMermaidTheme(() => calls.push(getMermaidThemeKey()));

    document.documentElement.classList.add("dark");
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    expect(calls.some((k) => k.endsWith("-dark"))).toBe(true);
    unsubscribe();
  });

  it("does not fire when an irrelevant attribute mutates", async () => {
    const calls: string[] = [];
    const unsubscribe = subscribeMermaidTheme(() => calls.push(getMermaidThemeKey()));

    document.documentElement.setAttribute("lang", "fr");
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    expect(calls).toHaveLength(0);
    unsubscribe();
  });

  it("collapses redundant attribute writes that don't actually change the theme key", async () => {
    document.documentElement.setAttribute("data-theme", "notion");

    const calls: string[] = [];
    const unsubscribe = subscribeMermaidTheme(() => calls.push(getMermaidThemeKey()));

    // Re-asserting the same theme writes the attribute but our key is unchanged.
    document.documentElement.setAttribute("data-theme", "notion");
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    expect(calls).toHaveLength(0);
    unsubscribe();
  });
});
