"use client";

import { useState, useEffect } from "react";
import { BREAKPOINTS } from "@/lib/constants";
import { getIsNativeWebView } from "@/lib/native-bridge";

interface DeviceType {
  /** Mobile device (< 768px) */
  isMobile: boolean;
  /** Tablet device (768px - 1024px) */
  isTablet: boolean;
  /** Desktop device (>= 1024px) */
  isDesktop: boolean;
  /** Current viewport width */
  width: number;
  /** Running inside React Native WebView */
  isNativeApp: boolean;
}

/**
 * Hook to detect device type based on viewport width.
 * Uses Tailwind's breakpoint system for consistency.
 * In Native WebView (Expo app), always returns mobile.
 *
 * @returns Device type information
 */
export function useDeviceType(): DeviceType {
  const [deviceType, setDeviceType] = useState<DeviceType>(() => {
    if (typeof window === "undefined") {
      // Server-side: default to desktop
      return {
        isMobile: false,
        isTablet: false,
        isDesktop: true,
        width: BREAKPOINTS.LG,
        isNativeApp: false,
      };
    }
    // Client-side: check for native WebView
    const isNative = getIsNativeWebView();
    if (isNative) {
      return {
        isMobile: true,
        isTablet: false,
        isDesktop: false,
        width: window.innerWidth,
        isNativeApp: true,
      };
    }
    // Regular browser
    const width = window.innerWidth;
    return {
      isMobile: width < BREAKPOINTS.MD,
      isTablet: width >= BREAKPOINTS.MD && width < BREAKPOINTS.LG,
      isDesktop: width >= BREAKPOINTS.LG,
      width,
      isNativeApp: false,
    };
  });

  useEffect(() => {
    // Check native WebView dynamically (in case it wasn't available at init)
    const isNative = getIsNativeWebView();

    if (isNative) {
      // Native WebView: always mobile, no need to listen for resize
      setDeviceType({
        isMobile: true,
        isTablet: false,
        isDesktop: false,
        width: window.innerWidth,
        isNativeApp: true,
      });
      return;
    }

    const checkDevice = () => {
      const width = window.innerWidth;
      setDeviceType({
        isMobile: width < BREAKPOINTS.MD,
        isTablet: width >= BREAKPOINTS.MD && width < BREAKPOINTS.LG,
        isDesktop: width >= BREAKPOINTS.LG,
        width,
        isNativeApp: false,
      });
    };

    // Initial check
    checkDevice();

    // Listen for resize events
    window.addEventListener("resize", checkDevice);

    return () => {
      window.removeEventListener("resize", checkDevice);
    };
  }, []);

  return deviceType;
}

/**
 * Hook to check if the current device is mobile.
 * Convenience wrapper around useDeviceType.
 *
 * @returns true if viewport is less than 768px or in native WebView
 */
export function useIsMobile(): boolean {
  const { isMobile } = useDeviceType();
  return isMobile;
}
