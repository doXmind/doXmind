/**
 * Theme-aware SVG illustration: Customization / Settings.
 */

import { fg, muted, border, primary, bg, mutedBg } from "./colors";

export function CustomizationIllustration() {
  return (
    <svg
      viewBox="0 0 360 140"
      fill="none"
      className="w-full max-w-sm"
      role="img"
      aria-label="Customization options for font, theme, and editor width"
    >
      {/* Cards */}
      {/* Font card */}
      <rect
        x="10"
        y="10"
        width="100"
        height="120"
        rx="8"
        fill={bg}
        stroke={border}
        strokeWidth="1"
      />
      <text x="60" y="34" textAnchor="middle" fontSize="9" fontWeight="600" fill={fg}>
        Font
      </text>
      <rect
        x="22"
        y="44"
        width="76"
        height="18"
        rx="5"
        fill={primary}
        opacity="0.1"
        stroke={primary}
        strokeWidth="0.5"
      />
      <text x="60" y="56" textAnchor="middle" fontSize="9" fill={primary}>
        Sans-serif
      </text>
      <rect x="22" y="68" width="76" height="18" rx="5" fill={mutedBg} />
      <text x="60" y="80" textAnchor="middle" fontSize="9" fill={muted} fontStyle="italic">
        Serif
      </text>
      <rect x="22" y="92" width="76" height="18" rx="5" fill={mutedBg} />
      <text x="60" y="104" textAnchor="middle" fontSize="9" fill={muted} fontFamily="monospace">
        Mono
      </text>

      {/* Theme card */}
      <rect
        x="130"
        y="10"
        width="100"
        height="120"
        rx="8"
        fill={bg}
        stroke={border}
        strokeWidth="1"
      />
      <text x="180" y="34" textAnchor="middle" fontSize="9" fontWeight="600" fill={fg}>
        Theme
      </text>
      {/* Light */}
      <circle cx="155" cy="60" r="16" fill="white" stroke={border} strokeWidth="1.5" />
      <text x="155" y="64" textAnchor="middle" fontSize="12">
        ☀️
      </text>
      {/* Dark */}
      <circle cx="205" cy="60" r="16" fill="#1a1a1a" stroke={border} strokeWidth="1.5" />
      <text x="205" y="64" textAnchor="middle" fontSize="12">
        🌙
      </text>
      {/* Active indicator */}
      <circle cx="155" cy="60" r="18" stroke={primary} strokeWidth="1.5" fill="none" />
      <text x="180" y="100" textAnchor="middle" fontSize="8" fill={muted}>
        + High Contrast
      </text>

      {/* Width card */}
      <rect
        x="250"
        y="10"
        width="100"
        height="120"
        rx="8"
        fill={bg}
        stroke={border}
        strokeWidth="1"
      />
      <text x="300" y="34" textAnchor="middle" fontSize="9" fontWeight="600" fill={fg}>
        Width
      </text>
      {/* Width options */}
      <rect
        x="275"
        y="46"
        width="24"
        height="16"
        rx="3"
        fill={primary}
        opacity="0.15"
        stroke={primary}
        strokeWidth="0.5"
      />
      <rect x="278" y="50" width="18" height="8" rx="2" fill={primary} opacity="0.3" />
      <text x="287" y="74" textAnchor="middle" fontSize="7" fill={muted}>
        Narrow
      </text>

      <rect x="306" y="46" width="30" height="16" rx="3" fill={mutedBg} />
      <rect x="309" y="50" width="24" height="8" rx="2" fill={muted} opacity="0.3" />
      <text x="321" y="74" textAnchor="middle" fontSize="7" fill={muted}>
        Wide
      </text>

      <rect x="268" y="88" width="64" height="16" rx="3" fill={mutedBg} />
      <rect x="271" y="92" width="58" height="8" rx="2" fill={muted} opacity="0.3" />
      <text x="300" y="118" textAnchor="middle" fontSize="7" fill={muted}>
        Full
      </text>
    </svg>
  );
}
