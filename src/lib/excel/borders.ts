/**
 * Pure helpers for the borders picker.
 *
 * The picker hands us a 9-pattern enum + the desired side style; we expand
 * that to a *full desired* `ExcelBorderConfig` per cell so the workspace
 * can write it via `applyCellUpdates` without needing a special deep-merge
 * path (the shallow style merge in the workspace already replaces `border`
 * wholesale, which is exactly what we want once we've folded the parsed
 * borders + prior patches into the new config here).
 */

import type { BorderPattern } from "@/components/excel-editor/excel-borders-button";
import type { ExcelBorderConfig, ExcelBorderSide } from "@/lib/storage/types";

export interface BorderPatternBounds {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Compute the desired border config for a single cell given the pattern,
 * its position inside the selection, and the cell's existing border (parsed
 * + accumulated patches). Sides not affected by the pattern fall through
 * from `existing` so partial patterns stack predictably (e.g. running
 * "Top" after "Outer" just refreshes the top side).
 */
export function computeBorderForCell(
  pattern: BorderPattern,
  side: ExcelBorderSide,
  row: number,
  col: number,
  bounds: BorderPatternBounds,
  existing: ExcelBorderConfig | undefined
): ExcelBorderConfig {
  // For "none" we want a hard reset that supersedes the parsed cell's
  // borders too — wholesale replace handles that because the workspace's
  // style merge replaces the border field outright.
  if (pattern === "none") return {};

  const next: ExcelBorderConfig = { ...(existing ?? {}) };
  switch (pattern) {
    case "all":
      next.top = side;
      next.right = side;
      next.bottom = side;
      next.left = side;
      break;
    case "outer":
      if (row === bounds.top) next.top = side;
      if (row === bounds.bottom) next.bottom = side;
      if (col === bounds.left) next.left = side;
      if (col === bounds.right) next.right = side;
      break;
    case "inner":
      if (row > bounds.top) next.top = side;
      if (row < bounds.bottom) next.bottom = side;
      if (col > bounds.left) next.left = side;
      if (col < bounds.right) next.right = side;
      break;
    case "horizontal":
      if (row > bounds.top) next.top = side;
      if (row < bounds.bottom) next.bottom = side;
      break;
    case "vertical":
      if (col > bounds.left) next.left = side;
      if (col < bounds.right) next.right = side;
      break;
    case "top":
      if (row === bounds.top) next.top = side;
      break;
    case "bottom":
      if (row === bounds.bottom) next.bottom = side;
      break;
    case "left":
      if (col === bounds.left) next.left = side;
      break;
    case "right":
      if (col === bounds.right) next.right = side;
      break;
  }
  return next;
}

export const DEFAULT_BORDER_SIDE: ExcelBorderSide = { style: "thin" };
