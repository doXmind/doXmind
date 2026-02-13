/**
 * Theme-aware SVG illustrations for the Help page.
 * All colors use currentColor or CSS variables for light/dark mode support.
 */

const fg = "hsl(var(--foreground))";
const muted = "hsl(var(--muted-foreground))";
const border = "hsl(var(--border))";
const primary = "hsl(var(--primary))";
const bg = "hsl(var(--background))";
const mutedBg = "hsl(var(--muted))";

/* ─── 1. Layout Overview ─────────────────────────────────────────── */
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

/* ─── 2. Toolbar / Formatting ────────────────────────────────────── */
export function ToolbarIllustration() {
  return (
    <svg
      viewBox="0 0 420 100"
      fill="none"
      className="w-full max-w-sm"
      role="img"
      aria-label="Text formatting toolbar showing bold, italic, and other options"
    >
      {/* Toolbar background */}
      <rect
        x="10"
        y="20"
        width="400"
        height="40"
        rx="10"
        fill={bg}
        stroke={border}
        strokeWidth="1.5"
      />
      {/* B */}
      <text x="36" y="46" textAnchor="middle" fontSize="16" fontWeight="800" fill={fg}>
        B
      </text>
      {/* I */}
      <text
        x="72"
        y="46"
        textAnchor="middle"
        fontSize="16"
        fontStyle="italic"
        fontWeight="600"
        fill={fg}
      >
        I
      </text>
      {/* U */}
      <text
        x="108"
        y="46"
        textAnchor="middle"
        fontSize="16"
        fontWeight="600"
        fill={fg}
        textDecoration="underline"
      >
        U
      </text>
      {/* S (strikethrough) */}
      <text
        x="144"
        y="46"
        textAnchor="middle"
        fontSize="16"
        fontWeight="600"
        fill={fg}
        textDecoration="line-through"
      >
        S
      </text>
      {/* Divider */}
      <line x1="168" y1="28" x2="168" y2="52" stroke={border} strokeWidth="1" />
      {/* H1 */}
      <text x="192" y="46" textAnchor="middle" fontSize="13" fontWeight="700" fill={fg}>
        H1
      </text>
      {/* H2 */}
      <text x="224" y="46" textAnchor="middle" fontSize="13" fontWeight="700" fill={muted}>
        H2
      </text>
      {/* H3 */}
      <text x="256" y="46" textAnchor="middle" fontSize="13" fontWeight="700" fill={muted}>
        H3
      </text>
      {/* Divider */}
      <line x1="278" y1="28" x2="278" y2="52" stroke={border} strokeWidth="1" />
      {/* List icon */}
      <rect x="294" y="33" width="12" height="2" rx="1" fill={fg} />
      <rect x="294" y="39" width="12" height="2" rx="1" fill={fg} />
      <rect x="294" y="45" width="12" height="2" rx="1" fill={fg} />
      <circle cx="289" cy="34" r="1.5" fill={fg} />
      <circle cx="289" cy="40" r="1.5" fill={fg} />
      <circle cx="289" cy="46" r="1.5" fill={fg} />
      {/* Code icon */}
      <text x="332" y="46" textAnchor="middle" fontSize="14" fontFamily="monospace" fill={muted}>
        &lt;/&gt;
      </text>
      {/* Link icon */}
      <text x="370" y="46" textAnchor="middle" fontSize="13" fill={muted}>
        🔗
      </text>

      {/* Labels below */}
      <text x="36" y="78" textAnchor="middle" fontSize="8" fill={muted}>
        Bold
      </text>
      <text x="72" y="78" textAnchor="middle" fontSize="8" fill={muted}>
        Italic
      </text>
      <text x="108" y="78" textAnchor="middle" fontSize="8" fill={muted}>
        Under
      </text>
      <text x="144" y="78" textAnchor="middle" fontSize="8" fill={muted}>
        Strike
      </text>
      <text x="192" y="78" textAnchor="middle" fontSize="8" fill={muted}>
        Head 1
      </text>
      <text x="224" y="78" textAnchor="middle" fontSize="8" fill={muted}>
        Head 2
      </text>
      <text x="256" y="78" textAnchor="middle" fontSize="8" fill={muted}>
        Head 3
      </text>
      <text x="296" y="78" textAnchor="middle" fontSize="8" fill={muted}>
        List
      </text>
      <text x="332" y="78" textAnchor="middle" fontSize="8" fill={muted}>
        Code
      </text>
      <text x="370" y="78" textAnchor="middle" fontSize="8" fill={muted}>
        Link
      </text>
    </svg>
  );
}

/* ─── 3. Quick Edit Flow ─────────────────────────────────────────── */
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

/* ─── 4. Autocomplete ────────────────────────────────────────────── */
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

/* ─── 5. Chat Panel ──────────────────────────────────────────────── */
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

/* ─── 6. Diff Review ─────────────────────────────────────────────── */
export function DiffReviewIllustration() {
  return (
    <svg
      viewBox="0 0 400 150"
      fill="none"
      className="w-full max-w-sm"
      role="img"
      aria-label="Diff review showing added and removed text with accept and reject buttons"
    >
      {/* Block */}
      <rect
        x="10"
        y="10"
        width="380"
        height="130"
        rx="8"
        fill={bg}
        stroke={border}
        strokeWidth="1.5"
      />
      {/* Removed line */}
      <rect x="20" y="24" width="360" height="20" rx="4" fill="#fee2e2" />
      <text x="34" y="37" fontSize="10" fill="#991b1b" fontFamily="monospace">
        - The product was very good and worked well
      </text>
      {/* Added line */}
      <rect x="20" y="50" width="360" height="20" rx="4" fill="#dcfce7" />
      <text x="34" y="63" fontSize="10" fill="#166534" fontFamily="monospace">
        + The product delivered exceptional performance
      </text>
      {/* Unchanged line */}
      <rect x="34" y="78" width="220" height="5" rx="2.5" fill={muted} opacity="0.2" />
      <rect x="34" y="88" width="180" height="5" rx="2.5" fill={muted} opacity="0.2" />

      {/* Action buttons */}
      <rect x="20" y="104" width="70" height="24" rx="6" fill="#22c55e" />
      <text x="55" y="120" textAnchor="middle" fontSize="10" fill="white" fontWeight="600">
        Accept
      </text>
      <rect
        x="98"
        y="104"
        width="70"
        height="24"
        rx="6"
        fill={mutedBg}
        stroke={border}
        strokeWidth="1"
      />
      <text x="133" y="120" textAnchor="middle" fontSize="10" fill={muted} fontWeight="500">
        Reject
      </text>
      <rect
        x="280"
        y="104"
        width="90"
        height="24"
        rx="6"
        fill={primary}
        opacity="0.1"
        stroke={primary}
        strokeWidth="0.5"
      />
      <text x="325" y="120" textAnchor="middle" fontSize="10" fill={primary} fontWeight="500">
        Accept All
      </text>
    </svg>
  );
}

/* ─── 7. Knowledge Base Upload Flow ──────────────────────────────── */
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

/* ─── 8. Command Palette ─────────────────────────────────────────── */
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

/* ─── 9. File Tree ───────────────────────────────────────────────── */
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

/* ─── 10. Presentation Mode ──────────────────────────────────────── */
export function PresentationIllustration() {
  return (
    <svg
      viewBox="0 0 400 180"
      fill="none"
      className="w-full max-w-sm"
      role="img"
      aria-label="Presentation mode with slide frame and navigation controls"
    >
      {/* Screen */}
      <rect
        x="40"
        y="10"
        width="320"
        height="130"
        rx="6"
        fill={fg}
        opacity="0.03"
        stroke={border}
        strokeWidth="1.5"
      />
      {/* Slide content */}
      <rect x="120" y="34" width="160" height="10" rx="4" fill={fg} opacity="0.6" />
      <rect x="100" y="56" width="200" height="5" rx="2.5" fill={muted} opacity="0.3" />
      <rect x="110" y="68" width="180" height="5" rx="2.5" fill={muted} opacity="0.3" />
      <rect x="115" y="80" width="170" height="5" rx="2.5" fill={muted} opacity="0.3" />

      {/* Left arrow */}
      <polygon points="60,75 76,62 76,88" fill={primary} opacity="0.3" />
      {/* Right arrow */}
      <polygon points="340,75 324,62 324,88" fill={primary} opacity="0.3" />

      {/* Slide indicator dots */}
      <circle cx="176" cy="120" r="4" fill={primary} />
      <circle cx="192" cy="120" r="4" fill={muted} opacity="0.3" />
      <circle cx="208" cy="120" r="4" fill={muted} opacity="0.3" />
      <circle cx="224" cy="120" r="4" fill={muted} opacity="0.3" />

      {/* Keyboard hint */}
      <rect
        x="138"
        y="152"
        width="124"
        height="20"
        rx="6"
        fill={mutedBg}
        stroke={border}
        strokeWidth="0.5"
      />
      <text x="200" y="166" textAnchor="middle" fontSize="9" fill={muted}>
        ← → Arrow keys to navigate
      </text>
    </svg>
  );
}

/* ─── 11. Outline Tree ───────────────────────────────────────────── */
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

/* ─── 12. Customization / Settings ───────────────────────────────── */
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

/* ─── Home Dashboard ─────────────────────────────────────────────── */
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

/* ─── 13. Sharing ────────────────────────────────────────────────── */
export function SharingIllustration() {
  return (
    <svg
      viewBox="0 0 380 100"
      fill="none"
      className="w-full max-w-sm"
      role="img"
      aria-label="Share document flow: click share, copy link, viewer opens"
    >
      {/* Step 1: Document with share icon */}
      <rect
        x="10"
        y="20"
        width="70"
        height="50"
        rx="6"
        fill={bg}
        stroke={border}
        strokeWidth="1.5"
      />
      <rect x="20" y="30" width="40" height="4" rx="2" fill={muted} opacity="0.3" />
      <rect x="20" y="38" width="48" height="4" rx="2" fill={muted} opacity="0.3" />
      <rect x="20" y="46" width="36" height="4" rx="2" fill={muted} opacity="0.3" />
      <circle cx="68" cy="24" r="10" fill={primary} opacity="0.15" />
      <text x="68" y="28" textAnchor="middle" fontSize="10">
        🔗
      </text>
      <text x="45" y="84" textAnchor="middle" fontSize="8" fill={muted}>
        Share
      </text>

      {/* Arrow */}
      <line
        x1="90"
        y1="45"
        x2="130"
        y2="45"
        stroke={primary}
        strokeWidth="1.5"
        strokeDasharray="4 2"
      />
      <polygon points="130,41 138,45 130,49" fill={primary} />

      {/* Step 2: Link */}
      <rect
        x="148"
        y="28"
        width="110"
        height="28"
        rx="6"
        fill={mutedBg}
        stroke={border}
        strokeWidth="1"
      />
      <text x="162" y="46" fontSize="8" fill={muted} fontFamily="monospace">
        doxmind.com/s/abc123
      </text>
      <rect x="232" y="34" width="18" height="16" rx="3" fill={primary} opacity="0.15" />
      <text x="241" y="46" textAnchor="middle" fontSize="8" fill={primary}>
        📋
      </text>
      <text x="203" y="72" textAnchor="middle" fontSize="8" fill={muted}>
        Copy link
      </text>

      {/* Arrow */}
      <line
        x1="268"
        y1="45"
        x2="298"
        y2="45"
        stroke={primary}
        strokeWidth="1.5"
        strokeDasharray="4 2"
      />
      <polygon points="298,41 306,45 298,49" fill={primary} />

      {/* Step 3: Viewer */}
      <rect
        x="314"
        y="16"
        width="56"
        height="58"
        rx="6"
        fill={bg}
        stroke={border}
        strokeWidth="1.5"
      />
      <rect x="322" y="26" width="36" height="5" rx="2.5" fill={fg} opacity="0.5" />
      <rect x="322" y="36" width="40" height="3" rx="1.5" fill={muted} opacity="0.3" />
      <rect x="322" y="42" width="36" height="3" rx="1.5" fill={muted} opacity="0.3" />
      <rect x="322" y="48" width="32" height="3" rx="1.5" fill={muted} opacity="0.3" />
      <circle cx="342" cy="62" r="6" fill={primary} opacity="0.1" />
      <text x="342" y="65" textAnchor="middle" fontSize="7" fill={primary}>
        👁
      </text>
      <text x="342" y="88" textAnchor="middle" fontSize="8" fill={muted}>
        Read-only
      </text>
    </svg>
  );
}
