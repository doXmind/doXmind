/**
 * Theme-aware SVG illustration: Chat Panel.
 */

import { fg, muted, border, primary, bg, mutedBg } from "./colors";

export function ChatIllustration() {
  return (
    <svg
      viewBox="0 0 300 240"
      fill="none"
      className="w-full max-w-[260px]"
      role="img"
      aria-label="AI chat panel with messages and input area"
    >
      {/* Panel */}
      <rect
        x="4"
        y="4"
        width="292"
        height="232"
        rx="10"
        fill={bg}
        stroke={border}
        strokeWidth="1.5"
      />
      {/* Header */}
      <rect x="4" y="4" width="292" height="32" rx="10" fill={mutedBg} />
      <rect x="4" y="28" width="292" height="8" fill={mutedBg} />
      <text x="150" y="24" textAnchor="middle" fontSize="11" fontWeight="600" fill={fg}>
        AI Chat
      </text>

      {/* User message */}
      <rect x="100" y="50" width="176" height="30" rx="10" fill={primary} opacity="0.12" />
      <text x="116" y="64" fontSize="9" fill={fg} opacity="0.8">
        Make this paragraph more
      </text>
      <text x="116" y="74" fontSize="9" fill={fg} opacity="0.8">
        concise and professional
      </text>

      {/* AI response */}
      <rect x="20" y="92" width="200" height="70" rx="10" fill={mutedBg} />
      <rect x="32" y="104" width="120" height="5" rx="2.5" fill={muted} opacity="0.5" />
      <rect x="32" y="114" width="160" height="5" rx="2.5" fill={muted} opacity="0.4" />
      <rect x="32" y="124" width="140" height="5" rx="2.5" fill={muted} opacity="0.4" />
      <rect
        x="32"
        y="138"
        width="60"
        height="14"
        rx="5"
        fill={primary}
        opacity="0.15"
        stroke={primary}
        strokeWidth="0.5"
      />
      <text x="62" y="148" textAnchor="middle" fontSize="8" fill={primary}>
        Apply Edit
      </text>

      {/* Suggestion chips */}
      <rect
        x="20"
        y="174"
        width="80"
        height="18"
        rx="8"
        fill={mutedBg}
        stroke={border}
        strokeWidth="0.5"
      />
      <text x="60" y="186" textAnchor="middle" fontSize="7" fill={muted}>
        Summarize doc
      </text>
      <rect
        x="108"
        y="174"
        width="80"
        height="18"
        rx="8"
        fill={mutedBg}
        stroke={border}
        strokeWidth="0.5"
      />
      <text x="148" y="186" textAnchor="middle" fontSize="7" fill={muted}>
        Brainstorm ideas
      </text>

      {/* Input bar */}
      <rect
        x="16"
        y="202"
        width="220"
        height="24"
        rx="8"
        stroke={border}
        strokeWidth="1"
        fill={bg}
      />
      <text x="28" y="218" fontSize="9" fill={muted} opacity="0.5">
        Ask AI anything...
      </text>
      {/* Attachment icons */}
      <circle cx="254" cy="214" r="8" fill={mutedBg} />
      <text x="254" y="217" textAnchor="middle" fontSize="8" fill={muted}>
        📎
      </text>
      <circle cx="276" cy="214" r="8" fill={primary} opacity="0.15" />
      <text x="276" y="217" textAnchor="middle" fontSize="8" fill={primary}>
        ↑
      </text>
    </svg>
  );
}
