/**
 * Cover Image Preset Backgrounds
 *
 * CSS gradient and solid color presets for page cover images.
 * Values are stored directly in `cover_image_url` — no image files needed.
 */

export interface CoverPreset {
  id: string;
  label: string;
  value: string; // CSS gradient string or hex color
}

export interface CoverPresetCategory {
  labelKey: string;
  presets: CoverPreset[];
}

// ---------------------------------------------------------------------------
// Gradient presets — curated for premium feel
// ---------------------------------------------------------------------------

export const gradientPresets: CoverPreset[] = [
  { id: "g1", label: "Lavender Dream", value: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" },
  { id: "g2", label: "Ocean Breeze", value: "linear-gradient(135deg, #0093E9 0%, #80D0C7 100%)" },
  { id: "g3", label: "Warm Sunset", value: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)" },
  { id: "g4", label: "Morning Mist", value: "linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)" },
  {
    id: "g5",
    label: "Deep Space",
    value: "linear-gradient(135deg, #0c0c1d 0%, #1a1a2e 50%, #16213e 100%)",
  },
  { id: "g6", label: "Citrus Pop", value: "linear-gradient(135deg, #f7971e 0%, #ffd200 100%)" },
  {
    id: "g7",
    label: "Northern Lights",
    value: "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)",
  },
  { id: "g8", label: "Rose Gold", value: "linear-gradient(135deg, #f5af19 0%, #f12711 100%)" },
  { id: "g9", label: "Twilight", value: "linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)" },
  { id: "g10", label: "Mint Cream", value: "linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)" },
  {
    id: "g11",
    label: "Berry Smoothie",
    value: "linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)",
  },
  { id: "g12", label: "Steel Blue", value: "linear-gradient(135deg, #2c3e50 0%, #3498db 100%)" },
  { id: "g13", label: "Peach", value: "linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)" },
  { id: "g14", label: "Sapphire", value: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)" },
];

// ---------------------------------------------------------------------------
// Abstract & mesh gradient presets — multi-layer, aurora-like
// ---------------------------------------------------------------------------

export const meshPresets: CoverPreset[] = [
  {
    id: "m1",
    label: "Aurora",
    value:
      "radial-gradient(at 20% 30%, #08AEEA 0px, transparent 50%), radial-gradient(at 80% 10%, #2AF598 0px, transparent 50%), radial-gradient(at 50% 80%, #FA709A 0px, transparent 50%), radial-gradient(at 10% 90%, #667eea 0px, transparent 50%), #0f0f23",
  },
  {
    id: "m2",
    label: "Sunset Mesh",
    value:
      "radial-gradient(at 0% 0%, #ff6a00 0px, transparent 50%), radial-gradient(at 80% 20%, #ee0979 0px, transparent 50%), radial-gradient(at 40% 80%, #ff6a00 0px, transparent 40%), #1a0a2e",
  },
  {
    id: "m3",
    label: "Ocean Depth",
    value:
      "radial-gradient(at 10% 20%, #0093E9 0px, transparent 50%), radial-gradient(at 90% 50%, #38f9d7 0px, transparent 50%), radial-gradient(at 50% 90%, #667eea 0px, transparent 40%), #0a1628",
  },
  {
    id: "m4",
    label: "Holographic",
    value:
      "conic-gradient(from 135deg at 50% 50%, #a78bfa, #38bdf8, #34d399, #fbbf24, #f87171, #a78bfa)",
  },
  {
    id: "m5",
    label: "Neon Glow",
    value:
      "radial-gradient(at 30% 40%, #c084fc 0px, transparent 50%), radial-gradient(at 70% 60%, #22d3ee 0px, transparent 50%), radial-gradient(at 50% 20%, #fb7185 0px, transparent 40%), #0f172a",
  },
  {
    id: "m6",
    label: "Frosted Pastel",
    value:
      "radial-gradient(at 20% 20%, #c4b5fd 0px, transparent 50%), radial-gradient(at 80% 30%, #a5f3fc 0px, transparent 50%), radial-gradient(at 50% 80%, #fecdd3 0px, transparent 50%), #faf5ff",
  },
  {
    id: "m7",
    label: "Emerald Fire",
    value:
      "radial-gradient(at 15% 50%, #34d399 0px, transparent 50%), radial-gradient(at 85% 30%, #fbbf24 0px, transparent 50%), radial-gradient(at 50% 90%, #f97316 0px, transparent 40%), #0c1a0e",
  },
  {
    id: "m8",
    label: "Cotton Candy",
    value:
      "radial-gradient(at 30% 20%, #f9a8d4 0px, transparent 50%), radial-gradient(at 70% 80%, #93c5fd 0px, transparent 50%), radial-gradient(at 80% 10%, #c4b5fd 0px, transparent 40%), #fdf2f8",
  },
];

// ---------------------------------------------------------------------------
// Geometric pattern presets — repeating CSS patterns
// ---------------------------------------------------------------------------

export const patternPresets: CoverPreset[] = [
  {
    id: "p1",
    label: "Polka Dots",
    value: "radial-gradient(circle, #c8b4e0 1.5px, transparent 1.5px) 0 0 / 22px 22px, #f5f0ff",
  },
  {
    id: "p2",
    label: "Diagonal Stripes",
    value:
      "repeating-linear-gradient(45deg, transparent, transparent 10px, #c7d2e8 10px, #c7d2e8 12px), #eef2f9",
  },
  {
    id: "p3",
    label: "Checkerboard",
    value:
      "repeating-linear-gradient(45deg, #d4d4d8 25%, transparent 25%, transparent 75%, #d4d4d8 75%, #d4d4d8) 0 0 / 40px 40px, repeating-linear-gradient(45deg, #d4d4d8 25%, #f4f4f5 25%, #f4f4f5 75%, #d4d4d8 75%, #d4d4d8) 20px 20px / 40px 40px, #f4f4f5",
  },
  {
    id: "p4",
    label: "Zigzag",
    value:
      "linear-gradient(135deg, #a5b4c8 25%, transparent 25%) -24px 0 / 48px 48px, linear-gradient(225deg, #a5b4c8 25%, transparent 25%) -24px 0 / 48px 48px, linear-gradient(315deg, #a5b4c8 25%, transparent 25%) 0 0 / 48px 48px, linear-gradient(45deg, #a5b4c8 25%, transparent 25%) 0 0 / 48px 48px, #e8edf4",
  },
  {
    id: "p5",
    label: "Diamond Grid",
    value:
      "linear-gradient(135deg, #bfcfe0 25%, transparent 25%) 0 0 / 24px 24px, linear-gradient(225deg, #bfcfe0 25%, transparent 25%) 0 0 / 24px 24px, linear-gradient(45deg, #bfcfe0 25%, transparent 25%) 0 0 / 24px 24px, linear-gradient(315deg, #bfcfe0 25%, transparent 25%) 0 0 / 24px 24px, #e8f0f8",
  },
  {
    id: "p6",
    label: "Grid",
    value:
      "linear-gradient(#d1d5db 1px, transparent 1px) 0 0 / 28px 28px, linear-gradient(90deg, #d1d5db 1px, transparent 1px) 0 0 / 28px 28px, #f9fafb",
  },
  {
    id: "p7",
    label: "Waves",
    value:
      "repeating-radial-gradient(circle at 0 0, transparent 0, #f0f4fa 22px), repeating-linear-gradient(#94a3b855, #94a3b8), #e8edf4",
  },
  {
    id: "p8",
    label: "Isometric",
    value:
      "linear-gradient(30deg, #b8c9dc 12%, transparent 12.5%, transparent 87%, #b8c9dc 87.5%, #b8c9dc) 0 0 / 48px 84px, linear-gradient(150deg, #b8c9dc 12%, transparent 12.5%, transparent 87%, #b8c9dc 87.5%, #b8c9dc) 0 0 / 48px 84px, linear-gradient(30deg, #b8c9dc 12%, transparent 12.5%, transparent 87%, #b8c9dc 87.5%, #b8c9dc) 24px 42px / 48px 84px, linear-gradient(150deg, #b8c9dc 12%, transparent 12.5%, transparent 87%, #b8c9dc 87.5%, #b8c9dc) 24px 42px / 48px 84px, linear-gradient(60deg, #b8c9dc77 25%, transparent 25.5%, transparent 75%, #b8c9dc77 75%, #b8c9dc77) 0 0 / 48px 84px, linear-gradient(60deg, #b8c9dc77 25%, transparent 25.5%, transparent 75%, #b8c9dc77 75%, #b8c9dc77) 24px 42px / 48px 84px, #e8edf4",
  },
  {
    id: "p9",
    label: "Cross Hatch",
    value:
      "repeating-linear-gradient(45deg, transparent, transparent 8px, #c7cfe0 8px, #c7cfe0 9px), repeating-linear-gradient(-45deg, transparent, transparent 8px, #c7cfe0 8px, #c7cfe0 9px), #eef1f7",
  },
  {
    id: "p10",
    label: "Triangles",
    value: "linear-gradient(45deg, #c4b5fd 50%, transparent 50%) 0 0 / 28px 28px, #ede9fe",
  },
];

// ---------------------------------------------------------------------------
// Solid color presets — soft pastels
// ---------------------------------------------------------------------------

export const solidPresets: CoverPreset[] = [
  { id: "s1", label: "Warm Gray", value: "#e7e5e4" },
  { id: "s2", label: "Cool Gray", value: "#e2e8f0" },
  { id: "s3", label: "Soft Red", value: "#fecaca" },
  { id: "s4", label: "Soft Blue", value: "#bfdbfe" },
  { id: "s5", label: "Soft Green", value: "#bbf7d0" },
  { id: "s6", label: "Soft Yellow", value: "#fef08a" },
  { id: "s7", label: "Soft Purple", value: "#ddd6fe" },
  { id: "s8", label: "Soft Pink", value: "#fbcfe8" },
];

// ---------------------------------------------------------------------------
// Categories for the gallery UI
// ---------------------------------------------------------------------------

export const coverPresetCategories: CoverPresetCategory[] = [
  { labelKey: "gradients", presets: gradientPresets },
  { labelKey: "meshGradients", presets: meshPresets },
  { labelKey: "geometricPatterns", presets: patternPresets },
  { labelKey: "solidColors", presets: solidPresets },
];

// ---------------------------------------------------------------------------
// Detection utility
// ---------------------------------------------------------------------------

/**
 * Detect whether a cover value is a CSS background (gradient or hex color)
 * rather than an image URL. Used by PageCover to choose rendering approach.
 */
export function isCssBackground(value: string): boolean {
  return (
    value.startsWith("linear-gradient") ||
    value.startsWith("radial-gradient") ||
    value.startsWith("conic-gradient") ||
    value.startsWith("repeating-linear-gradient") ||
    value.startsWith("repeating-radial-gradient") ||
    /^#[0-9a-fA-F]{3,8}$/.test(value)
  );
}
