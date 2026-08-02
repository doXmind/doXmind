import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME, THEMES } from "@/lib/themes/registry";
import type { ThemeTokens } from "@/lib/themes/types";

/**
 * Contrast is a measured property, not a design opinion, so it is pinned by measurement.
 *
 * The defect this guards against is asymmetry: every colour audit of this app found the dark theme
 * tuned and the light one not — the same token passing on a dark surface and failing on its light
 * twin, because whoever picked the value was looking at a dark screen. Two rules follow:
 *
 *   1. Every foreground/surface pair clears 4.5:1 (WCAG AA, body text) in BOTH themes.
 *   2. Where either theme is under 8:1, the two themes' ratios stay within 1.5x of each other.
 *      Above 8:1 the difference stops being legible, so the check would only be noise there.
 *
 * Scope is doXmind's own default themes plus the base stylesheet — the palettes this product
 * chose. The other registry entries (Notion, GitHub, VS Code, One, Solarized, Tokyo, Catppuccin,
 * Gruvbox) are faithful ports of someone else's published palette; holding them to this bar would
 * mean rewriting their identity, so they are deliberately not pinned here.
 */

const BAR = 4.5;
/** Above this, a difference between the themes is no longer something a reader can perceive. */
const SYMMETRY_CEILING = 8;
const SYMMETRY_FACTOR = 1.5;

type Rgb = readonly [number, number, number];

/** `"0 74% 45%"` — the shape every token in this codebase is stored in. */
function hslTokenToRgb(token: string): Rgb {
  const parts = token.trim().split(/\s+/);
  const h = Number.parseFloat(parts[0]);
  const s = Number.parseFloat(parts[1]) / 100;
  const l = Number.parseFloat(parts[2]) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = l - c / 2;
  return [r + m, g + m, b + m].map((v) => Math.round(v * 255)) as unknown as Rgb;
}

function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (raw: number) => {
    const v = raw / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const hex = ([r, g, b]: Rgb) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0").toUpperCase()).join("")}`;

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Every foreground token paired with the surface it is actually painted on.
 *
 * `--muted-foreground` appears twice on purpose: it is used both on the page and on `bg-muted`
 * chips, and the muted surface is the harder of the two. `--destructive` appears three times for
 * the same reason — it is `text-destructive` on the page, on a popover, and on `bg-muted`.
 */
const PAIRS: ReadonlyArray<readonly [keyof ThemeTokens, keyof ThemeTokens]> = [
  ["foreground", "background"],
  ["cardForeground", "card"],
  ["popoverForeground", "popover"],
  ["secondaryForeground", "secondary"],
  ["accentForeground", "accent"],
  ["primaryForeground", "primary"],
  ["mutedForeground", "background"],
  ["mutedForeground", "muted"],
  ["destructive", "background"],
  ["destructive", "popover"],
  ["destructive", "muted"],
  // The one pair that inverts: `bg-destructive text-destructive-foreground` on the confirm
  // dialog's Delete button. In dark `--destructive` is a light fill, so its foreground is ink.
  ["destructiveForeground", "destructive"],
];

const GLOBALS_PATH = join(process.cwd(), "src/app/globals.css");

/** globals.css with comments stripped, so a ratio quoted in prose is never parsed as a value. */
function readGlobalsBlock(selector: ":root" | ".dark"): string {
  const css = readFileSync(GLOBALS_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  // Anchored so `.dark` does not also match `.dark.high-contrast`.
  const block = new RegExp(
    `(^|[\\s{}])${selector.replace(".", "\\.")}\\s*\\{([^{}]*)\\}`,
    "m"
  ).exec(css);
  expect(block, `globals.css has a ${selector} block`).not.toBeNull();
  return block![2];
}

/** The `:root` / `.dark` blocks of globals.css, read as a token set of the same shape. */
function readGlobalsPalette(selector: ":root" | ".dark"): ThemeTokens {
  const body = readGlobalsBlock(selector);
  const cssVarFor: Record<string, string> = {
    background: "--background",
    foreground: "--foreground",
    card: "--card",
    cardForeground: "--card-foreground",
    popover: "--popover",
    popoverForeground: "--popover-foreground",
    primary: "--primary",
    primaryForeground: "--primary-foreground",
    secondary: "--secondary",
    secondaryForeground: "--secondary-foreground",
    muted: "--muted",
    mutedForeground: "--muted-foreground",
    accent: "--accent",
    accentForeground: "--accent-foreground",
    destructive: "--destructive",
    destructiveForeground: "--destructive-foreground",
    border: "--border",
    borderSubtle: "--border-subtle",
    input: "--input",
    ring: "--ring",
    sidebar: "--sidebar",
  };
  const tokens: Record<string, string> = {};
  for (const [key, cssVar] of Object.entries(cssVarFor)) {
    const match = new RegExp(`${cssVar}:\\s*([\\d.]+\\s+[\\d.]+%\\s+[\\d.]+%)\\s*;`).exec(body);
    if (match) tokens[key] = match[1];
  }
  return tokens as unknown as ThemeTokens;
}

const PALETTES: ReadonlyArray<{ name: string; light: ThemeTokens; dark: ThemeTokens }> = [
  {
    name: "default themes",
    light: THEMES[DEFAULT_LIGHT_THEME].tokens,
    dark: THEMES[DEFAULT_DARK_THEME].tokens,
  },
  {
    name: "globals.css base palette",
    light: readGlobalsPalette(":root"),
    dark: readGlobalsPalette(".dark"),
  },
];

describe.each(PALETTES)("$name", ({ light, dark }) => {
  describe.each([
    ["light", light],
    ["dark", dark],
  ] as const)("%s clears the AA bar", (_mode, tokens) => {
    it.each(PAIRS)("%s on %s", (fgKey, bgKey) => {
      const fg = hslTokenToRgb(tokens[fgKey]);
      const bg = hslTokenToRgb(tokens[bgKey]);
      const ratio = round(contrast(fg, bg));
      expect(
        ratio,
        `${String(fgKey)} ${hex(fg)} on ${String(bgKey)} ${hex(bg)} = ${ratio}:1`
      ).toBeGreaterThanOrEqual(BAR);
    });
  });

  // The actual defect: a token tuned against one theme and shipped into the other.
  it.each(PAIRS)("keeps %s on %s at comparable strength in both themes", (fgKey, bgKey) => {
    const lightRatio = contrast(hslTokenToRgb(light[fgKey]), hslTokenToRgb(light[bgKey]));
    const darkRatio = contrast(hslTokenToRgb(dark[fgKey]), hslTokenToRgb(dark[bgKey]));
    if (lightRatio >= SYMMETRY_CEILING && darkRatio >= SYMMETRY_CEILING) return;
    const drift = Math.max(lightRatio, darkRatio) / Math.min(lightRatio, darkRatio);
    expect(
      round(drift),
      `${String(fgKey)} on ${String(bgKey)}: light ${round(lightRatio)}:1 vs dark ${round(darkRatio)}:1`
    ).toBeLessThanOrEqual(SYMMETRY_FACTOR);
  });
});

/**
 * The colour tokens that live only in globals.css, because they have no slot in `ThemeTokens`.
 *
 * These replace values that used to be written as a one-off hex or a single alpha inside a rule or
 * a Tailwind class — the shape of the defect every colour audit of this app found, because a hex
 * in a rule has nowhere to record the surface it was checked against. Each is a light/dark pair
 * measured against the surface it is actually painted on, in every palette this product ships.
 */
type SurfaceKey = "background" | "muted" | "popover";

interface TokenSpec {
  /** CSS custom property name, without the leading `--`. */
  readonly token: string;
  readonly on: SurfaceKey;
  readonly min: number;
  /**
   * Set only for tokens that are a *surface delta* rather than text — a hover fill, a grid line, a
   * zebra row, a popover ring. Those have a ceiling as well as a floor: too weak and the state is
   * invisible, too strong and a quiet document turns into a spreadsheet. The band is what keeps the
   * two themes at the same perceived weight, which a floor alone cannot do.
   */
  readonly max?: number;
}

const AA = 4.5;

const GLOBALS_ONLY_TOKENS: readonly TokenSpec[] = [
  // highlight.js scopes, painted on a code Block's --muted surface at 12px.
  { token: "code-keyword", on: "muted", min: AA },
  { token: "code-string", on: "muted", min: AA },
  { token: "code-number", on: "muted", min: AA },
  { token: "code-title", on: "muted", min: AA },
  { token: "code-attr", on: "muted", min: AA },
  { token: "code-name", on: "muted", min: AA },
  // Inline code sits on the same tint, at prose size.
  { token: "code-inline", on: "muted", min: AA },
  // Placeholder text is text.
  { token: "placeholder-fg", on: "background", min: AA },
  // Outline popover rungs, 13px on the panel.
  { token: "outline-heading-2-fg", on: "popover", min: AA },
  { token: "outline-heading-3-fg", on: "popover", min: AA },
  // Surface deltas.
  { token: "control-hover", on: "background", min: 1.15, max: 1.35 },
  { token: "table-border", on: "background", min: 1.8, max: 2.35 },
  { token: "table-row-alt", on: "background", min: 1.05, max: 1.25 },
  { token: "popover-ring", on: "background", min: 1.5, max: 1.85 },
];

function readGlobalsToken(selector: ":root" | ".dark", token: string): string {
  const body = readGlobalsBlock(selector);
  const match = new RegExp(`--${token}:\\s*([\\d.]+\\s+[\\d.]+%\\s+[\\d.]+%)\\s*;`).exec(body);
  expect(match, `globals.css ${selector} declares --${token} as an HSL triple`).not.toBeNull();
  return match![1];
}

const GLOBALS_TOKEN_MODES = [
  { mode: "light" as const, selector: ":root" as const },
  { mode: "dark" as const, selector: ".dark" as const },
];

describe.each(PALETTES)("globals-only tokens over the $name surfaces", ({ light, dark }) => {
  const surfaces = { light, dark };

  describe.each(GLOBALS_TOKEN_MODES)("$mode", ({ mode, selector }) => {
    it.each(GLOBALS_ONLY_TOKENS)("--$token on --$on", ({ token, on, min, max }) => {
      const fg = hslTokenToRgb(readGlobalsToken(selector, token));
      const bg = hslTokenToRgb(surfaces[mode][on]);
      const ratio = round(contrast(fg, bg));
      const label = `--${token} ${hex(fg)} on --${on} ${hex(bg)} = ${ratio}:1`;
      expect(ratio, label).toBeGreaterThanOrEqual(min);
      if (max !== undefined) expect(ratio, label).toBeLessThanOrEqual(max);
    });
  });

  // The defect itself: one theme tuned, the other inheriting the number by accident.
  it.each(GLOBALS_ONLY_TOKENS)("keeps --$token comparable in both themes", ({ token, on, max }) => {
    const lightRatio = contrast(
      hslTokenToRgb(readGlobalsToken(":root", token)),
      hslTokenToRgb(light[on])
    );
    const darkRatio = contrast(
      hslTokenToRgb(readGlobalsToken(".dark", token)),
      hslTokenToRgb(dark[on])
    );
    // A surface delta lives near 1.0, where a ratio-of-ratios is a blunt instrument: 1.09 vs 1.19
    // is only 1.09x apart yet one reads and the other does not. The band above is the real check
    // there, so hold deltas to a tighter drift than text.
    const allowed = max === undefined ? SYMMETRY_FACTOR : 1.15;
    const drift = Math.max(lightRatio, darkRatio) / Math.min(lightRatio, darkRatio);
    expect(
      round(drift),
      `--${token} on --${on}: light ${round(lightRatio)}:1 vs dark ${round(darkRatio)}:1`
    ).toBeLessThanOrEqual(allowed);
  });
});

/**
 * The popover's drop shadow was a single hard-coded `rgba(25,25,25,·)` string repeated at five call
 * sites, so a dark menu got a shadow that cannot paint over #212121 — the elevation cue simply did
 * not exist in one of the two themes. Structure, not ratio, is what is wrong there, so it is pinned
 * structurally.
 */
describe("popover elevation", () => {
  const shadowFor = (selector: ":root" | ".dark") => {
    const match = /--popover-shadow:\s*([^;]+);/.exec(readGlobalsBlock(selector));
    expect(match, `globals.css ${selector} declares --popover-shadow`).not.toBeNull();
    return match![1].replace(/\s+/g, " ").trim();
  };

  it("gives each theme its own shadow rather than one string used twice", () => {
    expect(shadowFor(":root")).not.toBe(shadowFor(".dark"));
  });

  it("casts the dark shadow in black, the only ink that darkens a near-black page", () => {
    const dark = shadowFor(".dark");
    expect(dark).toMatch(/rgba\(0, ?0, ?0, ?0\.[3-9]/);
    expect(dark).not.toMatch(/rgba\(25, ?25, ?25/);
  });

  it("routes both rings through --popover-ring so the two edges stay measured", () => {
    for (const selector of [":root", ".dark"] as const) {
      expect(shadowFor(selector)).toContain("hsl(var(--popover-ring))");
    }
  });
});

describe("contrast helper", () => {
  it("matches the WCAG reference values it is used to judge", () => {
    const white = hslTokenToRgb("0 0% 100%");
    const black = hslTokenToRgb("0 0% 0%");
    expect(hex(white)).toBe("#FFFFFF");
    expect(hex(black)).toBe("#000000");
    expect(round(contrast(white, black))).toBe(21);
    expect(round(contrast(white, white))).toBe(1);
    // Tailwind red-500, the value light `--destructive` used to carry, on white.
    expect(round(contrast(hslTokenToRgb("0 84.2% 60.2%"), white))).toBe(3.76);
  });
});
