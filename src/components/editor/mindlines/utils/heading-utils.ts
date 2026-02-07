/**
 * Heading utility functions for Mindlines component
 *
 * Provides reusable functions for working with heading hierarchies,
 * including finding children, active headings, and collapsible nodes.
 */

import type { Heading } from "../types";

/**
 * Check if a heading has children (headings with higher level after it)
 *
 * @param heading - The heading to check
 * @param headings - The full list of headings
 * @returns true if the heading has children
 */
export function hasChildren(heading: Heading, headings: Heading[]): boolean {
  const idx = headings.indexOf(heading);
  if (idx === -1) return false;

  for (let i = idx + 1; i < headings.length; i++) {
    if (headings[i].level <= heading.level) break;
    if (headings[i].level > heading.level) return true;
  }
  return false;
}

/**
 * Find all headings that have children
 *
 * @param headings - The list of headings
 * @returns Array of headings that have children
 */
export function findHeadingsWithChildren(headings: Heading[]): Heading[] {
  return headings.filter((h) => hasChildren(h, headings));
}

/**
 * Find all headings that have children and are at level 2 or below
 * (Used for initial collapse state - don't collapse H1)
 *
 * @param headings - The list of headings
 * @returns Array of heading IDs that should be collapsed by default
 */
export function findCollapsibleHeadingIds(headings: Heading[]): string[] {
  return headings.filter((h) => h.level >= 2 && hasChildren(h, headings)).map((h) => h.id);
}

/**
 * Find the active heading based on cursor position
 * Uses binary search for better performance on large documents
 *
 * @param headings - The list of headings (must be sorted by position)
 * @param position - The cursor position
 * @returns The active heading or null if none found
 */
export function findActiveHeading(headings: Heading[], position: number): Heading | null {
  if (headings.length === 0) return null;

  // Binary search for the last heading with pos <= position
  let left = 0;
  let right = headings.length - 1;
  let result: Heading | null = null;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (headings[mid].pos <= position) {
      result = headings[mid];
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return result;
}

/**
 * Count all descendants of a heading
 *
 * @param heading - The heading to count descendants for
 * @param headings - The full list of headings
 * @returns The number of descendants
 */
export function countDescendants(heading: Heading, headings: Heading[]): number {
  const idx = headings.indexOf(heading);
  if (idx === -1) return 0;

  let count = 0;
  for (let i = idx + 1; i < headings.length; i++) {
    if (headings[i].level <= heading.level) break;
    count++;
  }
  return count;
}

/**
 * Get all descendant headings of a given heading
 *
 * @param heading - The parent heading
 * @param headings - The full list of headings
 * @returns Array of descendant headings
 */
export function getDescendants(heading: Heading, headings: Heading[]): Heading[] {
  const idx = headings.indexOf(heading);
  if (idx === -1) return [];

  const descendants: Heading[] = [];
  for (let i = idx + 1; i < headings.length; i++) {
    if (headings[i].level <= heading.level) break;
    descendants.push(headings[i]);
  }
  return descendants;
}

/**
 * Get direct children of a heading (next level down only)
 *
 * @param heading - The parent heading
 * @param headings - The full list of headings
 * @returns Array of direct child headings
 */
export function getDirectChildren(heading: Heading, headings: Heading[]): Heading[] {
  const idx = headings.indexOf(heading);
  if (idx === -1) return [];

  const targetLevel = heading.level + 1;
  const children: Heading[] = [];

  for (let i = idx + 1; i < headings.length; i++) {
    if (headings[i].level <= heading.level) break;
    if (headings[i].level === targetLevel) {
      children.push(headings[i]);
    }
  }
  return children;
}

/**
 * Find the nearest scrollable ancestor of an element.
 * Walks up the DOM tree checking for overflow-y: auto or scroll.
 *
 * @param element - The starting element
 * @returns The scrollable parent, or document.documentElement as fallback
 */
export function getScrollParent(element: HTMLElement): HTMLElement {
  let current = element.parentElement;
  while (current) {
    const { overflowY } = getComputedStyle(current);
    if (overflowY === "auto" || overflowY === "scroll") return current;
    current = current.parentElement;
  }
  return document.documentElement;
}
