import { BadgeCheck } from "lucide-react";

interface OfficialBadgeProps {
  size?: number;
  className?: string;
}

export function OfficialBadge({ size = 16, className = "" }: OfficialBadgeProps) {
  return (
    <BadgeCheck
      className={`inline-block shrink-0 fill-blue-500 text-white dark:fill-blue-400 ${className}`}
      style={{ width: size, height: size }}
      aria-label="Official"
    />
  );
}
