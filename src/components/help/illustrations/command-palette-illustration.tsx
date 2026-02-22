/**
 * Theme-aware SVG illustration: Command Palette.
 */

import { fg, muted, border, primary, bg, mutedBg } from "./colors";

export function CommandPaletteIllustration() {
  return (
    <svg
      viewBox="0 0 340 160"
      fill="none"
      className="w-full max-w-[280px]"
      role="img"
      aria-label="Command palette with search input and result list"
    >
      {/* Backdrop */}
      <rect x="0" y="0" width="340" height="160" rx="4" fill={fg} opacity="0.05" />
      {/* Palette window */}
      <rect
        x="30"
        y="10"
        width="280"
        height="140"
        rx="10"
        fill={bg}
        stroke={border}
        strokeWidth="1.5"
      />
      {/* Search input */}
      <rect
        x="44"
        y="24"
        width="252"
        height="28"
        rx="6"
        fill={mutedBg}
        stroke={border}
        strokeWidth="0.5"
      />
      <text x="56" y="42" fontSize="10" fill={muted} opacity="0.5">
        Type a command or search...
      </text>
      {/* Results */}
      <rect x="44" y="62" width="252" height="22" rx="4" fill={primary} opacity="0.1" />
      <text x="58" y="77" fontSize="9" fill={fg} fontWeight="500">
        New Document
      </text>
      <rect x="44" y="88" width="252" height="22" rx="4" fill="transparent" />
      <text x="58" y="103" fontSize="9" fill={muted}>
        Toggle Outline
      </text>
      <rect x="44" y="114" width="252" height="22" rx="4" fill="transparent" />
      <text x="58" y="129" fontSize="9" fill={muted}>
        Semantic Search
      </text>
    </svg>
  );
}
