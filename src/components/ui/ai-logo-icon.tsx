import { cn } from "@/lib/utils";

/**
 * Small doXmind logo icon for AI features
 * Optimized for 14-16px sizes in menus and buttons
 */

interface AiLogoIconProps {
  className?: string;
  size?: number; // Default 16 (h-4 w-4)
}

const iconPaths = [
  "M6 0 Q0 0 0 6 L0 32 L40 40 L32 0 Z",
  "M48 0 L40 40 L80 32 L80 6 Q80 0 74 0 Z",
  "M0 48 L40 40 L32 80 L6 80 Q0 80 0 74 Z",
  "M40 40 L80 48 L80 74 Q80 80 74 80 L48 80 Z",
];

export function AiLogoIcon({ className, size = 16 }: AiLogoIconProps) {
  return (
    <svg
      viewBox="0 0 80 80"
      width={size}
      height={size}
      className={cn("flex-shrink-0", className)}
      aria-hidden="true"
    >
      {iconPaths.map((d, i) => (
        <path key={i} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}
