/**
 * Theme-aware SVG illustration: Autocomplete.
 */

import { fg, muted, border, primary, bg } from "./colors";

export function AutocompleteIllustration() {
  return (
    <svg
      viewBox="0 0 400 120"
      fill="none"
      className="w-full max-w-sm"
      role="img"
      aria-label="AI autocomplete showing ghost text suggestion after cursor"
    >
      {/* Editor area */}
      <rect
        x="10"
        y="10"
        width="380"
        height="100"
        rx="8"
        fill={bg}
        stroke={border}
        strokeWidth="1.5"
      />
      {/* Existing text */}
      <text x="24" y="38" fontSize="12" fill={fg}>
        The quick brown fox jumps over
      </text>
      {/* Cursor */}
      <line x1="232" y1="26" x2="232" y2="42" stroke={primary} strokeWidth="1.5" />
      {/* Ghost text (autocomplete suggestion) */}
      <text x="236" y="38" fontSize="12" fill={muted} opacity="0.45">
        the lazy dog near the river
      </text>
      {/* Second line */}
      <text x="24" y="58" fontSize="12" fill={muted} opacity="0.45">
        bank where the sun sets gently.
      </text>
      {/* Tab hint */}
      <rect
        x="290"
        y="72"
        width="80"
        height="24"
        rx="6"
        fill={primary}
        opacity="0.1"
        stroke={primary}
        strokeWidth="0.5"
      />
      <text x="306" y="88" fontSize="10" fill={primary} fontWeight="500">
        Tab
      </text>
      <text x="326" y="88" fontSize="10" fill={muted}>
        to accept
      </text>
    </svg>
  );
}
