"use client";

import Image from "next/image";
import { getFrame } from "@/lib/frames/registry";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  avatarUrl?: string | null;
  username?: string | null;
  /** Size in pixels */
  size: number;
  /** Frame ID from the registry */
  frame?: string | null;
  /** User plan — renders a small badge at bottom-right */
  plan?: "free" | "pro" | "max" | null;
  className?: string;
}

/**
 * Shared avatar component with optional premium frame rendering.
 * Replaces inline avatar implementations across the codebase.
 */
export function UserAvatar({ avatarUrl, username, size, frame, plan, className }: UserAvatarProps) {
  const frameDef = getFrame(frame);

  // Compute frame thickness proportional to avatar size
  const padding = !frameDef ? 0 : size < 32 ? 1.5 : size < 64 ? 2 : 3;

  const avatar = avatarUrl ? (
    <Image
      src={avatarUrl}
      alt={username || ""}
      width={size}
      height={size}
      className="rounded-full"
      style={{ width: size, height: size }}
      unoptimized
    />
  ) : (
    <div
      className="flex items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(size * 0.4, 8),
      }}
    >
      {(username || "?")[0].toUpperCase()}
    </div>
  );

  // Plan badge — shown at bottom-right for pro/max users
  const showBadge = plan && plan !== "free" && size >= 24;
  const badgeEl = showBadge ? (
    <PlanBadgeOverlay plan={plan} size={size} frameDef={frameDef} />
  ) : null;

  // No frame — render plain avatar
  if (!frameDef) {
    return (
      <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
        {avatar}
        {badgeEl}
      </div>
    );
  }

  // With frame — gradient ring wrapper
  const outerSize = size + padding * 2 + 2; // padding on each side + 1px gap ring on each side

  return (
    <div
      className={cn("relative shrink-0 rounded-full", className)}
      style={{
        width: outerSize,
        height: outerSize,
        ...(frameDef.background.includes("gradient")
          ? { backgroundImage: frameDef.background }
          : { backgroundColor: frameDef.background }),
        backgroundSize: frameDef.animation?.includes("shimmer") ? "200% 100%" : undefined,
        boxShadow: frameDef.glow,
        animation: frameDef.animation,
        padding: padding,
      }}
    >
      {/* Gap ring — matches page background for clean separation */}
      <div className="rounded-full bg-background" style={{ padding: 1 }}>
        {avatar}
      </div>
      {badgeEl}
    </div>
  );
}

function PlanBadgeOverlay({
  plan,
  size,
  frameDef,
}: {
  plan: "pro" | "max";
  size: number;
  frameDef: ReturnType<typeof getFrame>;
}) {
  // Badge sizing based on avatar size
  const badgeH = size >= 80 ? 16 : size >= 40 ? 13 : 11;
  const fontSize = size >= 80 ? 8 : size >= 40 ? 7 : 6;

  // Badge color: use frame's primary color, or default pro/max colors
  const defaultColor = plan === "pro" ? "#3B82F6" : "#8B5CF6";
  const bgColor = frameDef?.previewColors?.[0] || defaultColor;

  return (
    <span
      className="absolute flex items-center justify-center rounded-full font-extrabold uppercase leading-none text-white ring-1 ring-background"
      style={{
        height: badgeH,
        paddingLeft: 3,
        paddingRight: 3,
        fontSize,
        backgroundColor: bgColor,
        bottom: size >= 40 ? -1 : 0,
        right: size >= 40 ? -2 : -1,
      }}
    >
      {plan === "pro" ? "PRO" : "MAX"}
    </span>
  );
}
