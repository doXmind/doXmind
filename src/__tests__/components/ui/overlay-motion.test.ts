import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import tailwindConfig from "../../../../tailwind.config";

/**
 * Every overlay in the app — menus, sub-menus, the tooltip, the popover, the command palette, the
 * quick switcher, the sidebar's file context menu — declared `animate-in fade-in-0 zoom-in-95`.
 * Those are `tailwindcss-animate` class names and that plugin was never a dependency, so all of it
 * compiled to nothing: measured on the packaged app, an opened menu read `animationName: none` at
 * every frame from the click, and the only `@keyframes` shipped were `pulse` and `spin`.
 *
 * The used subset is now defined in tailwind.config.ts at the reference's menu-entry duration
 * (docs/BLOCK_UX_REFERENCE.md, "Motion": around 150ms). These tests run the plugin and pin both
 * halves of that: the utilities exist with the agreed duration, and no component declares an
 * animation class the config does not define.
 */

type Css = Record<string, Record<string, string>>;

function runAnimationPlugin(): { base: Css; utilities: Css } {
  const base: Css = {};
  const utilities: Css = {};
  const plugins = tailwindConfig.plugins as {
    handler: (api: { addBase: (css: Css) => void; addUtilities: (css: Css) => void }) => void;
  }[];
  expect(plugins).toHaveLength(1);
  plugins[0].handler({
    addBase: (css) => Object.assign(base, css),
    addUtilities: (css) => Object.assign(utilities, css),
  });
  return { base, utilities };
}

describe("overlay entry animation", () => {
  const { base, utilities } = runAnimationPlugin();

  it("ships an `enter` keyframe the utilities can drive", () => {
    const enter = base["@keyframes enter"] as unknown as { from: Record<string, string> };
    expect(enter).toBeDefined();
    // The from-state is variable-driven so one keyframe serves fade, zoom and slide together —
    // an element that opts into only `fade-in-0` must not also get scaled or translated.
    expect(enter.from.opacity).toBe("var(--tw-enter-opacity, 1)");
    expect(enter.from.transform).toContain("var(--tw-enter-translate-y, 0)");
    expect(enter.from.transform).toContain("var(--tw-enter-scale, 1)");
  });

  it("runs the entry at the reference's ~150ms, once, on the way in", () => {
    expect(utilities[".animate-in"]).toMatchObject({
      animationName: "enter",
      animationDuration: "150ms",
      animationTimingFunction: "ease-out",
    });
  });

  it("resets every enter variable so an unrequested axis stays at its identity", () => {
    for (const variable of [
      "--tw-enter-opacity",
      "--tw-enter-scale",
      "--tw-enter-translate-x",
      "--tw-enter-translate-y",
    ]) {
      expect(utilities[".animate-in"][variable]).toBe("initial");
    }
  });

  it("gives each modifier the one variable it names", () => {
    expect(utilities[".fade-in-0"]).toEqual({ "--tw-enter-opacity": "0" });
    expect(utilities[".zoom-in-95"]).toEqual({ "--tw-enter-scale": ".95" });
    expect(utilities[".slide-in-from-top-2"]).toEqual({ "--tw-enter-translate-y": "-0.5rem" });
  });
});

/** `animate-spin` / `animate-pulse` are core Tailwind; everything else here came from the plugin. */
const ANIMATE_CLASS =
  /\b(?:animate-(?:in|out)|(?:fade|zoom)-(?:in|out)-[\w.]+|slide-(?:in|out)-(?:from|to)-[\w-]+)\b/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("no component declares an animation class that compiles to nothing", () => {
  const { utilities } = runAnimationPlugin();
  const defined = new Set(Object.keys(utilities).map((selector) => selector.slice(1)));

  it("covers every animation class used in src", () => {
    const used = new Map<string, string>();
    for (const file of sourceFiles(join(process.cwd(), "src"))) {
      for (const match of readFileSync(file, "utf8").matchAll(ANIMATE_CLASS)) {
        if (!used.has(match[0])) used.set(match[0], file);
      }
    }
    // Guards against the test quietly passing on an empty scan.
    expect(used.size).toBeGreaterThan(0);

    const dead = [...used].filter(([name]) => !defined.has(name));
    expect(dead).toEqual([]);
  });
});
