"use client";

import * as React from "react";
import { motion, useAnimationControls, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

interface AnimatedLogoProps {
  size?: "md" | "lg" | "xl";
  className?: string;
  onAnimationComplete?: () => void;
}

const sizeConfig = {
  md: { icon: 60, text: 32, gap: 16 },
  lg: { icon: 80, text: 48, gap: 20 },
  xl: { icon: 120, text: 64, gap: 28 },
};

// Icon paths for the 4 quadrants
const iconPaths = [
  "M6 0 Q0 0 0 6 L0 32 L40 40 L32 0 Z", // top-left
  "M48 0 L40 40 L80 32 L80 6 Q80 0 74 0 Z", // top-right
  "M0 48 L40 40 L32 80 L6 80 Q0 80 0 74 Z", // bottom-left
  "M40 40 L80 48 L80 74 Q80 80 74 80 L48 80 Z", // bottom-right
];

// TikTok-style colors
const CYAN = "#00f2ea";
const RED = "#ff0050";

// Shared glitch trigger context
const GlitchContext = React.createContext<{
  subscribe: (callback: () => void) => () => void;
} | null>(null);

export function GlitchProvider({ children }: { children: React.ReactNode }) {
  const subscribersRef = React.useRef<Set<() => void>>(new Set());
  const isMounted = React.useRef(false);
  const shouldReduceMotion = useReducedMotion();

  const subscribe = React.useCallback((callback: () => void) => {
    subscribersRef.current.add(callback);
    return () => {
      subscribersRef.current.delete(callback);
    };
  }, []);

  React.useEffect(() => {
    if (shouldReduceMotion) return;

    isMounted.current = true;

    const runGlitchLoop = async () => {
      // Wait for initial animation to complete
      await new Promise((resolve) => setTimeout(resolve, 2000));

      while (isMounted.current) {
        await new Promise((resolve) => setTimeout(resolve, 2500 + Math.random() * 1500));
        if (isMounted.current) {
          // Trigger all subscribers simultaneously
          subscribersRef.current.forEach((cb) => cb());
        }
      }
    };

    runGlitchLoop();

    return () => {
      isMounted.current = false;
    };
  }, [shouldReduceMotion]);

  return <GlitchContext.Provider value={{ subscribe }}>{children}</GlitchContext.Provider>;
}

export function AnimatedLogoIcon({ size = 80 }: { size?: number }) {
  const mainControls = useAnimationControls();
  const redControls = useAnimationControls();
  const cyanControls = useAnimationControls();
  const glitchContext = React.useContext(GlitchContext);

  const triggerGlitch = React.useCallback(() => {
    // Cyan layer moves left
    cyanControls.start({
      x: [0, -4, -3, -4, 0],
      opacity: [0, 0.8, 0.6, 0.7, 0],
      transition: { duration: 0.2, ease: "easeInOut" },
    });

    // Red layer moves right
    redControls.start({
      x: [0, 4, 3, 4, 0],
      opacity: [0, 0.8, 0.6, 0.7, 0],
      transition: { duration: 0.2, ease: "easeInOut" },
    });

    // Main layer shakes
    mainControls.start({
      x: [0, -2, 2, -1, 1, 0],
      transition: { duration: 0.2, ease: "easeInOut" },
    });
  }, [mainControls, redControls, cyanControls]);

  React.useEffect(() => {
    if (glitchContext) {
      return glitchContext.subscribe(triggerGlitch);
    }
  }, [glitchContext, triggerGlitch]);

  return (
    <div className="relative">
      {/* Cyan ghost layer (left offset) */}
      <motion.svg
        viewBox="0 0 80 80"
        width={size}
        height={size}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        animate={cyanControls}
        initial={{ opacity: 0, x: 0 }}
      >
        {iconPaths.map((d, i) => (
          <path key={i} d={d} fill={CYAN} />
        ))}
      </motion.svg>

      {/* Red ghost layer (right offset) */}
      <motion.svg
        viewBox="0 0 80 80"
        width={size}
        height={size}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        animate={redControls}
        initial={{ opacity: 0, x: 0 }}
      >
        {iconPaths.map((d, i) => (
          <path key={i} d={d} fill={RED} />
        ))}
      </motion.svg>

      {/* Main layer */}
      <motion.svg
        viewBox="0 0 80 80"
        width={size}
        height={size}
        aria-hidden="true"
        className="relative z-10"
        animate={mainControls}
      >
        {iconPaths.map((d, i) => (
          <motion.path
            key={i}
            d={d}
            fill="currentColor"
            initial={{ opacity: 0, scale: 0.5, rotate: -90 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{
              duration: 0.5,
              delay: i * 0.1,
              ease: [0.34, 1.56, 0.64, 1],
            }}
            style={{ transformOrigin: "40px 40px" }}
          />
        ))}
      </motion.svg>
    </div>
  );
}

function AnimatedLogoText({ size = 48 }: { size?: number }) {
  const text = [
    { char: "d", weight: "font-light" },
    { char: "o", weight: "font-light" },
    { char: "X", weight: "font-black" },
    { char: "m", weight: "font-light" },
    { char: "i", weight: "font-light" },
    { char: "n", weight: "font-light" },
    { char: "d", weight: "font-light" },
  ];

  return (
    <motion.div
      className="flex items-center"
      style={{ fontSize: size, letterSpacing: "-0.03em" }}
      initial="hidden"
      animate="visible"
    >
      {text.map((item, i) => (
        <motion.span
          key={i}
          className={cn(item.weight, item.char === "X" && "relative")}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.4,
            delay: 0.6 + i * 0.05,
            ease: [0.34, 1.56, 0.64, 1],
          }}
        >
          {item.char === "X" ? <GlitchX char={item.char} /> : item.char}
        </motion.span>
      ))}
    </motion.div>
  );
}

function GlitchX({ char }: { char: string }) {
  const controls = useAnimationControls();
  const glitchContext = React.useContext(GlitchContext);

  const triggerGlitch = React.useCallback(() => {
    controls.start({
      textShadow: [
        "0 0 0 transparent, 0 0 0 transparent",
        `-3px 0 0 ${CYAN}, 3px 0 0 ${RED}`,
        `-2px 0 0 ${CYAN}, 2px 0 0 ${RED}`,
        `-3px 0 0 ${CYAN}, 3px 0 0 ${RED}`,
        "0 0 0 transparent, 0 0 0 transparent",
      ],
      x: [0, -1, 1, -1, 0],
      transition: { duration: 0.2 },
    });
  }, [controls]);

  React.useEffect(() => {
    if (glitchContext) {
      return glitchContext.subscribe(triggerGlitch);
    }
  }, [glitchContext, triggerGlitch]);

  return (
    <motion.span animate={controls} className="inline-block">
      {char}
    </motion.span>
  );
}

export function AnimatedLogo({ size = "lg", className, onAnimationComplete }: AnimatedLogoProps) {
  const config = sizeConfig[size];

  React.useEffect(() => {
    if (onAnimationComplete) {
      const timer = setTimeout(onAnimationComplete, 1500);
      return () => clearTimeout(timer);
    }
  }, [onAnimationComplete]);

  return (
    <GlitchProvider>
      <motion.div
        className={cn("flex flex-col items-center justify-center", className)}
        style={{ gap: config.gap }}
        aria-label="doXmind"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        <AnimatedLogoIcon size={config.icon} />
        <AnimatedLogoText size={config.text} />
      </motion.div>
    </GlitchProvider>
  );
}
