# feat: Mindlines hover-to-expand enhancement

**Created:** 2026-01-14
**Category:** enhancement
**Priority:** high

---

## Overview

Transform the Mindlines component from a traditional document outline into an innovative hover-to-expand sidebar that provides a differentiated user experience. The component should display a compact structural overview when collapsed, and smoothly expand on hover to reveal full heading text.

**Current Problem:**
1. Mindlines looks and behaves like a traditional outline - no differentiation
2. Fixed width (`w-44` / 176px) doesn't optimize for space when not actively used
3. No hover interaction to expand/collapse for better space utilization

---

## Problem Statement / Motivation

The current Mindlines implementation at `src/components/editor/mindlines/mindlines.tsx` is functionally correct but visually indistinguishable from traditional document outlines. Users expect a more innovative, space-efficient navigation experience.

**User Pain Points:**
- Mindlines takes up horizontal space even when user isn't navigating
- Full heading text isn't always necessary - just need structural awareness
- No visual differentiation from standard table-of-contents implementations

---

## Proposed Solution

Implement a **hover-to-expand floating overlay** pattern inspired by Notion's sidebar:

### Collapsed State (Default)
- **Width:** 56px
- **Shows:** Visual hierarchy indicators only (●, ○, ◦ for H1, H2, H3)
- **Shows:** Active heading highlighted indicator
- **Shows:** Vertical connecting lines between levels

### Expanded State (On Hover/Focus)
- **Width:** 240px
- **Shows:** Full heading text with truncation
- **Animation:** Float over editor content as overlay
- **Transition:** 250ms ease-out expand, 200ms ease-in collapse

### Interaction Model
| Action | Result |
|--------|--------|
| Mouse enters sidebar | Expands after 150ms delay |
| Mouse leaves sidebar | Collapses after 250ms delay |
| Keyboard Tab into sidebar | Expands immediately |
| Keyboard Tab out of sidebar | Collapses immediately |
| Click heading | Navigate + collapse |
| Touch/tap on mobile | Toggle expansion state |

---

## Technical Approach

### Architecture: Floating Overlay Pattern

Use **absolute positioning** for expansion rather than width growth to avoid layout reflow:

```tsx
// Collapsed: fixed narrow strip
// Expanded: absolute overlay that floats over content
<aside
  className={cn(
    "absolute left-0 top-0 h-full z-30",
    "transition-all duration-250 ease-out",
    isExpanded ? "w-60 shadow-xl" : "w-14"
  )}
  style={{
    background: 'hsl(var(--background) / 0.95)',
    backdropFilter: 'blur(8px)'
  }}
/>
```

### File Changes Required

| File | Changes |
|------|---------|
| `src/components/editor/mindlines/mindlines.tsx` | Add hover state, two render modes (collapsed/expanded), transitions |
| `src/stores/layout-store.ts` | Optional: Add `mindlinesExpanded` persistent state |
| `src/app/globals.css` | Add mindlines-specific animations and reduced-motion support |

### Key Implementation Details

**1. Hover State Management**
```tsx
const [isExpanded, setIsExpanded] = useState(false);
const hoverTimerRef = useRef<NodeJS.Timeout>();

const handleMouseEnter = () => {
  hoverTimerRef.current = setTimeout(() => setIsExpanded(true), 150);
};

const handleMouseLeave = () => {
  clearTimeout(hoverTimerRef.current);
  setTimeout(() => setIsExpanded(false), 250);
};
```

**2. Collapsed State Visual (Structure Only)**
```tsx
// Collapsed view shows hierarchy with visual indicators
<div className="flex flex-col items-center gap-0.5 py-2">
  {headings.map((heading) => (
    <div
      key={heading.id}
      className={cn(
        "w-2 h-2 rounded-full",
        heading.level === 1 && "bg-foreground",
        heading.level === 2 && "bg-foreground/60",
        heading.level === 3 && "bg-foreground/30",
        heading.id === activeId && "ring-2 ring-primary"
      )}
      style={{ marginLeft: `${(heading.level - 1) * 6}px` }}
    />
  ))}
</div>
```

**3. Accessibility Support**
```tsx
<aside
  role="navigation"
  aria-label="Document outline"
  aria-expanded={isExpanded}
  className="focus-within:w-60" // Keyboard accessibility
/>
```

**4. Reduced Motion Support**
```css
@media (prefers-reduced-motion: reduce) {
  .mindlines {
    transition-duration: 50ms !important;
  }
}
```

---

## Acceptance Criteria

### Functional Requirements
- [ ] Collapsed state displays at 56px width with visual hierarchy indicators
- [ ] Hover over Mindlines expands to 240px after 150ms delay
- [ ] Mouse leave collapses after 250ms delay
- [ ] Clicking a heading navigates to it AND collapses the sidebar
- [ ] Active heading is visually indicated in BOTH states
- [ ] Connecting lines show visual hierarchy between levels

### Accessibility Requirements
- [ ] Keyboard focus (Tab) triggers expansion
- [ ] `aria-expanded` attribute reflects current state
- [ ] Reduced motion preference is respected
- [ ] Screen readers announce state changes

### Visual Requirements
- [ ] Expanded state has shadow (`shadow-xl`) for elevation
- [ ] Background uses backdrop blur for glass effect
- [ ] Smooth 250ms ease-out expand / 200ms ease-in collapse transitions
- [ ] Visual indicators use existing design tokens

### Edge Cases
- [ ] Empty document shows collapsed state with placeholder icon
- [ ] Very long headings truncate with tooltip in expanded state
- [ ] Many headings (20+) scroll within panel in expanded state
- [ ] Mobile/touch: tap to toggle expansion

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Space saved when collapsed | ~120px (from 176px to 56px) |
| Expand/collapse cycle time | < 500ms total |
| Animation jank | 0 dropped frames (60fps) |
| Accessibility score | No WCAG violations |

---

## Dependencies & Risks

### Dependencies
- None - uses existing Tailwind CSS and React patterns

### Risks
| Risk | Mitigation |
|------|------------|
| Hover conflict with tooltips | Use appropriate z-index (z-30 for sidebar, z-50 for tooltips) |
| Layout shift on expand | Use absolute positioning, not width growth |
| Touch device support | Implement tap-to-toggle fallback |
| Performance on low-end devices | Use transform/opacity for animations |

---

## Implementation Phases

### Phase 1: Core Hover Mechanics
1. Add hover state with debounced timers
2. Implement collapsed visual indicators
3. Add transition classes
4. Test basic expand/collapse

### Phase 2: Visual Polish
1. Add shadow and backdrop blur
2. Implement connecting lines
3. Style active heading in collapsed state
4. Add expansion direction indicator

### Phase 3: Accessibility
1. Add keyboard focus support
2. Implement ARIA attributes
3. Add reduced motion support
4. Test with screen reader

### Phase 4: Edge Cases
1. Handle empty document state
2. Implement touch/mobile support
3. Test with many headings (scrolling)
4. Verify panel interaction (Review, Chat)

---

## References & Research

### Internal References
- Current implementation: `src/components/editor/mindlines/mindlines.tsx:88-141`
- State management: `src/stores/layout-store.ts:7,25,36-37`
- Existing animation patterns: `src/app/globals.css:287-300` (bubble menu)
- Sidebar transitions: `src/app/page.tsx:27-34` (sidebar collapse)

### External References
- [Tailwind CSS Transitions](https://v3.tailwindcss.com/docs/transition-property)
- [Josh Comeau - CSS Transitions](https://www.joshwcomeau.com/animation/css-transitions/)
- [WCAG 2.1 Reduced Motion](https://www.w3.org/WAI/WCAG21/Techniques/css/C39)

### Design Inspiration
- Notion sidebar (floating overlay pattern)
- VS Code outline (hierarchy visualization)
- Obsidian outline (minimalist approach)

---

## Open Questions

> These questions were identified during planning. Default assumptions are provided.

1. **Should expansion state persist across sessions?**
   - Default: No, always start collapsed

2. **What happens when Review Panel is also open?**
   - Default: Both panels can coexist; editor may be narrow on small screens

3. **Should there be a "pin expanded" option?**
   - Default: Not in initial implementation; can add later if requested

---

## MVP Implementation

### mindlines.tsx (enhanced)

```tsx
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/stores/layout-store";
import { Tooltip } from "@/components/ui/tooltip";
import { List } from "lucide-react";

interface Heading {
  id: string;
  level: number;
  text: string;
  pos: number;
}

interface MindlinesProps {
  editor: Editor | null;
}

export function Mindlines({ editor }: MindlinesProps) {
  const { isMindlinesOpen } = useLayoutStore();
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const expandTimerRef = useRef<NodeJS.Timeout>();
  const collapseTimerRef = useRef<NodeJS.Timeout>();

  // ... existing useEffect hooks for headings extraction ...

  const handleMouseEnter = useCallback(() => {
    clearTimeout(collapseTimerRef.current);
    expandTimerRef.current = setTimeout(() => setIsExpanded(true), 150);
  }, []);

  const handleMouseLeave = useCallback(() => {
    clearTimeout(expandTimerRef.current);
    collapseTimerRef.current = setTimeout(() => setIsExpanded(false), 250);
  }, []);

  const handleClick = useCallback((heading: Heading) => {
    if (!editor) return;
    editor.chain().focus().setTextSelection(heading.pos).scrollIntoView().run();
    setIsExpanded(false); // Collapse after navigation
  }, [editor]);

  if (!isMindlinesOpen || !editor) return null;

  // Collapsed view: visual hierarchy indicators only
  const collapsedContent = (
    <div className="flex flex-col items-center gap-1 py-3 px-2">
      <List className="w-5 h-5 text-muted-foreground mb-2" />
      {headings.length === 0 ? (
        <span className="text-xs text-muted-foreground">+</span>
      ) : (
        headings.map((heading) => (
          <button
            key={heading.id}
            onClick={() => handleClick(heading)}
            className={cn(
              "w-2 h-2 rounded-full transition-all",
              heading.level === 1 && "bg-foreground",
              heading.level === 2 && "bg-foreground/60",
              heading.level === 3 && "bg-foreground/30",
              heading.id === activeId && "ring-2 ring-primary ring-offset-1"
            )}
            style={{ marginLeft: `${(heading.level - 1) * 6}px` }}
            aria-label={heading.text}
          />
        ))
      )}
    </div>
  );

  // Expanded view: full heading text
  const expandedContent = (
    <div className="py-2 px-1 flex flex-col">
      <div className="px-2 pb-2 mb-1 border-b border-border/50">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Outline
        </span>
      </div>
      {headings.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">
          Add headings to see outline
        </p>
      ) : (
        headings.map((heading) => {
          const isActive = heading.id === activeId;
          const indent = (heading.level - 1) * 12;
          const indicator = heading.level === 1 ? "●" : heading.level === 2 ? "○" : "◦";

          return (
            <Tooltip key={heading.id} content={heading.text} side="right">
              <button
                onClick={() => handleClick(heading)}
                className={cn(
                  "w-full text-left py-1.5 px-2 rounded text-sm transition-colors",
                  "hover:bg-accent/50 flex items-center gap-2",
                  isActive && "bg-accent/30 border-l-2 border-primary"
                )}
                style={{ paddingLeft: `${indent + 8}px` }}
              >
                <span className="text-muted-foreground shrink-0">{indicator}</span>
                <span className="truncate">{heading.text || "Untitled"}</span>
              </button>
            </Tooltip>
          );
        })
      )}
    </div>
  );

  return (
    <aside
      className={cn(
        // Base styles
        "relative z-30 shrink-0 border-r min-h-0 h-full",
        // Background with blur
        "bg-background/95 backdrop-blur-sm",
        // Transitions
        "transition-all duration-200 ease-out motion-reduce:transition-none",
        // Width based on state
        isExpanded ? "w-60 shadow-xl" : "w-14",
        // Overflow
        isExpanded ? "overflow-y-auto" : "overflow-hidden"
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      role="navigation"
      aria-label="Document outline"
      aria-expanded={isExpanded}
    >
      {isExpanded ? expandedContent : collapsedContent}
    </aside>
  );
}
```

---

*Generated with Claude Code - 2026-01-14*
