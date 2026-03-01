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
 * Custom Mermaid themes — Notion-style gray-tone palette.
 *
 * Design principles:
 * - Structural elements (borders, backgrounds, grids) stay neutral/muted
 * - Data elements use low-saturation, gray-leaning colors that blend into
 *   the document context (prioritizing aesthetics over data pop)
 * - Text always high-contrast against its background
 * - SVG background transparent so it inherits from the container
 */

/** Notion gray-tone palette — light mode (low-saturation, document-friendly) */
const PALETTE_LIGHT = "#787774,#9F7462,#C4956A,#7B9A7D,#6889A5,#8E7BA8,#A5727E,#7EA0A0";
/** Notion gray-tone palette — dark mode (slightly brighter for readability) */
const PALETTE_DARK = "#9B9A97,#C09480,#D4AD83,#95B698,#85A5BF,#AC97C2,#BF8E99,#99BFBF";

const lightThemeVars = {
  // ── Overall ──
  background: "transparent",
  fontFamily: "inherit",

  // ── Flowchart / general nodes ──
  primaryColor: "#F5F5F4",
  primaryBorderColor: "#D4D4D3",
  primaryTextColor: "#1C1C1E",
  secondaryColor: "#EEF2F7",
  secondaryBorderColor: "#C7CED9",
  secondaryTextColor: "#1C1C1E",
  tertiaryColor: "#F0EDE8",
  tertiaryBorderColor: "#D5D0C8",
  tertiaryTextColor: "#1C1C1E",
  lineColor: "#86868B",
  arrowheadColor: "#86868B",
  textColor: "#1C1C1E",
  titleColor: "#1C1C1E",
  nodeTextColor: "#1C1C1E",
  mainBkg: "#F5F5F4",
  nodeBorder: "#D4D4D3",
  clusterBkg: "#FAFAF9",
  clusterBorder: "#E5E5E4",
  edgeLabelBackground: "#FFFFFF",
  defaultLinkColor: "#86868B",

  // ── Notes ──
  noteBkgColor: "#FEFCE8",
  noteBorderColor: "#E2DFC4",
  noteTextColor: "#1C1C1E",

  // ── Sequence diagram ──
  actorBkg: "#F5F5F4",
  actorBorder: "#D4D4D3",
  actorTextColor: "#1C1C1E",
  actorLineColor: "#86868B",
  signalColor: "#86868B",
  signalTextColor: "#1C1C1E",
  labelBoxBkgColor: "#F5F5F4",
  labelBoxBorderColor: "#D4D4D3",
  labelTextColor: "#1C1C1E",
  loopTextColor: "#1C1C1E",
  activationBorderColor: "#D4D4D3",
  activationBkgColor: "#EEF2F7",
  sequenceNumberColor: "#FFFFFF",

  // ── Gantt chart ──
  sectionBkgColor: "#EEF2F7",
  altSectionBkgColor: "#FAFAF9",
  sectionBkgColor2: "#F0EDE8",
  excludeBkgColor: "#F5F5F4",
  taskBorderColor: "#D4D4D3",
  taskBkgColor: "#6889A5",
  activeTaskBorderColor: "#6889A5",
  activeTaskBkgColor: "#7E9DB8",
  gridColor: "#E5E5E4",
  doneTaskBkgColor: "#D4D4D3",
  doneTaskBorderColor: "#AEAEB2",
  critBorderColor: "#A5727E",
  critBkgColor: "#C09B9B",
  todayLineColor: "#A5727E",
  vertLineColor: "#E5E5E4",
  taskTextColor: "#FFFFFF",
  taskTextOutsideColor: "#1C1C1E",
  taskTextLightColor: "#FFFFFF",
  taskTextDarkColor: "#1C1C1E",
  taskTextClickableColor: "#6889A5",

  // ── State diagram ──
  transitionColor: "#86868B",
  transitionLabelColor: "#1C1C1E",
  stateLabelColor: "#1C1C1E",
  stateBkg: "#F5F5F4",
  labelBackgroundColor: "#F5F5F4",
  compositeBackground: "#FAFAF9",
  altBackground: "#F0EDE8",
  compositeTitleBackground: "#F5F5F4",
  compositeBorder: "#D4D4D3",
  innerEndBackground: "#86868B",
  errorBkgColor: "#FFF1F0",
  errorTextColor: "#FF3B30",
  specialStateColor: "#86868B",

  // ── Class diagram ──
  classText: "#1C1C1E",
  fillType0: "#F5F5F4",
  fillType1: "#EEF2F7",
  fillType2: "#F0EDE8",
  fillType3: "#FEFCE8",
  fillType4: "#EEF2FF",
  fillType5: "#F0FDF4",
  fillType6: "#FFF7ED",
  fillType7: "#FDF2F8",

  // ── Color scale (xychart, journey, etc.) ──
  cScale0: "#787774",
  cScale1: "#9F7462",
  cScale2: "#C4956A",
  cScale3: "#7B9A7D",
  cScale4: "#6889A5",
  cScale5: "#8E7BA8",
  cScale6: "#A5727E",
  cScale7: "#7EA0A0",
  cScale8: "#B5A48C",
  cScale9: "#698C8C",
  cScale10: "#A08CA0",
  cScale11: "#8C8474",
  scaleLabelColor: "#1C1C1E",

  // ── Pie chart ──
  pie1: "#787774",
  pie2: "#9F7462",
  pie3: "#C4956A",
  pie4: "#7B9A7D",
  pie5: "#6889A5",
  pie6: "#8E7BA8",
  pie7: "#A5727E",
  pie8: "#7EA0A0",
  pie9: "#B5A48C",
  pie10: "#698C8C",
  pie11: "#A08CA0",
  pie12: "#8C8474",
  pieTitleTextColor: "#1C1C1E",
  pieSectionTextColor: "#FFFFFF",
  pieLegendTextColor: "#1C1C1E",
  pieStrokeColor: "#FFFFFF",
  pieOuterStrokeColor: "#FFFFFF",
  pieOpacity: "0.85",

  // ── XY Chart ──
  xyChart: {
    backgroundColor: "transparent",
    titleColor: "#1C1C1E",
    xAxisTitleColor: "#1C1C1E",
    xAxisLabelColor: "#48484A",
    xAxisTickColor: "#86868B",
    xAxisLineColor: "#86868B",
    yAxisTitleColor: "#1C1C1E",
    yAxisLabelColor: "#48484A",
    yAxisTickColor: "#86868B",
    yAxisLineColor: "#86868B",
    plotColorPalette: PALETTE_LIGHT,
  },

  // ── Quadrant chart ──
  quadrant1Fill: "#EEF2FF",
  quadrant2Fill: "#F0FDF4",
  quadrant3Fill: "#FFF7ED",
  quadrant4Fill: "#FDF2F8",
  quadrant1TextFill: "#1C1C1E",
  quadrant2TextFill: "#1C1C1E",
  quadrant3TextFill: "#1C1C1E",
  quadrant4TextFill: "#1C1C1E",
  quadrantPointFill: "#6889A5",
  quadrantPointTextFill: "#1C1C1E",
  quadrantXAxisTextFill: "#48484A",
  quadrantYAxisTextFill: "#48484A",
  quadrantTitleFill: "#1C1C1E",
  quadrantInternalBorderStrokeFill: "#E5E5E4",
  quadrantExternalBorderStrokeFill: "#D4D4D3",

  // ── Requirement diagram ──
  requirementBackground: "#F5F5F4",
  requirementBorderColor: "#D4D4D3",
  requirementBorderSize: "1",
  requirementTextColor: "#1C1C1E",
  relationColor: "#86868B",
  relationLabelBackground: "#EEF2F7",
  relationLabelColor: "#1C1C1E",

  // ── Git graph ──
  git0: "#787774",
  git1: "#9F7462",
  git2: "#C4956A",
  git3: "#7B9A7D",
  git4: "#6889A5",
  git5: "#8E7BA8",
  git6: "#A5727E",
  git7: "#7EA0A0",
  gitInv0: "#FFFFFF",
  gitInv1: "#FFFFFF",
  gitInv2: "#FFFFFF",
  gitInv3: "#FFFFFF",
  gitInv4: "#FFFFFF",
  gitInv5: "#FFFFFF",
  gitInv6: "#FFFFFF",
  gitInv7: "#FFFFFF",
  branchLabelColor: "#1C1C1E",
  tagLabelColor: "#1C1C1E",
  tagLabelBackground: "#F5F5F4",
  tagLabelBorder: "#D4D4D3",
  commitLabelColor: "#48484A",
  commitLabelBackground: "#F5F5F4",

  // ── Architecture diagram ──
  archEdgeColor: "#86868B",
  archEdgeArrowColor: "#86868B",
  archEdgeWidth: "2",
  archGroupBorderColor: "#D4D4D3",
  archGroupBorderWidth: "1px",

  // ── C4 / person ──
  personBorder: "#D4D4D3",
  personBkg: "#F5F5F4",

  // ── ER diagram ──
  attributeBackgroundColorOdd: "#FAFAF9",
  attributeBackgroundColorEven: "#F5F5F4",
};

const darkThemeVars = {
  // ── Overall ──
  background: "transparent",
  fontFamily: "inherit",

  // ── Flowchart / general nodes ──
  primaryColor: "#2C2C2E",
  primaryBorderColor: "#48484A",
  primaryTextColor: "#F5F5F7",
  secondaryColor: "#1C3A5C",
  secondaryBorderColor: "#2D5A8E",
  secondaryTextColor: "#F5F5F7",
  tertiaryColor: "#3A2C20",
  tertiaryBorderColor: "#5C4633",
  tertiaryTextColor: "#F5F5F7",
  lineColor: "#636366",
  arrowheadColor: "#636366",
  textColor: "#F5F5F7",
  titleColor: "#F5F5F7",
  nodeTextColor: "#F5F5F7",
  mainBkg: "#2C2C2E",
  nodeBorder: "#48484A",
  clusterBkg: "#1C1C1E",
  clusterBorder: "#38383A",
  edgeLabelBackground: "#1C1C1E",
  defaultLinkColor: "#636366",

  // ── Notes ──
  noteBkgColor: "#2C2A1E",
  noteBorderColor: "#48453A",
  noteTextColor: "#F5F5F7",

  // ── Sequence diagram ──
  actorBkg: "#2C2C2E",
  actorBorder: "#48484A",
  actorTextColor: "#F5F5F7",
  actorLineColor: "#636366",
  signalColor: "#636366",
  signalTextColor: "#F5F5F7",
  labelBoxBkgColor: "#2C2C2E",
  labelBoxBorderColor: "#48484A",
  labelTextColor: "#F5F5F7",
  loopTextColor: "#F5F5F7",
  activationBorderColor: "#48484A",
  activationBkgColor: "#1C3A5C",
  sequenceNumberColor: "#FFFFFF",

  // ── Gantt chart ──
  sectionBkgColor: "#2C2C2E",
  altSectionBkgColor: "#1C1C1E",
  sectionBkgColor2: "#3A2C20",
  excludeBkgColor: "#1C1C1E",
  taskBorderColor: "#48484A",
  taskBkgColor: "#5E7B94",
  activeTaskBorderColor: "#5E7B94",
  activeTaskBkgColor: "#7593AA",
  gridColor: "#38383A",
  doneTaskBkgColor: "#48484A",
  doneTaskBorderColor: "#636366",
  critBorderColor: "#BF8E99",
  critBkgColor: "#8A5B64",
  todayLineColor: "#BF8E99",
  vertLineColor: "#38383A",
  taskTextColor: "#FFFFFF",
  taskTextOutsideColor: "#F5F5F7",
  taskTextLightColor: "#FFFFFF",
  taskTextDarkColor: "#F5F5F7",
  taskTextClickableColor: "#85A5BF",

  // ── State diagram ──
  transitionColor: "#636366",
  transitionLabelColor: "#F5F5F7",
  stateLabelColor: "#F5F5F7",
  stateBkg: "#2C2C2E",
  labelBackgroundColor: "#2C2C2E",
  compositeBackground: "#1C1C1E",
  altBackground: "#3A2C20",
  compositeTitleBackground: "#2C2C2E",
  compositeBorder: "#48484A",
  innerEndBackground: "#636366",
  errorBkgColor: "#3B1C1A",
  errorTextColor: "#FF453A",
  specialStateColor: "#636366",

  // ── Class diagram ──
  classText: "#F5F5F7",
  fillType0: "#2C2C2E",
  fillType1: "#1C3A5C",
  fillType2: "#3A2C20",
  fillType3: "#2C2A1E",
  fillType4: "#1C2333",
  fillType5: "#1C2B1E",
  fillType6: "#2B2118",
  fillType7: "#2B1C28",

  // ── Color scale (xychart, journey, etc.) ──
  cScale0: "#9B9A97",
  cScale1: "#C09480",
  cScale2: "#D4AD83",
  cScale3: "#95B698",
  cScale4: "#85A5BF",
  cScale5: "#AC97C2",
  cScale6: "#BF8E99",
  cScale7: "#99BFBF",
  cScale8: "#C9BAA4",
  cScale9: "#83ABAB",
  cScale10: "#BFA8BF",
  cScale11: "#ABA393",
  scaleLabelColor: "#F5F5F7",

  // ── Pie chart ──
  pie1: "#9B9A97",
  pie2: "#C09480",
  pie3: "#D4AD83",
  pie4: "#95B698",
  pie5: "#85A5BF",
  pie6: "#AC97C2",
  pie7: "#BF8E99",
  pie8: "#99BFBF",
  pie9: "#C9BAA4",
  pie10: "#83ABAB",
  pie11: "#BFA8BF",
  pie12: "#ABA393",
  pieTitleTextColor: "#F5F5F7",
  pieSectionTextColor: "#1C1C1E",
  pieLegendTextColor: "#F5F5F7",
  pieStrokeColor: "#1C1C1E",
  pieOuterStrokeColor: "#1C1C1E",
  pieOpacity: "0.85",

  // ── XY Chart ──
  xyChart: {
    backgroundColor: "transparent",
    titleColor: "#F5F5F7",
    xAxisTitleColor: "#F5F5F7",
    xAxisLabelColor: "#AEAEB2",
    xAxisTickColor: "#636366",
    xAxisLineColor: "#636366",
    yAxisTitleColor: "#F5F5F7",
    yAxisLabelColor: "#AEAEB2",
    yAxisTickColor: "#636366",
    yAxisLineColor: "#636366",
    plotColorPalette: PALETTE_DARK,
  },

  // ── Quadrant chart ──
  quadrant1Fill: "#1C2333",
  quadrant2Fill: "#1C2B1E",
  quadrant3Fill: "#2B2118",
  quadrant4Fill: "#2B1C28",
  quadrant1TextFill: "#F5F5F7",
  quadrant2TextFill: "#F5F5F7",
  quadrant3TextFill: "#F5F5F7",
  quadrant4TextFill: "#F5F5F7",
  quadrantPointFill: "#85A5BF",
  quadrantPointTextFill: "#F5F5F7",
  quadrantXAxisTextFill: "#AEAEB2",
  quadrantYAxisTextFill: "#AEAEB2",
  quadrantTitleFill: "#F5F5F7",
  quadrantInternalBorderStrokeFill: "#38383A",
  quadrantExternalBorderStrokeFill: "#48484A",

  // ── Requirement diagram ──
  requirementBackground: "#2C2C2E",
  requirementBorderColor: "#48484A",
  requirementBorderSize: "1",
  requirementTextColor: "#F5F5F7",
  relationColor: "#636366",
  relationLabelBackground: "#2C2C2E",
  relationLabelColor: "#F5F5F7",

  // ── Git graph ──
  git0: "#9B9A97",
  git1: "#C09480",
  git2: "#D4AD83",
  git3: "#95B698",
  git4: "#85A5BF",
  git5: "#AC97C2",
  git6: "#BF8E99",
  git7: "#99BFBF",
  gitInv0: "#1C1C1E",
  gitInv1: "#1C1C1E",
  gitInv2: "#1C1C1E",
  gitInv3: "#1C1C1E",
  gitInv4: "#1C1C1E",
  gitInv5: "#1C1C1E",
  gitInv6: "#1C1C1E",
  gitInv7: "#1C1C1E",
  branchLabelColor: "#F5F5F7",
  tagLabelColor: "#F5F5F7",
  tagLabelBackground: "#2C2C2E",
  tagLabelBorder: "#48484A",
  commitLabelColor: "#AEAEB2",
  commitLabelBackground: "#2C2C2E",

  // ── Architecture diagram ──
  archEdgeColor: "#636366",
  archEdgeArrowColor: "#636366",
  archEdgeWidth: "2",
  archGroupBorderColor: "#48484A",
  archGroupBorderWidth: "1px",

  // ── C4 / person ──
  personBorder: "#48484A",
  personBkg: "#2C2C2E",

  // ── ER diagram ──
  attributeBackgroundColorOdd: "#2C2C2E",
  attributeBackgroundColorEven: "#242426",
};

/**
 * Ensure mermaid is imported and initialized.
 * Re-initializes only if the theme has changed.
 * Reads the data-theme attribute to detect the active editor theme,
 * falling back to the .dark class check for base mode detection.
 */
async function ensureInitialized(): Promise<typeof import("mermaid").default> {
  const isDark = document.documentElement.classList.contains("dark");
  const themeId =
    document.documentElement.getAttribute("data-theme") || (isDark ? "dark" : "notion");
  const currentTheme = `${themeId}-${isDark ? "dark" : "light"}`;

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
      suppressErrorRendering: true,
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
