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

/** The `:root` / `.dark` blocks of globals.css, read as a token set of the same shape. */
function readGlobalsPalette(selector: ":root" | ".dark"): ThemeTokens {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    ""
  );
  // Anchored so `.dark` does not also match `.dark.high-contrast`.
  const block = new RegExp(
    `(^|[\\s{}])${selector.replace(".", "\\.")}\\s*\\{([^{}]*)\\}`,
    "m"
  ).exec(css);
  expect(block, `globals.css has a ${selector} block`).not.toBeNull();
  const body = block![2];
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
