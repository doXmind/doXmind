"use client";

import { useEffect, useState } from "react";

interface DeviceType {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  width: number;
  isNativeApp: boolean;
}

const MD = 768;
const LG = 1024;

function readDeviceType(): DeviceType {
  if (typeof window === "undefined") {
    return {
      isMobile: false,
      isTablet: false,
      isDesktop: true,
      width: LG,
      isNativeApp: false,
    };
  }

  const width = window.innerWidth;
  return {
    isMobile: width < MD,
    isTablet: width >= MD && width < LG,
    isDesktop: width >= LG,
    width,
    isNativeApp: false,
  };
}

export function useDeviceType(): DeviceType {
  const [deviceType, setDeviceType] = useState<DeviceType>(() => readDeviceType());

  useEffect(() => {
    const update = () => setDeviceType(readDeviceType());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return deviceType;
}

export function useIsMobile(): boolean {
  return useDeviceType().isMobile;
}
