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
// Mindlines Configuration
// =============================================================================

/** Mindlines sidebar width in pixels */
export const MINDLINES_WIDTH = {
  /** Expanded state width (full outline view) */
  EXPANDED: 280,
  /** Collapsed state width (minimal line indicators) */
  COLLAPSED: 48,
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

// =============================================================================
// Mobile/Responsive Configuration
// =============================================================================

/** Responsive breakpoints in pixels (matching Tailwind) */
export const BREAKPOINTS = {
  /** Small devices (large phones landscape) */
  SM: 640,
  /** Medium devices (tablets portrait) - Mobile breakpoint */
  MD: 768,
  /** Large devices (tablets landscape, small laptops) */
  LG: 1024,
  /** Extra large devices (desktops) */
  XL: 1280,
} as const;

/** Mobile touch target sizes in pixels */
export const TOUCH_TARGETS = {
  /** Minimum touch target size (iOS Human Interface Guidelines) */
  MIN: 44,
  /** Recommended touch target size (Android Material Design) */
  RECOMMENDED: 48,
  /** Large touch target for primary actions */
  LARGE: 56,
} as const;

/** Mobile panel dimensions */
export const MOBILE_PANEL = {
  /** Bottom navigation bar height */
  BOTTOM_NAV_HEIGHT: 56,
  /** Mobile header height */
  HEADER_HEIGHT: 48,
  /** Mobile toolbar collapsed height */
  TOOLBAR_COLLAPSED: 48,
  /** Mobile toolbar expanded height */
  TOOLBAR_EXPANDED: 96,
} as const;

/** Z-index layers for mobile overlays */
export const Z_INDEX = {
  /** Floating buttons (outline, etc.) */
  FLOATING_BUTTON: 35,
  /** Bottom navigation bar */
  BOTTOM_NAV: 40,
  /** Mobile overlay backdrop */
  MOBILE_OVERLAY: 45,
  /** Mobile panel */
  MOBILE_PANEL: 50,
  /** Bubble menu and popovers */
  BUBBLE_MENU: 60,
  /** Modal dialogs */
  MODAL: 70,
} as const;

// =============================================================================
// Mobile V2 Configuration (Redesigned Mobile UX)
// =============================================================================

/** Mobile V2 dimensions and sizing */
export const MOBILE_V2 = {
  /** Navigation bar height (reduced from 56px) */
  NAV_BAR_HEIGHT: 48,
  /** Navigation button size */
  NAV_BUTTON_SIZE: 44,
  /** Floating action button size */
  FAB_SIZE: 56,

  /** Floating toolbar height */
  FLOATING_TOOLBAR_HEIGHT: 44,
  /** Toolbar button size */
  TOOLBAR_BUTTON_SIZE: 44,
  /** Toolbar max width */
  TOOLBAR_MAX_WIDTH: 360,
  /** Toolbar border radius (pill shape) */
  TOOLBAR_BORDER_RADIUS: 22,

  /** Panel border radius */
  PANEL_BORDER_RADIUS: 20,
  /** Panel drag handle touch area height */
  PANEL_HANDLE_HEIGHT: 40,
  /** Panel drag handle visual width */
  PANEL_HANDLE_WIDTH: 40,

  /** Block selector width */
  BLOCK_SELECTOR_WIDTH: 260,
  /** Block selector item height */
  BLOCK_SELECTOR_ITEM_HEIGHT: 52,

  /** Edge swipe detection zone width */
  EDGE_SWIPE_ZONE: 20,
  /** Minimum swipe distance to trigger action */
  MIN_SWIPE_DISTANCE: 50,
  /** Swipe velocity threshold (px/s) */
  SWIPE_VELOCITY_THRESHOLD: 300,
  /** Long press duration (ms) */
  LONG_PRESS_DURATION: 500,

  /** Row swipe-to-reveal thresholds */
  ROW_SWIPE: {
    /** Minimum offset to trigger action via distance alone */
    DISTANCE_THRESHOLD: 80,
    /** Minimum offset for velocity-assisted trigger (was 40) */
    VELOCITY_MIN_DISTANCE: 60,
    /** Velocity required for velocity-assisted trigger in px/s (was 300) */
    VELOCITY_THRESHOLD: 500,
    /** Single action button width */
    SINGLE_ACTION_WIDTH: 80,
    /** Double action buttons width (star + delete) */
    DOUBLE_ACTION_WIDTH: 160,
    /** Triple action buttons width (star + share + delete, 3 × 64px) */
    TRIPLE_ACTION_WIDTH: 192,
    /** Quad action buttons width (star + move + share + delete, 4 × 64px) */
    QUAD_ACTION_WIDTH: 256,
  },
} as const;

/** Spring animation configurations for Mobile V2 */
export const MOBILE_SPRINGS = {
  /** Snappy spring for quick feedback (buttons) */
  SNAPPY: { stiffness: 400, damping: 25, mass: 0.5 },
  /** Smooth spring for panel transitions */
  SMOOTH: { stiffness: 300, damping: 30, mass: 0.8 },
  /** Gentle spring for overlays */
  GENTLE: { stiffness: 200, damping: 25, mass: 1 },
  /** Bouncy spring for playful effects */
  BOUNCY: { stiffness: 500, damping: 15, mass: 0.5 },
} as const;
