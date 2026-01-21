/**
 * Haptic Feedback Utility
 *
 * Provides cross-platform haptic feedback for mobile interactions.
 * Uses native haptics via bridge when in RN WebView, otherwise falls back to Vibration API.
 */

import { isNativeWebView, nativeBridge } from "./native-bridge";

type VibrationPattern = number | number[];

/**
 * Check if haptic feedback is supported
 */
export const isHapticsSupported = (): boolean => {
  // Native WebView always supports haptics via expo-haptics
  if (isNativeWebView) return true;
  return typeof navigator !== "undefined" && "vibrate" in navigator;
};

/**
 * Trigger vibration with pattern (web fallback)
 */
const vibrate = (pattern: VibrationPattern): boolean => {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return false;
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
  light: () => {
    if (isNativeWebView) {
      nativeBridge.haptic.light();
      return true;
    }
    return vibrate(10);
  },

  /**
   * Medium haptic - for panel open/close, significant actions
   * Duration: 20ms
   */
  medium: () => {
    if (isNativeWebView) {
      nativeBridge.haptic.medium();
      return true;
    }
    return vibrate(20);
  },

  /**
   * Heavy haptic - for errors, warnings
   * Duration: 30ms
   */
  heavy: () => {
    if (isNativeWebView) {
      nativeBridge.haptic.heavy();
      return true;
    }
    return vibrate(30);
  },

  /**
   * Success haptic - for completed actions
   * Pattern: tap-pause-tap (10ms-50ms-10ms)
   */
  success: () => {
    if (isNativeWebView) {
      nativeBridge.haptic.success();
      return true;
    }
    return vibrate([10, 50, 10]);
  },

  /**
   * Error haptic - for failed actions
   * Pattern: three short bursts (30ms-30ms-30ms-30ms-30ms)
   */
  error: () => {
    if (isNativeWebView) {
      nativeBridge.haptic.error();
      return true;
    }
    return vibrate([30, 30, 30, 30, 30]);
  },

  /**
   * Tick haptic - for scrolling boundaries, snap points
   * Duration: 5ms
   */
  tick: () => {
    if (isNativeWebView) {
      nativeBridge.haptic.tick();
      return true;
    }
    return vibrate(5);
  },

  /**
   * Selection haptic - for text selection, item selection
   * Duration: 15ms
   */
  selection: () => {
    if (isNativeWebView) {
      nativeBridge.haptic.selection();
      return true;
    }
    return vibrate(15);
  },

  /**
   * Impact haptic - for collisions, drops
   * Pattern: double tap (15ms-30ms-15ms)
   */
  impact: () => {
    if (isNativeWebView) {
      nativeBridge.haptic.impact();
      return true;
    }
    return vibrate([15, 30, 15]);
  },
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
