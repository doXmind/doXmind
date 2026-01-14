"use client";

import { useState, useEffect } from "react";
import { BREAKPOINTS } from "@/lib/constants";

interface DeviceType {
  /** Mobile device (< 768px) */
  isMobile: boolean;
  /** Tablet device (768px - 1024px) */
  isTablet: boolean;
  /** Desktop device (>= 1024px) */
  isDesktop: boolean;
  /** Current viewport width */
  width: number;
}

/**
 * Hook to detect device type based on viewport width.
 * Uses Tailwind's breakpoint system for consistency.
 *
 * @returns Device type information
 */
export function useDeviceType(): DeviceType {
  const [deviceType, setDeviceType] = useState<DeviceType>({
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    width: typeof window !== "undefined" ? window.innerWidth : BREAKPOINTS.LG,
  });

  useEffect(() => {
    const checkDevice = () => {
      const width = window.innerWidth;
      setDeviceType({
        isMobile: width < BREAKPOINTS.MD,
        isTablet: width >= BREAKPOINTS.MD && width < BREAKPOINTS.LG,
        isDesktop: width >= BREAKPOINTS.LG,
        width,
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
 * @returns true if viewport is less than 768px
 */
export function useIsMobile(): boolean {
  const { isMobile } = useDeviceType();
  return isMobile;
}
