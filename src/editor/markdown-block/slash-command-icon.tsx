"use client";

import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * A command's Lucide icon, by name, falling back to a neutral glyph.
 *
 * Its own module because two surfaces draw the same command list — the caret-anchored slash panel in
 * `markdown-block-row.tsx` and the gutter `+`'s insert menu in `block-gutter-controls.tsx` — and the
 * row already imports the gutter controls, so exporting it from either would close a cycle.
 */
export function SlashCommandIcon({ name }: { name: string }) {
  const icons = LucideIcons as unknown as Record<string, LucideIcon | undefined>;
  const Icon = icons[name] ?? LucideIcons.Pilcrow;
  return <Icon className="h-4 w-4" aria-hidden="true" />;
}
