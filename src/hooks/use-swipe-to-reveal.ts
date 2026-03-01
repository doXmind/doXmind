"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMotionValue, useTransform, type PanInfo, type MotionValue } from "framer-motion";
import { MOBILE_V2, MOBILE_SPRINGS } from "@/lib/constants";
import { haptics } from "@/lib/haptics";
import { useSwipeCoordinator } from "@/components/home/swipe-coordinator";

const { VELOCITY_MIN_DISTANCE, VELOCITY_THRESHOLD } = MOBILE_V2.ROW_SWIPE;

interface SwipeToRevealOptions {
  /** Unique identifier for this swipeable row (used for auto-close coordination) */
  id: string;
  /** Width of the right action area revealed on left-swipe */
  rightActionWidth: number;
}

interface SwipeToRevealResult {
  /** Whether actions are currently revealed (row is pinned open) */
  isRevealed: boolean;
  /** Close the revealed actions programmatically */
  close: () => void;
  /** Opacity for the right actions (left-swipe) */
  rightActionsOpacity: MotionValue<number>;
  /** Props to spread onto the draggable motion.div */
  dragProps: {
    drag: "x";
    dragDirectionLock: true;
    dragConstraints: { left: number; right: number };
    dragElastic: { left: number; right: number };
    dragMomentum: false;
    style: { x: MotionValue<number>; touchAction: string };
    animate: { x: number };
    transition: { type: "spring"; stiffness: number; damping: number; mass: number };
    onDrag: (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => void;
    onDragEnd: (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => void;
  };
}

export function useSwipeToReveal({
  id,
  rightActionWidth,
}: SwipeToRevealOptions): SwipeToRevealResult {
  const coordinator = useSwipeCoordinator();
  const [isRevealed, setIsRevealed] = useState(false);

  const x = useMotionValue(0);
  const hasTriggeredHapticRef = useRef(false);

  // Derived motion value for right action buttons opacity
  const rightActionsOpacity = useTransform(x, [-rightActionWidth, 0], [1, 0]);

  // Close handler — used by coordinator and exposed to consumers
  const close = useCallback(() => {
    setIsRevealed(false);
  }, []);

  // Register with coordinator for auto-close
  useEffect(() => {
    if (!coordinator) return;
    return coordinator.register(id, close);
  }, [coordinator, id, close]);

  const handleDrag = useCallback(
    (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      // Left swipe haptic at threshold
      if (info.offset.x < -rightActionWidth && !hasTriggeredHapticRef.current) {
        hasTriggeredHapticRef.current = true;
        haptics.tick();
      } else if (info.offset.x >= -rightActionWidth) {
        hasTriggeredHapticRef.current = false;
      }
    },
    [rightActionWidth]
  );

  const handleDragEnd = useCallback(
    (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      hasTriggeredHapticRef.current = false;

      // Swipe left: reveal action buttons
      const distanceTrigger = info.offset.x < -rightActionWidth;
      const velocityTrigger =
        info.offset.x < -VELOCITY_MIN_DISTANCE && info.velocity.x < -VELOCITY_THRESHOLD;

      if (distanceTrigger || velocityTrigger) {
        setIsRevealed(true);
        coordinator?.setOpenRow(id);
        return;
      }

      // Not enough swipe — snap back
      setIsRevealed(false);
    },
    [rightActionWidth, coordinator, id]
  );

  const dragProps = {
    drag: "x" as const,
    dragDirectionLock: true as const,
    dragConstraints: { left: -rightActionWidth, right: 0 },
    dragElastic: { left: 0.08, right: 0 },
    dragMomentum: false as const,
    style: { x, touchAction: "pan-y" },
    animate: { x: isRevealed ? -rightActionWidth : 0 },
    transition: {
      type: "spring" as const,
      ...MOBILE_SPRINGS.SMOOTH,
    },
    onDrag: handleDrag,
    onDragEnd: handleDragEnd,
  };

  return {
    isRevealed,
    close,
    rightActionsOpacity,
    dragProps,
  };
}
