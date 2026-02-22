/**
 * Theme-aware SVG illustration: Presentation Mode.
 */

import { fg, muted, border, primary, mutedBg } from "./colors";

export function PresentationIllustration() {
  return (
    <svg
      viewBox="0 0 400 180"
      fill="none"
      className="w-full max-w-sm"
      role="img"
      aria-label="Presentation mode with slide frame and navigation controls"
    >
      {/* Screen */}
      <rect
        x="40"
        y="10"
        width="320"
        height="130"
        rx="6"
        fill={fg}
        opacity="0.03"
        stroke={border}
        strokeWidth="1.5"
      />
      {/* Slide content */}
      <rect x="120" y="34" width="160" height="10" rx="4" fill={fg} opacity="0.6" />
      <rect x="100" y="56" width="200" height="5" rx="2.5" fill={muted} opacity="0.3" />
      <rect x="110" y="68" width="180" height="5" rx="2.5" fill={muted} opacity="0.3" />
      <rect x="115" y="80" width="170" height="5" rx="2.5" fill={muted} opacity="0.3" />

      {/* Left arrow */}
      <polygon points="60,75 76,62 76,88" fill={primary} opacity="0.3" />
      {/* Right arrow */}
      <polygon points="340,75 324,62 324,88" fill={primary} opacity="0.3" />

      {/* Slide indicator dots */}
      <circle cx="176" cy="120" r="4" fill={primary} />
      <circle cx="192" cy="120" r="4" fill={muted} opacity="0.3" />
      <circle cx="208" cy="120" r="4" fill={muted} opacity="0.3" />
      <circle cx="224" cy="120" r="4" fill={muted} opacity="0.3" />

      {/* Keyboard hint */}
      <rect
        x="138"
        y="152"
        width="124"
        height="20"
        rx="6"
        fill={mutedBg}
        stroke={border}
        strokeWidth="0.5"
      />
      <text x="200" y="166" textAnchor="middle" fontSize="9" fill={muted}>
        ← → Arrow keys to navigate
      </text>
    </svg>
  );
}
