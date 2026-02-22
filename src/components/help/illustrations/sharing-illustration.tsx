/**
 * Theme-aware SVG illustration: Sharing.
 */

import { fg, muted, border, primary, bg, mutedBg } from "./colors";

export function SharingIllustration() {
  return (
    <svg
      viewBox="0 0 380 100"
      fill="none"
      className="w-full max-w-sm"
      role="img"
      aria-label="Share document flow: click share, copy link, viewer opens"
    >
      {/* Step 1: Document with share icon */}
      <rect
        x="10"
        y="20"
        width="70"
        height="50"
        rx="6"
        fill={bg}
        stroke={border}
        strokeWidth="1.5"
      />
      <rect x="20" y="30" width="40" height="4" rx="2" fill={muted} opacity="0.3" />
      <rect x="20" y="38" width="48" height="4" rx="2" fill={muted} opacity="0.3" />
      <rect x="20" y="46" width="36" height="4" rx="2" fill={muted} opacity="0.3" />
      <circle cx="68" cy="24" r="10" fill={primary} opacity="0.15" />
      <text x="68" y="28" textAnchor="middle" fontSize="10">
        🔗
      </text>
      <text x="45" y="84" textAnchor="middle" fontSize="8" fill={muted}>
        Share
      </text>

      {/* Arrow */}
      <line
        x1="90"
        y1="45"
        x2="130"
        y2="45"
        stroke={primary}
        strokeWidth="1.5"
        strokeDasharray="4 2"
      />
      <polygon points="130,41 138,45 130,49" fill={primary} />

      {/* Step 2: Link */}
      <rect
        x="148"
        y="28"
        width="110"
        height="28"
        rx="6"
        fill={mutedBg}
        stroke={border}
        strokeWidth="1"
      />
      <text x="162" y="46" fontSize="8" fill={muted} fontFamily="monospace">
        doxmind.com/s/abc123
      </text>
      <rect x="232" y="34" width="18" height="16" rx="3" fill={primary} opacity="0.15" />
      <text x="241" y="46" textAnchor="middle" fontSize="8" fill={primary}>
        📋
      </text>
      <text x="203" y="72" textAnchor="middle" fontSize="8" fill={muted}>
        Copy link
      </text>

      {/* Arrow */}
      <line
        x1="268"
        y1="45"
        x2="298"
        y2="45"
        stroke={primary}
        strokeWidth="1.5"
        strokeDasharray="4 2"
      />
      <polygon points="298,41 306,45 298,49" fill={primary} />

      {/* Step 3: Viewer */}
      <rect
        x="314"
        y="16"
        width="56"
        height="58"
        rx="6"
        fill={bg}
        stroke={border}
        strokeWidth="1.5"
      />
      <rect x="322" y="26" width="36" height="5" rx="2.5" fill={fg} opacity="0.5" />
      <rect x="322" y="36" width="40" height="3" rx="1.5" fill={muted} opacity="0.3" />
      <rect x="322" y="42" width="36" height="3" rx="1.5" fill={muted} opacity="0.3" />
      <rect x="322" y="48" width="32" height="3" rx="1.5" fill={muted} opacity="0.3" />
      <circle cx="342" cy="62" r="6" fill={primary} opacity="0.1" />
      <text x="342" y="65" textAnchor="middle" fontSize="7" fill={primary}>
        👁
      </text>
      <text x="342" y="88" textAnchor="middle" fontSize="8" fill={muted}>
        Read-only
      </text>
    </svg>
  );
}
