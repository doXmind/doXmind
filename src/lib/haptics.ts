/**
 * Haptic Feedback Utility
 *
 * Provides cross-platform haptic feedback for mobile interactions.
 * Uses the Vibration API where available.
 */

type VibrationPattern = number | number[];

/**
 * Check if haptic feedback is supported
 */
export const isHapticsSupported = (): boolean => {
  return typeof navigator !== "undefined" && "vibrate" in navigator;
};

/**
 * Trigger vibration with pattern
 */
const vibrate = (pattern: VibrationPattern): boolean => {
  if (!isHapticsSupported()) return false;
  try {
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
};

/**
 * Haptic feedback presets for different interactions
 */
export const haptics = {
  /**
   * Light haptic - for button taps, toggles
   * Duration: 10ms
   */
  light: () => vibrate(10),

  /**
   * Medium haptic - for panel open/close, significant actions
   * Duration: 20ms
   */
  medium: () => vibrate(20),

  /**
   * Heavy haptic - for errors, warnings
   * Duration: 30ms
   */
  heavy: () => vibrate(30),

  /**
   * Success haptic - for completed actions
   * Pattern: tap-pause-tap (10ms-50ms-10ms)
   */
  success: () => vibrate([10, 50, 10]),

  /**
   * Error haptic - for failed actions
   * Pattern: three short bursts (30ms-30ms-30ms-30ms-30ms)
   */
  error: () => vibrate([30, 30, 30, 30, 30]),

  /**
   * Tick haptic - for scrolling boundaries, snap points
   * Duration: 5ms
   */
  tick: () => vibrate(5),

  /**
   * Selection haptic - for text selection, item selection
   * Duration: 15ms
   */
  selection: () => vibrate(15),

  /**
   * Impact haptic - for collisions, drops
   * Pattern: double tap (15ms-30ms-15ms)
   */
  impact: () => vibrate([15, 30, 15]),
} as const;

/**
 * Haptic feedback types
 */
export type HapticType = keyof typeof haptics;

/**
 * Trigger haptic feedback by type
 */
export const triggerHaptic = (type: HapticType): boolean => {
  return haptics[type]();
};
