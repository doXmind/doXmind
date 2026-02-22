/**
 * Theme-aware SVG illustration: Quick Edit Flow.
 */

import { fg, muted, border, primary, bg, mutedBg } from "./colors";

export function QuickEditIllustration() {
  return (
    <svg
      viewBox="0 0 460 160"
      fill="none"
      className="w-full max-w-md"
      role="img"
      aria-label="Quick edit flow: select text, choose action, review changes"
    >
      {/* Step 1: Selected text */}
      <rect
        x="10"
        y="20"
        width="130"
        height="60"
        rx="8"
        fill={bg}
        stroke={border}
        strokeWidth="1"
      />
      <rect x="22" y="34" width="80" height="5" rx="2.5" fill={muted} opacity="0.3" />
      <rect x="22" y="44" width="100" height="6" rx="3" fill={primary} opacity="0.2" />
      <rect x="22" y="44" width="100" height="6" rx="3" stroke={primary} strokeWidth="0.5" />
      <rect x="22" y="56" width="70" height="5" rx="2.5" fill={muted} opacity="0.3" />
      <text x="75" y="92" textAnchor="middle" fontSize="9" fontWeight="500" fill={muted}>
        Select text
      </text>

      {/* Arrow 1 */}
      <line
        x1="150"
        y1="50"
        x2="170"
        y2="50"
        stroke={primary}
        strokeWidth="1.5"
        markerEnd="url(#arrowhead)"
      />

      {/* Step 2: Floating menu */}
      <rect
        x="180"
        y="10"
        width="110"
        height="110"
        rx="8"
        fill={bg}
        stroke={border}
        strokeWidth="1"
      />
      <rect x="192" y="22" width="80" height="10" rx="4" fill={primary} opacity="0.15" />
      <text x="232" y="30" textAnchor="middle" fontSize="7" fill={primary}>
        Fix Grammar
      </text>
      <rect x="192" y="38" width="80" height="10" rx="4" fill={mutedBg} />
      <text x="232" y="46" textAnchor="middle" fontSize="7" fill={fg} opacity="0.7">
        Improve
      </text>
      <rect x="192" y="54" width="80" height="10" rx="4" fill={mutedBg} />
      <text x="232" y="62" textAnchor="middle" fontSize="7" fill={fg} opacity="0.7">
        Simplify
      </text>
      <rect x="192" y="70" width="80" height="10" rx="4" fill={mutedBg} />
      <text x="232" y="78" textAnchor="middle" fontSize="7" fill={fg} opacity="0.7">
        Make Longer
      </text>
      <rect x="192" y="86" width="80" height="10" rx="4" fill={mutedBg} />
      <text x="232" y="94" textAnchor="middle" fontSize="7" fill={fg} opacity="0.7">
        Translate
      </text>
      <rect x="192" y="102" width="80" height="10" rx="4" fill={mutedBg} />
      <text x="232" y="110" textAnchor="middle" fontSize="7" fill={fg} opacity="0.7">
        Ask in Chat
      </text>
      <text x="235" y="138" textAnchor="middle" fontSize="9" fontWeight="500" fill={muted}>
        Pick action
      </text>

      {/* Arrow 2 */}
      <line
        x1="300"
        y1="50"
        x2="320"
        y2="50"
        stroke={primary}
        strokeWidth="1.5"
        markerEnd="url(#arrowhead)"
      />

      {/* Step 3: Diff result */}
      <rect
        x="330"
        y="20"
        width="120"
        height="60"
        rx="8"
        fill={bg}
        stroke={border}
        strokeWidth="1"
      />
      <rect
        x="342"
        y="32"
        width="90"
        height="6"
        rx="3"
        fill="#dcfce7"
        stroke="#22c55e"
        strokeWidth="0.5"
      />
      <rect
        x="342"
        y="44"
        width="85"
        height="6"
        rx="3"
        fill="#fee2e2"
        stroke="#ef4444"
        strokeWidth="0.5"
      />
      <rect x="342" y="58" width="40" height="10" rx="4" fill="#22c55e" opacity="0.8" />
      <text x="362" y="66" textAnchor="middle" fontSize="7" fill="white" fontWeight="600">
        Accept
      </text>
      <rect
        x="388"
        y="58"
        width="40"
        height="10"
        rx="4"
        fill={mutedBg}
        stroke={border}
        strokeWidth="0.5"
      />
      <text x="408" y="66" textAnchor="middle" fontSize="7" fill={muted}>
        Reject
      </text>
      <text x="390" y="100" textAnchor="middle" fontSize="9" fontWeight="500" fill={muted}>
        Review diff
      </text>

      {/* Arrow marker */}
      <defs>
        <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
          <path d="M0,0 L8,3 L0,6" fill={primary} />
        </marker>
      </defs>
    </svg>
  );
}
