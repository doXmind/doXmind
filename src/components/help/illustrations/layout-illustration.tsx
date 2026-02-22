/**
 * Theme-aware SVG illustration: Application Layout Overview.
 */

import { fg, muted, border, primary, bg, mutedBg } from "./colors";

export function LayoutIllustration() {
  return (
    <svg
      viewBox="0 0 480 240"
      fill="none"
      className="w-full max-w-md"
      role="img"
      aria-label="Application layout showing outline sidebar, editor, and chat panel"
    >
      {/* Window frame */}
      <rect
        x="4"
        y="4"
        width="472"
        height="232"
        rx="8"
        stroke={border}
        strokeWidth="1.5"
        fill={bg}
      />
      {/* Title bar */}
      <rect x="4" y="4" width="472" height="28" rx="8" fill={mutedBg} />
      <rect x="4" y="24" width="472" height="8" fill={mutedBg} />
      <circle cx="20" cy="18" r="4" fill="#ff5f57" />
      <circle cx="34" cy="18" r="4" fill="#febc2e" />
      <circle cx="48" cy="18" r="4" fill="#28c840" />

      {/* Sidebar */}
      <rect x="4" y="32" width="90" height="204" fill={mutedBg} />
      <line x1="94" y1="32" x2="94" y2="236" stroke={border} strokeWidth="1" />
      {/* Sidebar headings */}
      <rect x="16" y="48" width="50" height="6" rx="3" fill={muted} opacity="0.5" />
      <rect x="24" y="62" width="42" height="5" rx="2.5" fill={muted} opacity="0.3" />
      <rect x="24" y="74" width="38" height="5" rx="2.5" fill={muted} opacity="0.3" />
      <rect x="16" y="90" width="54" height="6" rx="3" fill={muted} opacity="0.5" />
      <rect x="24" y="104" width="40" height="5" rx="2.5" fill={muted} opacity="0.3" />

      {/* Editor area */}
      <rect x="110" y="48" width="180" height="8" rx="4" fill={fg} opacity="0.7" />
      <rect x="110" y="66" width="220" height="5" rx="2.5" fill={muted} opacity="0.3" />
      <rect x="110" y="78" width="200" height="5" rx="2.5" fill={muted} opacity="0.3" />
      <rect x="110" y="90" width="190" height="5" rx="2.5" fill={muted} opacity="0.3" />
      <rect x="110" y="108" width="140" height="7" rx="3.5" fill={fg} opacity="0.5" />
      <rect x="110" y="124" width="210" height="5" rx="2.5" fill={muted} opacity="0.3" />
      <rect x="110" y="136" width="195" height="5" rx="2.5" fill={muted} opacity="0.3" />
      <rect x="110" y="148" width="180" height="5" rx="2.5" fill={muted} opacity="0.3" />
      <rect x="110" y="160" width="205" height="5" rx="2.5" fill={muted} opacity="0.3" />

      {/* Chat panel */}
      <line x1="350" y1="32" x2="350" y2="236" stroke={border} strokeWidth="1" />
      {/* Chat messages */}
      <rect
        x="362"
        y="48"
        width="90"
        height="24"
        rx="8"
        fill={mutedBg}
        stroke={border}
        strokeWidth="0.5"
      />
      <rect x="368" y="56" width="60" height="4" rx="2" fill={muted} opacity="0.4" />
      <rect x="368" y="64" width="40" height="4" rx="2" fill={muted} opacity="0.3" />
      <rect x="390" y="84" width="74" height="28" rx="8" fill={primary} opacity="0.15" />
      <rect x="396" y="92" width="50" height="4" rx="2" fill={primary} opacity="0.5" />
      <rect x="396" y="100" width="36" height="4" rx="2" fill={primary} opacity="0.4" />
      {/* Chat input */}
      <rect
        x="362"
        y="208"
        width="104"
        height="20"
        rx="6"
        stroke={border}
        strokeWidth="1"
        fill={bg}
      />
      <rect x="370" y="216" width="50" height="4" rx="2" fill={muted} opacity="0.3" />

      {/* Labels */}
      <text x="49" y="200" textAnchor="middle" fontSize="9" fontWeight="600" fill={primary}>
        Outline
      </text>
      <text x="220" y="200" textAnchor="middle" fontSize="9" fontWeight="600" fill={primary}>
        Editor
      </text>
      <text x="414" y="150" textAnchor="middle" fontSize="9" fontWeight="600" fill={primary}>
        AI Chat
      </text>
    </svg>
  );
}
