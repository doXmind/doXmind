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
  "M299.549 68.4403C306.094 68.5801 307.674 70.6253 311.067 75.7147C311.7 89.2549 312.588 192.228 310.608 198.01C309.931 199.973 307.143 200.99 305.337 201.761C297.999 204.894 289.575 206.335 281.836 208.31L209.711 226.757C197.982 229.76 194.735 232.632 182.956 227.878C174.11 224.743 166 221.134 166.342 209.861C167.194 182.012 167.026 154.255 167.34 126.393C167.398 118.7 169.968 115.822 177.146 113.375C217.792 99.5283 258.918 81.6449 299.549 68.4403Z",
  "M304.784 225.796C307.194 226.012 307.274 226.114 309.4 227.388C311.955 230.685 311.489 234.924 311.511 239.177L311.423 310.969C311.467 321.4 311.365 333.591 311.511 343.737C311.868 367.503 297.591 364.543 279.878 364.651C274.309 364.685 267.793 364.646 262.07 364.644L186.705 364.6C185.78 364.439 184.798 364.276 183.924 363.919C182.468 363.326 181.427 361.943 180.925 360.498C179.723 357.098 179.76 280.213 180.32 270.485C180.473 267.84 180.648 265.16 181.995 262.816C182.948 261.151 184.113 259.566 185.868 258.716C194.997 254.294 211.567 251.389 222.007 248.544L304.784 225.796Z",
  "M10.8653 0C15.2997 0.173285 51.7863 9.64718 56.2324 11.332C69.7343 16.4483 124.332 26.3917 133.298 33.5874C135.895 40.5021 135.7 67.7355 136.039 77.1562L138.539 143.821C138.837 154.053 139.245 164.282 139.762 174.505C140.068 180.52 142.448 196.704 137.367 201.658C135.988 203.001 133.413 202.545 131.55 202.311L49.2892 168.539C40.7268 165.049 4.65673 152.007 1.23719 146.574C-0.147519 140.627 0.336599 121.084 0.343151 113.845L0.546309 49.9272C0.595815 37.5068 -1.41354 19.3366 1.97761 7.20735C3.07329 3.28878 7.19971 1.36371 10.8653 0Z",
  "M3.82611 174.398C16.9634 175.105 74.0232 202.99 90.0617 207.778C101.544 211.207 149.03 230.065 155.946 237.687C158.88 240.921 157.744 292.324 157.715 302.793L157.992 351.087C158.006 356.84 158.53 360.629 154.614 364.547C142.332 364.79 129.703 364.678 117.4 364.619C83.4097 364.458 49.338 365.142 15.3733 364.311C4.77398 364.052 0.506303 357.162 0.464806 347.372C0.30828 309.853 0.389082 272.343 0.419659 234.83L0.454586 197.477C0.461866 191.458 0.391991 185.055 0.707955 179.035C0.792407 177.434 2.70276 175.575 3.82611 174.398Z",
];

const ICON_VIEWBOX = "0 0 312 365";
const ICON_CENTER = "156px 182.5px";

function StaticLogoIcon({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox={ICON_VIEWBOX} width={size} height={size} className={className} aria-hidden="true">
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
      <svg viewBox={ICON_VIEWBOX} width={size} height={size} aria-hidden="true">
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
            style={{ transformOrigin: `${ICON_CENTER}` }}
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
