/**
 * Application Constants
 *
 * Centralized configuration values and magic numbers.
 */

// =============================================================================
// API Configuration
// =============================================================================

/** Backend API base URL */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// =============================================================================
// Editor Configuration
// =============================================================================

/** Debounce delay for editor content updates (ms) */
export const EDITOR_DEBOUNCE_DELAY = 1000;

// =============================================================================
// UI Configuration
// =============================================================================

/** Default animation duration (ms) */
export const DEFAULT_ANIMATION_DURATION = 200;

/** Tooltip show delay (ms) */
export const TOOLTIP_SHOW_DELAY = 300;

/** Maximum file name display length */
export const MAX_FILE_NAME_DISPLAY_LENGTH = 30;

// =============================================================================
// Animation Configuration
// =============================================================================

/** Animation durations in milliseconds */
export const ANIMATION_DURATION = {
  /** Fast animations (quick feedback) */
  FAST: 150,
  /** Normal animations (standard transitions) */
  NORMAL: 200,
  /** Slow animations (smooth transitions) */
  SLOW: 300,
  /** Transition animations (state changes) */
  TRANSITION: 350,
  /** Long animations (complex transitions) */
  LONG: 500,
} as const;

// =============================================================================
// Outline Panel Configuration
// =============================================================================

/** Outline panel widths in pixels */
export const MINDLINES_WIDTH = {
  /** Expanded state width (full Notion-style outline view) */
  EXPANDED: 280,
  /** Collapsed state width (Notion-style minimap rail) */
  COLLAPSED: 56,
} as const;

/** Z-index layers for overlays */
export const Z_INDEX = {
  MODAL: 70,
} as const;
