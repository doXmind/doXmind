/**
 * Theme-aware SVG illustration: Toolbar / Formatting.
 */

import { fg, muted, border, bg } from "./colors";

export function ToolbarIllustration() {
  return (
    <svg
      viewBox="0 0 420 100"
      fill="none"
      className="w-full max-w-sm"
      role="img"
      aria-label="Text formatting toolbar showing bold, italic, and other options"
    >
      {/* Toolbar background */}
      <rect
        x="10"
        y="20"
        width="400"
        height="40"
        rx="10"
        fill={bg}
        stroke={border}
        strokeWidth="1.5"
      />
      {/* B */}
      <text x="36" y="46" textAnchor="middle" fontSize="16" fontWeight="800" fill={fg}>
        B
      </text>
      {/* I */}
      <text
        x="72"
        y="46"
        textAnchor="middle"
        fontSize="16"
        fontStyle="italic"
        fontWeight="600"
        fill={fg}
      >
        I
      </text>
      {/* U */}
      <text
        x="108"
        y="46"
        textAnchor="middle"
        fontSize="16"
        fontWeight="600"
        fill={fg}
        textDecoration="underline"
      >
        U
      </text>
      {/* S (strikethrough) */}
      <text
        x="144"
        y="46"
        textAnchor="middle"
        fontSize="16"
        fontWeight="600"
        fill={fg}
        textDecoration="line-through"
      >
        S
      </text>
      {/* Divider */}
      <line x1="168" y1="28" x2="168" y2="52" stroke={border} strokeWidth="1" />
      {/* H1 */}
      <text x="192" y="46" textAnchor="middle" fontSize="13" fontWeight="700" fill={fg}>
        H1
      </text>
      {/* H2 */}
      <text x="224" y="46" textAnchor="middle" fontSize="13" fontWeight="700" fill={muted}>
        H2
      </text>
      {/* H3 */}
      <text x="256" y="46" textAnchor="middle" fontSize="13" fontWeight="700" fill={muted}>
        H3
      </text>
      {/* Divider */}
      <line x1="278" y1="28" x2="278" y2="52" stroke={border} strokeWidth="1" />
      {/* List icon */}
      <rect x="294" y="33" width="12" height="2" rx="1" fill={fg} />
      <rect x="294" y="39" width="12" height="2" rx="1" fill={fg} />
      <rect x="294" y="45" width="12" height="2" rx="1" fill={fg} />
      <circle cx="289" cy="34" r="1.5" fill={fg} />
      <circle cx="289" cy="40" r="1.5" fill={fg} />
      <circle cx="289" cy="46" r="1.5" fill={fg} />
      {/* Code icon */}
      <text x="332" y="46" textAnchor="middle" fontSize="14" fontFamily="monospace" fill={muted}>
        &lt;/&gt;
      </text>
      {/* Link icon */}
      <text x="370" y="46" textAnchor="middle" fontSize="13" fill={muted}>
        🔗
      </text>

      {/* Labels below */}
      <text x="36" y="78" textAnchor="middle" fontSize="8" fill={muted}>
        Bold
      </text>
      <text x="72" y="78" textAnchor="middle" fontSize="8" fill={muted}>
        Italic
      </text>
      <text x="108" y="78" textAnchor="middle" fontSize="8" fill={muted}>
        Under
      </text>
      <text x="144" y="78" textAnchor="middle" fontSize="8" fill={muted}>
        Strike
      </text>
      <text x="192" y="78" textAnchor="middle" fontSize="8" fill={muted}>
        Head 1
      </text>
      <text x="224" y="78" textAnchor="middle" fontSize="8" fill={muted}>
        Head 2
      </text>
      <text x="256" y="78" textAnchor="middle" fontSize="8" fill={muted}>
        Head 3
      </text>
      <text x="296" y="78" textAnchor="middle" fontSize="8" fill={muted}>
        List
      </text>
      <text x="332" y="78" textAnchor="middle" fontSize="8" fill={muted}>
        Code
      </text>
      <text x="370" y="78" textAnchor="middle" fontSize="8" fill={muted}>
        Link
      </text>
    </svg>
  );
}
