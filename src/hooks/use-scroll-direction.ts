"use client";

import { useEffect, useRef, useState } from "react";

interface UseScrollDirectionOptions {
  threshold?: number;
  topThreshold?: number;
}

export function useScrollDirection({
  threshold = 10,
  topThreshold = 100,
}: UseScrollDirectionOptions = {}) {
  const [isVisible, setIsVisible] = useState(true);
  const lastScrollY = useRef(0);
  const ticking = useRef(false);

  useEffect(() => {
    const update = () => {
      const scrollY = window.scrollY;

      // Always show when near top
      if (scrollY < topThreshold) {
        setIsVisible(true);
        lastScrollY.current = scrollY;
        ticking.current = false;
        return;
      }

      const diff = scrollY - lastScrollY.current;

      if (Math.abs(diff) > threshold) {
        // Scrolling down → hide, scrolling up → show
        setIsVisible(diff < 0);
        lastScrollY.current = scrollY;
      }

      ticking.current = false;
    };

    const onScroll = () => {
      if (!ticking.current) {
        requestAnimationFrame(update);
        ticking.current = true;
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold, topThreshold]);

  return isVisible;
}
