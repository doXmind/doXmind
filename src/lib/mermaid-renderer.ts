/**
 * Global serialized mermaid renderer.
 *
 * Mermaid's render() function uses global DOM state internally and is NOT
 * safe to call concurrently. This module provides a promise queue that
 * serializes all render calls, initializes mermaid once, and retries once
 * on failure.
 */

let mermaidInstance: typeof import("mermaid").default | null = null;
let lastTheme: string | null = null;
let renderCounter = 0;

// Promise queue: each render waits for the previous one to finish
let renderQueue: Promise<void> = Promise.resolve();

/**
 * Apple HIG-inspired Mermaid themes.
 *
 * Design principles:
 * - Monochromatic, muted palette — no candy colors
 * - Text always high-contrast against its background
 * - Subtle borders (1-2 shades from fill) instead of bold outlines
 * - Neutral grays for structure, desaturated accents for semantics
 */

const lightThemeVars = {
  // Nodes — warm neutral gray fills, dark text
  primaryColor: "#F5F5F4",
  primaryBorderColor: "#D4D4D3",
  primaryTextColor: "#1C1C1E",
  secondaryColor: "#EEF2F7",
  secondaryBorderColor: "#C7CED9",
  secondaryTextColor: "#1C1C1E",
  tertiaryColor: "#F0EDE8",
  tertiaryBorderColor: "#D5D0C8",
  tertiaryTextColor: "#1C1C1E",

  // Structure
  lineColor: "#86868B",
  textColor: "#1C1C1E",
  mainBkg: "#F5F5F4",
  nodeBorder: "#D4D4D3",
  clusterBkg: "#FAFAF9",
  clusterBorder: "#E5E5E4",
  edgeLabelBackground: "#FFFFFF",

  // Notes
  noteBkgColor: "#FEFCE8",
  noteBorderColor: "#E2DFC4",
  noteTextColor: "#1C1C1E",

  // Pie — desaturated, sophisticated
  pie1: "#64748B",
  pie2: "#94A3B8",
  pie3: "#A1A1AA",
  pie4: "#78716C",
  pie5: "#6B7280",
  pie6: "#9CA3AF",
  pie7: "#B4B4B4",

  fontFamily: "inherit",
};

const darkThemeVars = {
  // Nodes — elevated surface fills, bright text
  primaryColor: "#2C2C2E",
  primaryBorderColor: "#48484A",
  primaryTextColor: "#F5F5F7",
  secondaryColor: "#1C3A5C",
  secondaryBorderColor: "#2D5A8E",
  secondaryTextColor: "#F5F5F7",
  tertiaryColor: "#3A2C20",
  tertiaryBorderColor: "#5C4633",
  tertiaryTextColor: "#F5F5F7",

  // Structure
  lineColor: "#636366",
  textColor: "#F5F5F7",
  mainBkg: "#2C2C2E",
  nodeBorder: "#48484A",
  clusterBkg: "#1C1C1E",
  clusterBorder: "#38383A",
  edgeLabelBackground: "#1C1C1E",

  // Notes
  noteBkgColor: "#2C2A1E",
  noteBorderColor: "#48453A",
  noteTextColor: "#F5F5F7",

  // Pie — muted, jewel-tone
  pie1: "#636366",
  pie2: "#48627A",
  pie3: "#7A6D60",
  pie4: "#5A5470",
  pie5: "#4A6460",
  pie6: "#8E8E93",
  pie7: "#545456",

  fontFamily: "inherit",
};

/**
 * Ensure mermaid is imported and initialized.
 * Re-initializes only if the theme has changed.
 */
async function ensureInitialized(): Promise<typeof import("mermaid").default> {
  const isDark = document.documentElement.classList.contains("dark");
  const currentTheme = isDark ? "dark" : "default";

  if (!mermaidInstance) {
    const { default: mermaid } = await import("mermaid");
    mermaidInstance = mermaid;
  }

  if (lastTheme !== currentTheme) {
    mermaidInstance.initialize({
      startOnLoad: false,
      theme: "base",
      themeVariables: isDark ? darkThemeVars : lightThemeVars,
      securityLevel: "loose",
    });
    lastTheme = currentTheme;
  }

  return mermaidInstance;
}

/**
 * Internal: perform a single render attempt.
 */
async function doRender(code: string): Promise<string> {
  const mermaid = await ensureInitialized();
  const id = `mermaid-${Date.now()}-${renderCounter++}`;
  const { svg } = await mermaid.render(id, code);

  // Clean up only the specific temporary element mermaid may have left
  const tempEl = document.getElementById(id);
  if (tempEl && !tempEl.closest(".mermaid-rendered")) {
    tempEl.remove();
  }

  return svg;
}

/**
 * Render mermaid code to SVG string.
 *
 * - Serialized: only one render runs at a time via a promise queue.
 * - Retries once on failure with a short delay.
 */
export function renderMermaidSvg(code: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    renderQueue = renderQueue.then(async () => {
      try {
        const svg = await doRender(code);
        resolve(svg);
      } catch {
        // Retry once after a short delay — the first failure may be due to
        // mermaid's global state being dirty from a prior failed render.
        try {
          await new Promise((r) => setTimeout(r, 100));
          const svg = await doRender(code);
          resolve(svg);
        } catch (secondError) {
          reject(secondError);
        }
      }
    });
  });
}
