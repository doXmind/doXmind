/**
 * Theme-aware SVG illustration: Knowledge Base Upload Flow.
 */

import { muted, border, primary, bg } from "./colors";

export function KnowledgeBaseIllustration() {
  return (
    <svg
      viewBox="0 0 440 100"
      fill="none"
      className="w-full max-w-md"
      role="img"
      aria-label="Knowledge base upload flow: upload, process, index, ready"
    >
      {/* Step 1: Document */}
      <rect
        x="10"
        y="20"
        width="60"
        height="50"
        rx="4"
        fill={bg}
        stroke={border}
        strokeWidth="1.5"
      />
      <rect x="18" y="30" width="30" height="3" rx="1.5" fill={muted} opacity="0.4" />
      <rect x="18" y="37" width="40" height="3" rx="1.5" fill={muted} opacity="0.3" />
      <rect x="18" y="44" width="35" height="3" rx="1.5" fill={muted} opacity="0.3" />
      <rect x="18" y="51" width="38" height="3" rx="1.5" fill={muted} opacity="0.3" />
      <text x="40" y="84" textAnchor="middle" fontSize="8" fill={muted}>
        Upload
      </text>

      {/* Arrow */}
      <line
        x1="80"
        y1="45"
        x2="110"
        y2="45"
        stroke={primary}
        strokeWidth="1.5"
        strokeDasharray="4 2"
      />
      <polygon points="110,41 118,45 110,49" fill={primary} />

      {/* Step 2: Processing */}
      <circle
        cx="150"
        cy="45"
        r="24"
        fill={primary}
        opacity="0.08"
        stroke={primary}
        strokeWidth="1"
      />
      {/* Gear-like shape */}
      <circle cx="150" cy="45" r="10" stroke={primary} strokeWidth="1.5" fill="none" />
      <circle cx="150" cy="45" r="4" fill={primary} opacity="0.3" />
      <text x="150" y="84" textAnchor="middle" fontSize="8" fill={muted}>
        Processing
      </text>

      {/* Arrow */}
      <line
        x1="180"
        y1="45"
        x2="210"
        y2="45"
        stroke={primary}
        strokeWidth="1.5"
        strokeDasharray="4 2"
      />
      <polygon points="210,41 218,45 210,49" fill={primary} />

      {/* Step 3: Chunks */}
      <rect
        x="230"
        y="24"
        width="22"
        height="28"
        rx="3"
        fill={primary}
        opacity="0.1"
        stroke={primary}
        strokeWidth="0.5"
      />
      <rect
        x="240"
        y="30"
        width="22"
        height="28"
        rx="3"
        fill={primary}
        opacity="0.15"
        stroke={primary}
        strokeWidth="0.5"
      />
      <rect
        x="250"
        y="36"
        width="22"
        height="28"
        rx="3"
        fill={primary}
        opacity="0.2"
        stroke={primary}
        strokeWidth="0.5"
      />
      <text x="250" y="84" textAnchor="middle" fontSize="8" fill={muted}>
        Chunked
      </text>

      {/* Arrow */}
      <line
        x1="282"
        y1="45"
        x2="312"
        y2="45"
        stroke={primary}
        strokeWidth="1.5"
        strokeDasharray="4 2"
      />
      <polygon points="312,41 320,45 312,49" fill={primary} />

      {/* Step 4: Indexed/searchable */}
      <circle cx="355" cy="45" r="24" fill="#dcfce7" stroke="#22c55e" strokeWidth="1.5" />
      <polyline
        points="343,45 351,53 367,37"
        stroke="#22c55e"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text x="355" y="84" textAnchor="middle" fontSize="8" fill={muted}>
        Indexed
      </text>

      {/* Arrow */}
      <line
        x1="385"
        y1="45"
        x2="400"
        y2="45"
        stroke={primary}
        strokeWidth="1.5"
        strokeDasharray="4 2"
      />
      <polygon points="400,41 408,45 400,49" fill={primary} />

      {/* Step 5: AI uses it */}
      <rect x="412" y="28" width="22" height="22" rx="4" fill={primary} opacity="0.15" />
      <text x="423" y="43" textAnchor="middle" fontSize="12">
        ✨
      </text>
      <text x="423" y="84" textAnchor="middle" fontSize="8" fill={muted}>
        AI Ready
      </text>
    </svg>
  );
}
