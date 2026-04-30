/**
 * Font registry for the global UI font picker.
 *
 * Each entry is a CSS `font-family` stack that the AppearanceInjector
 * forces on `<html>/<body>` so the entire app — chrome + editor —
 * shares one font. `stack: null` means "use the default" (Tailwind's
 * `.font-sans` utility on body) and the injector emits no rule.
 *
 * Legacy IDs `"sans" | "serif" | "mono"` remain in the registry as
 * aliases of `system / georgia / jetbrains-mono` so persisted state
 * from earlier builds keeps working without a migration.
 */

export type FontCategory = "sans" | "serif" | "mono";

export interface FontOption {
  id: string;
  label: string;
  category: FontCategory;
  /** CSS font-family value, or null to fall back to the system default. */
  stack: string | null;
  /** Hidden in the picker dropdown — kept only as a legacy alias. */
  legacy?: boolean;
}

const SF_PRO_STACK =
  '"SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
const HELVETICA_STACK = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const INTER_STACK = "Inter, var(--font-inter), -apple-system, BlinkMacSystemFont, sans-serif";

const GEORGIA_STACK = 'Georgia, "Times New Roman", Times, serif';
const CHARTER_STACK = 'Charter, "Source Serif Pro", Georgia, "Times New Roman", serif';
const TIMES_STACK = '"Times New Roman", Times, serif';
const IOWAN_STACK = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';

const JETBRAINS_STACK =
  '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
const SF_MONO_STACK = '"SF Mono", SFMono-Regular, ui-monospace, Menlo, Consolas, monospace';
const MENLO_STACK = 'Menlo, Monaco, Consolas, "Courier New", monospace';
const FIRA_STACK = '"Fira Code", "Fira Mono", ui-monospace, Menlo, Consolas, monospace';

export const FONT_OPTIONS: readonly FontOption[] = [
  // Sans-serif
  { id: "system", label: "System", category: "sans", stack: null },
  { id: "inter", label: "Inter", category: "sans", stack: INTER_STACK },
  { id: "sf-pro", label: "SF Pro", category: "sans", stack: SF_PRO_STACK },
  { id: "helvetica", label: "Helvetica Neue", category: "sans", stack: HELVETICA_STACK },

  // Serif
  { id: "georgia", label: "Georgia", category: "serif", stack: GEORGIA_STACK },
  { id: "charter", label: "Charter", category: "serif", stack: CHARTER_STACK },
  { id: "iowan", label: "Iowan Old Style", category: "serif", stack: IOWAN_STACK },
  { id: "times", label: "Times New Roman", category: "serif", stack: TIMES_STACK },

  // Monospace
  { id: "jetbrains-mono", label: "JetBrains Mono", category: "mono", stack: JETBRAINS_STACK },
  { id: "sf-mono", label: "SF Mono", category: "mono", stack: SF_MONO_STACK },
  { id: "menlo", label: "Menlo", category: "mono", stack: MENLO_STACK },
  { id: "fira-code", label: "Fira Code", category: "mono", stack: FIRA_STACK },

  // Legacy aliases — present so persisted "sans"/"serif"/"mono" still
  // resolve to a stack. Hidden from the picker UI via `legacy: true`.
  { id: "sans", label: "System", category: "sans", stack: null, legacy: true },
  { id: "serif", label: "Georgia", category: "serif", stack: GEORGIA_STACK, legacy: true },
  { id: "mono", label: "JetBrains Mono", category: "mono", stack: JETBRAINS_STACK, legacy: true },
];

const FONT_BY_ID = new Map(FONT_OPTIONS.map((opt) => [opt.id, opt]));

export type FontFamilyId = string;

export const DEFAULT_FONT_FAMILY: FontFamilyId = "system";

export function resolveFontStack(id: FontFamilyId): string | null {
  return FONT_BY_ID.get(id)?.stack ?? null;
}

export function resolveFontOption(id: FontFamilyId): FontOption | undefined {
  return FONT_BY_ID.get(id);
}

/** Visible (non-legacy) options grouped by category for the picker UI. */
export function getVisibleFontOptionsGrouped(): Record<FontCategory, FontOption[]> {
  const grouped: Record<FontCategory, FontOption[]> = { sans: [], serif: [], mono: [] };
  for (const opt of FONT_OPTIONS) {
    if (opt.legacy) continue;
    grouped[opt.category].push(opt);
  }
  return grouped;
}
