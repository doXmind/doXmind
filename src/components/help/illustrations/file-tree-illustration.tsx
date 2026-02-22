/**
 * Theme-aware SVG illustration: File Tree.
 */

import { fg, muted, border, primary, bg, mutedBg } from "./colors";

export function FileTreeIllustration() {
  return (
    <svg
      viewBox="0 0 300 160"
      fill="none"
      className="w-full max-w-[260px]"
      role="img"
      aria-label="File tree with folders and documents"
    >
      <rect
        x="4"
        y="4"
        width="292"
        height="152"
        rx="8"
        fill={bg}
        stroke={border}
        strokeWidth="1.5"
      />
      {/* Folder 1 */}
      <text x="24" y="32" fontSize="12">
        📁
      </text>
      <text x="42" y="32" fontSize="10" fontWeight="600" fill={fg}>
        My Projects
      </text>
      {/* File 1 */}
      <text x="44" y="52" fontSize="11">
        📄
      </text>
      <text x="60" y="52" fontSize="10" fill={muted}>
        Research Notes.md
      </text>
      {/* File 2 */}
      <text x="44" y="70" fontSize="11">
        📄
      </text>
      <text x="60" y="70" fontSize="10" fill={muted}>
        Meeting Summary.md
      </text>
      {/* Folder 2 */}
      <text x="24" y="94" fontSize="12">
        📁
      </text>
      <text x="42" y="94" fontSize="10" fontWeight="600" fill={fg}>
        Blog Posts
      </text>
      {/* File 3 */}
      <text x="44" y="114" fontSize="11">
        📄
      </text>
      <text x="60" y="114" fontSize="10" fill={primary}>
        Draft: AI Writing.md
      </text>

      {/* Action icons area */}
      <rect x="210" y="46" width="20" height="14" rx="3" fill={mutedBg} />
      <text x="220" y="56" textAnchor="middle" fontSize="8" fill={muted}>
        ✎
      </text>
      <rect x="234" y="46" width="20" height="14" rx="3" fill={mutedBg} />
      <text x="244" y="56" textAnchor="middle" fontSize="8" fill={muted}>
        ⋯
      </text>

      {/* Export badges */}
      <rect
        x="180"
        y="134"
        width="30"
        height="14"
        rx="4"
        fill={primary}
        opacity="0.1"
        stroke={primary}
        strokeWidth="0.5"
      />
      <text x="195" y="144" textAnchor="middle" fontSize="7" fill={primary}>
        MD
      </text>
      <rect
        x="216"
        y="134"
        width="30"
        height="14"
        rx="4"
        fill={primary}
        opacity="0.1"
        stroke={primary}
        strokeWidth="0.5"
      />
      <text x="231" y="144" textAnchor="middle" fontSize="7" fill={primary}>
        PDF
      </text>
      <rect
        x="252"
        y="134"
        width="36"
        height="14"
        rx="4"
        fill={primary}
        opacity="0.1"
        stroke={primary}
        strokeWidth="0.5"
      />
      <text x="270" y="144" textAnchor="middle" fontSize="7" fill={primary}>
        DOCX
      </text>
    </svg>
  );
}
