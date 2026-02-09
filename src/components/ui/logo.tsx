"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface LogoProps {
  variant?: "icon" | "horizontal" | "stacked";
  size?: "sm" | "md" | "lg";
  className?: string;
  animated?: boolean;
}

const sizeConfig = {
  sm: { icon: 24, text: 16, gap: 8 },
  md: { icon: 40, text: 24, gap: 12 },
  lg: { icon: 80, text: 48, gap: 20 },
};

const iconPaths = [
  "M6 0 Q0 0 0 6 L0 32 L40 40 L32 0 Z",
  "M48 0 L40 40 L80 32 L80 6 Q80 0 74 0 Z",
  "M0 48 L40 40 L32 80 L6 80 Q0 80 0 74 Z",
  "M40 40 L80 48 L80 74 Q80 80 74 80 L48 80 Z",
];

function StaticLogoIcon({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 80 80" width={size} height={size} className={className} aria-hidden="true">
      {iconPaths.map((d, i) => (
        <path key={i} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}

function AnimatedLogoIcon({ size = 40 }: { size?: number }) {
  const [isHovered, setIsHovered] = React.useState(false);

  return (
    <motion.div
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      className="relative cursor-pointer"
    >
      <svg viewBox="0 0 80 80" width={size} height={size} aria-hidden="true">
        {iconPaths.map((d, i) => (
          <motion.path
            key={i}
            d={d}
            fill="currentColor"
            animate={
              isHovered
                ? {
                    scale: [1, 0.6, 1],
                    rotate: [0, -90, 0],
                    opacity: [1, 0.7, 1],
                  }
                : {
                    scale: 1,
                    rotate: 0,
                    opacity: 1,
                  }
            }
            transition={{
              duration: 0.5,
              delay: i * 0.05,
              ease: [0.34, 1.56, 0.64, 1],
              repeat: isHovered ? Infinity : 0,
              repeatDelay: 0.3,
            }}
            style={{ transformOrigin: "40px 40px" }}
          />
        ))}
      </svg>
    </motion.div>
  );
}

function LogoText({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn("tracking-tight", className)}
      style={{ fontSize: size, letterSpacing: "-0.03em" }}
    >
      <span className="font-light">do</span>
      <span className="font-black">X</span>
      <span className="font-light">mind</span>
    </span>
  );
}

export function Logo({
  variant = "horizontal",
  size = "md",
  className,
  animated = true,
}: LogoProps) {
  const config = sizeConfig[size];
  const IconComponent = animated ? AnimatedLogoIcon : StaticLogoIcon;

  if (variant === "icon") {
    return (
      <div className={cn("flex items-center justify-center", className)} aria-label="doXmind">
        <IconComponent size={config.icon} />
      </div>
    );
  }

  if (variant === "stacked") {
    return (
      <div
        className={cn("flex flex-col items-center justify-center", className)}
        style={{ gap: config.gap }}
        aria-label="doXmind"
      >
        <IconComponent size={config.icon} />
        <LogoText size={config.text} />
      </div>
    );
  }

  // horizontal (default)
  return (
    <div
      className={cn("flex items-center", className)}
      style={{ gap: config.gap }}
      aria-label="doXmind"
    >
      <IconComponent size={config.icon} />
      <LogoText size={config.text} />
    </div>
  );
}
