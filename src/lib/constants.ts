/**
 * Application Constants
 *
 * Centralized configuration values and magic numbers.
 */

// =============================================================================
// API Configuration
// =============================================================================

/** Backend API base URL */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// =============================================================================
// Editor Configuration
// =============================================================================

/** Debounce delay for editor content updates (ms) */
export const EDITOR_DEBOUNCE_DELAY = 1000;

/** Minimum document length for text review (characters) */
export const MIN_REVIEW_DOCUMENT_LENGTH = 20;

// =============================================================================
// Autocomplete Configuration
// =============================================================================

/** Debounce delay for autocomplete triggers (ms) */
export const AUTOCOMPLETE_DEBOUNCE_DELAY = 300;

/** Minimum text length to trigger autocomplete */
export const AUTOCOMPLETE_MIN_TEXT_LENGTH = 2;

/** Minimum word length to trigger autocomplete */
export const AUTOCOMPLETE_MIN_WORD_LENGTH = 2;

/** Maximum context characters before cursor */
export const AUTOCOMPLETE_MAX_CONTEXT_BEFORE = 4000;

/** Maximum context characters after cursor */
export const AUTOCOMPLETE_MAX_CONTEXT_AFTER = 1000;

// =============================================================================
// Diff Configuration
// =============================================================================

/** Similarity threshold for paragraph matching (0-1) */
export const DIFF_SIMILARITY_THRESHOLD = 0.3;

/** Position tolerance for fuzzy text matching */
export const DIFF_FUZZY_MATCH_TOLERANCE = 10;

// =============================================================================
// UI Configuration
// =============================================================================

/** Default animation duration (ms) */
export const DEFAULT_ANIMATION_DURATION = 200;

/** Tooltip show delay (ms) */
export const TOOLTIP_SHOW_DELAY = 300;

/** Maximum file name display length */
export const MAX_FILE_NAME_DISPLAY_LENGTH = 30;
