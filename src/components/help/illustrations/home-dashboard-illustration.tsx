/**
 * Theme-aware SVG illustration: Home Dashboard.
 */

import { fg, muted, border, primary, bg, mutedBg } from "./colors";

export function HomeDashboardIllustration() {
  return (
    <svg
      viewBox="0 0 480 260"
      fill="none"
      className="w-full max-w-md"
      role="img"
      aria-label="Home dashboard with search bar, Ask AI, and document cards"
    >
      {/* Background */}
      <rect
        x="4"
        y="4"
        width="472"
        height="252"
        rx="10"
        fill={bg}
        stroke={border}
        strokeWidth="1.5"
      />

      {/* Greeting */}
      <text x="240" y="30" textAnchor="middle" fontSize="12" fontWeight="700" fill={fg}>
        Good morning, Alex
      </text>
      <text x="240" y="44" textAnchor="middle" fontSize="8" fill={muted}>
        Pick up where you left off, or search across your writing.
      </text>

      {/* Search bar */}
      <rect
        x="80"
        y="56"
        width="320"
        height="32"
        rx="10"
        fill={mutedBg}
        stroke={border}
        strokeWidth="1"
      />
      {/* Mode toggle pills */}
      <rect x="88" y="62" width="50" height="20" rx="6" fill={primary} opacity="0.15" />
      <text x="113" y="75" textAnchor="middle" fontSize="7" fontWeight="600" fill={primary}>
        Ask AI
      </text>
      <rect x="142" y="62" width="50" height="20" rx="6" fill="transparent" />
      <text x="167" y="75" textAnchor="middle" fontSize="7" fill={muted}>
        Search
      </text>
      {/* Placeholder text */}
      <text x="204" y="75" fontSize="8" fill={muted} opacity="0.5">
        Ask anything about your writing...
      </text>

      {/* Recent files section */}
      <text x="30" y="110" fontSize="9" fontWeight="600" fill={muted}>
        Continue writing
      </text>

      {/* Recent file tiles - 3 across */}
      <rect
        x="24"
        y="118"
        width="138"
        height="36"
        rx="6"
        fill={mutedBg}
        stroke={border}
        strokeWidth="0.5"
      />
      <rect x="34" y="126" width="70" height="5" rx="2.5" fill={fg} opacity="0.6" />
      <rect x="34" y="136" width="40" height="4" rx="2" fill={muted} opacity="0.3" />
      <text x="136" y="140" textAnchor="end" fontSize="7" fill={muted}>
        2h ago
      </text>

      <rect
        x="170"
        y="118"
        width="138"
        height="36"
        rx="6"
        fill={mutedBg}
        stroke={border}
        strokeWidth="0.5"
      />
      <rect x="180" y="126" width="65" height="5" rx="2.5" fill={fg} opacity="0.6" />
      <rect x="180" y="136" width="45" height="4" rx="2" fill={muted} opacity="0.3" />
      <text x="282" y="140" textAnchor="end" fontSize="7" fill={muted}>
        1d ago
      </text>

      <rect
        x="316"
        y="118"
        width="138"
        height="36"
        rx="6"
        fill={mutedBg}
        stroke={border}
        strokeWidth="0.5"
      />
      <rect x="326" y="126" width="60" height="5" rx="2.5" fill={fg} opacity="0.6" />
      <rect x="326" y="136" width="50" height="4" rx="2" fill={muted} opacity="0.3" />
      <text x="428" y="140" textAnchor="end" fontSize="7" fill={muted}>
        3d ago
      </text>

      {/* Document cards grid */}
      <rect
        x="24"
        y="168"
        width="100"
        height="76"
        rx="6"
        fill={mutedBg}
        stroke={border}
        strokeWidth="0.5"
      />
      <rect x="34" y="178" width="60" height="6" rx="3" fill={fg} opacity="0.5" />
      <rect x="34" y="190" width="80" height="4" rx="2" fill={muted} opacity="0.25" />
      <rect x="34" y="198" width="70" height="4" rx="2" fill={muted} opacity="0.25" />
      <rect x="34" y="206" width="75" height="4" rx="2" fill={muted} opacity="0.25" />
      <text x="34" y="234" fontSize="7" fill={muted}>
        5d ago
      </text>

      <rect
        x="136"
        y="168"
        width="100"
        height="76"
        rx="6"
        fill={mutedBg}
        stroke={border}
        strokeWidth="0.5"
      />
      <rect x="146" y="178" width="55" height="6" rx="3" fill={fg} opacity="0.5" />
      <rect x="146" y="190" width="80" height="4" rx="2" fill={muted} opacity="0.25" />
      <rect x="146" y="198" width="65" height="4" rx="2" fill={muted} opacity="0.25" />
      <rect x="146" y="206" width="78" height="4" rx="2" fill={muted} opacity="0.25" />
      <text x="146" y="234" fontSize="7" fill={muted}>
        1w ago
      </text>

      {/* Folder card */}
      <rect
        x="248"
        y="168"
        width="100"
        height="76"
        rx="6"
        fill={mutedBg}
        stroke={border}
        strokeWidth="0.5"
      />
      <text x="298" y="200" textAnchor="middle" fontSize="18">
        📁
      </text>
      <text x="298" y="216" textAnchor="middle" fontSize="8" fontWeight="500" fill={fg}>
        Projects
      </text>
      <text x="298" y="228" textAnchor="middle" fontSize="7" fill={muted}>
        4 files
      </text>

      {/* New button */}
      <rect
        x="360"
        y="168"
        width="100"
        height="76"
        rx="6"
        fill="none"
        stroke={border}
        strokeWidth="1"
        strokeDasharray="4 3"
      />
      <text x="410" y="200" textAnchor="middle" fontSize="20" fill={primary} opacity="0.5">
        +
      </text>
      <text x="410" y="218" textAnchor="middle" fontSize="8" fill={muted}>
        New Document
      </text>
    </svg>
  );
}
