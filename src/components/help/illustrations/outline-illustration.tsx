/**
 * Theme-aware SVG illustration: Outline Tree.
 */

import { fg, muted, border, primary, bg } from "./colors";

export function OutlineIllustration() {
  return (
    <svg
      viewBox="0 0 280 160"
      fill="none"
      className="w-full max-w-[240px]"
      role="img"
      aria-label="Outline sidebar showing nested heading hierarchy"
    >
      <rect
        x="4"
        y="4"
        width="272"
        height="152"
        rx="8"
        fill={bg}
        stroke={border}
        strokeWidth="1.5"
      />
      <text x="140" y="24" textAnchor="middle" fontSize="10" fontWeight="600" fill={fg}>
        Outline
      </text>
      <line x1="16" y1="32" x2="264" y2="32" stroke={border} strokeWidth="1" />

      {/* H1 */}
      <circle cx="28" cy="48" r="4" fill={primary} />
      <rect x="40" y="44" width="100" height="7" rx="3" fill={fg} opacity="0.7" />
      {/* Line connector */}
      <line x1="28" y1="52" x2="28" y2="68" stroke={border} strokeWidth="1" />

      {/* H2 */}
      <circle cx="44" cy="68" r="3" fill={primary} opacity="0.6" />
      <rect x="56" y="65" width="80" height="6" rx="3" fill={muted} opacity="0.5" />
      <line x1="28" y1="68" x2="41" y2="68" stroke={border} strokeWidth="1" />
      <line x1="44" y1="71" x2="44" y2="86" stroke={border} strokeWidth="1" />

      {/* H3 */}
      <circle cx="60" cy="86" r="2.5" fill={primary} opacity="0.4" />
      <rect x="70" y="83" width="70" height="5" rx="2.5" fill={muted} opacity="0.35" />
      <line x1="44" y1="86" x2="57" y2="86" stroke={border} strokeWidth="1" />

      {/* H3 */}
      <circle cx="60" cy="100" r="2.5" fill={primary} opacity="0.4" />
      <rect x="70" y="97" width="60" height="5" rx="2.5" fill={muted} opacity="0.35" />
      <line x1="44" y1="86" x2="44" y2="100" stroke={border} strokeWidth="1" />
      <line x1="44" y1="100" x2="57" y2="100" stroke={border} strokeWidth="1" />

      {/* H1 */}
      <circle cx="28" cy="120" r="4" fill={primary} />
      <rect x="40" y="116" width="110" height="7" rx="3" fill={fg} opacity="0.7" />

      {/* H2 */}
      <line x1="28" y1="124" x2="28" y2="138" stroke={border} strokeWidth="1" />
      <circle cx="44" cy="138" r="3" fill={primary} opacity="0.6" />
      <rect x="56" y="135" width="85" height="6" rx="3" fill={muted} opacity="0.5" />
      <line x1="28" y1="138" x2="41" y2="138" stroke={border} strokeWidth="1" />

      {/* Click cursor hint */}
      <text x="230" y="70" fontSize="14" opacity="0.5">
        👆
      </text>
      <text x="200" y="88" fontSize="8" fill={muted}>
        Click to jump
      </text>
    </svg>
  );
}
