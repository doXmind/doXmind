/**
 * Theme-aware SVG illustration: Diff Review.
 */

import { muted, border, primary, bg, mutedBg } from "./colors";

export function DiffReviewIllustration() {
  return (
    <svg
      viewBox="0 0 400 150"
      fill="none"
      className="w-full max-w-sm"
      role="img"
      aria-label="Diff review showing added and removed text with accept and reject buttons"
    >
      {/* Block */}
      <rect
        x="10"
        y="10"
        width="380"
        height="130"
        rx="8"
        fill={bg}
        stroke={border}
        strokeWidth="1.5"
      />
      {/* Removed line */}
      <rect x="20" y="24" width="360" height="20" rx="4" fill="#fee2e2" />
      <text x="34" y="37" fontSize="10" fill="#991b1b" fontFamily="monospace">
        - The product was very good and worked well
      </text>
      {/* Added line */}
      <rect x="20" y="50" width="360" height="20" rx="4" fill="#dcfce7" />
      <text x="34" y="63" fontSize="10" fill="#166534" fontFamily="monospace">
        + The product delivered exceptional performance
      </text>
      {/* Unchanged line */}
      <rect x="34" y="78" width="220" height="5" rx="2.5" fill={muted} opacity="0.2" />
      <rect x="34" y="88" width="180" height="5" rx="2.5" fill={muted} opacity="0.2" />

      {/* Action buttons */}
      <rect x="20" y="104" width="70" height="24" rx="6" fill="#22c55e" />
      <text x="55" y="120" textAnchor="middle" fontSize="10" fill="white" fontWeight="600">
        Accept
      </text>
      <rect
        x="98"
        y="104"
        width="70"
        height="24"
        rx="6"
        fill={mutedBg}
        stroke={border}
        strokeWidth="1"
      />
      <text x="133" y="120" textAnchor="middle" fontSize="10" fill={muted} fontWeight="500">
        Reject
      </text>
      <rect
        x="280"
        y="104"
        width="90"
        height="24"
        rx="6"
        fill={primary}
        opacity="0.1"
        stroke={primary}
        strokeWidth="0.5"
      />
      <text x="325" y="120" textAnchor="middle" fontSize="10" fill={primary} fontWeight="500">
        Accept All
      </text>
    </svg>
  );
}
