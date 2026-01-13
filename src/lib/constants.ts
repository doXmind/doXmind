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
// Mindlines Configuration
// =============================================================================

/** Mindlines sidebar width in pixels */
export const MINDLINES_WIDTH = {
  /** Collapsed state width */
  COLLAPSED: 208,
  /** Preview/hover state width */
  PREVIEW: 320,
} as const;

/** Mindlines hover timing in milliseconds */
export const MINDLINES_HOVER_TIMING = {
  /** Delay before expanding on hover enter */
  ENTER_DELAY: 150,
  /** Delay before collapsing on hover leave */
  LEAVE_DELAY: 300,
} as const;

// =============================================================================
// Mindmap/ReactFlow Configuration
// =============================================================================

/** Mindmap node dimensions by heading level */
export const MINDMAP_NODE_WIDTH = {
  /** H1 heading node width */
  H1: 220,
  /** H2 heading node width */
  H2: 180,
  /** H3+ heading node width */
  H3: 160,
} as const;

/** Mindmap node height */
export const MINDMAP_NODE_HEIGHT = 44;

/** Mindmap fit view configuration */
export const MINDMAP_FIT_VIEW = {
  /** Padding around the fitted view (0-1) */
  PADDING: 0.15,
  /** Animation duration for fit view */
  DURATION: 300,
  /** Maximum zoom level */
  MAX_ZOOM: 1.2,
  /** Minimum zoom level */
  MIN_ZOOM: 0.8,
  /** Delay before triggering fit view after layout */
  DELAY: 100,
} as const;

/** Mindmap center view configuration */
export const MINDMAP_CENTER_VIEW = {
  /** X offset from node center */
  X_OFFSET: 100,
  /** Y offset from node center (half of node height) */
  Y_OFFSET: 22,
  /** Default zoom level when centering */
  ZOOM: 1,
  /** Navigation animation duration */
  NAV_DURATION: 200,
  /** Center animation duration */
  CENTER_DURATION: 500,
} as const;

// =============================================================================
// Dagre Layout Configuration
// =============================================================================

/** Dagre graph layout settings */
export const DAGRE_LAYOUT = {
  /** Horizontal spacing between nodes */
  NODE_SEPARATION: 60,
  /** Vertical spacing between ranks/levels */
  RANK_SEPARATION: 100,
  /** Horizontal margin */
  MARGIN_X: 20,
  /** Vertical margin */
  MARGIN_Y: 20,
} as const;

// =============================================================================
// UI Element Thresholds
// =============================================================================

/** Text truncation thresholds */
export const TEXT_TRUNCATION = {
  /** Label length threshold for showing tooltip */
  TOOLTIP_THRESHOLD: 25,
  /** Max tooltip width in pixels */
  MAX_TOOLTIP_WIDTH: 300,
  /** Max label width in node (pixels) */
  MAX_LABEL_WIDTH: 180,
} as const;
