"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * The one menu geometry in the app. Notion's measured values (see
 * docs/BLOCK_UX_REFERENCE.md): a 28px row on a 6px radius with a 20ms
 * background transition, inside a 10px-radius panel padded 6px whose outermost
 * shadow layer is a hairline ring rather than a border.
 *
 * The block gutter's menu already hit these numbers by overriding every row it
 * rendered; they live here now so the more-actions dropdown, the sidebar
 * context menus and the block menu are one system instead of four. Callers that
 * still pass the same classes are simply agreeing with the default.
 *
 * The elevation is `--popover-shadow`, not a literal. The literal it replaces —
 * `0 20px 24px rgba(25,25,25,.05), 0 5px 8px rgba(25,25,25,.027), 0 0 0 1px
 * hsl(var(--border))` — is Notion's light-mode measurement, and it was used in
 * *both* themes: rgba(25,25,25,·) cannot darken a #212121 page, so a dark menu
 * had no drop shadow at all and was left leaning on a 1.44:1 ring. The token
 * pair in globals.css states an elevation per theme (black ink in dark) and
 * keeps the hairline ring as its own `--popover-ring`, so the two edges are
 * measured rather than inherited. See theme-contrast.test.ts.
 *
 * The `shadow:` type hint is load-bearing. Tailwind cannot tell what a bare
 * `var()` inside a `shadow-[…]` arbitrary value is, and guesses colour: without
 * the hint the class compiles to `--tw-shadow-color`, not `--tw-shadow`, and
 * paints no shadow at all. The hint forces the box-shadow branch.
 */
// `flex flex-col gap-px` is the 1px inter-row gap Notion measures
// (docs/BLOCK_UX_REFERENCE.md). Rows were plain siblings in a block container,
// so consecutive 6px-radius rows sat edge to edge and their hover fills touched
// — the pair read as one 57px pill rather than two rows.
//
// This was briefly backed out on the theory that it caused `menus.spec.ts`'s
// "a second press on Turn into" to measure the parent panel ~14px taller after
// the submenu opened, since fourteen rows of new gap is about that. The theory
// was wrong: the same assertion failed at 13.53px on a CI run with the gap
// removed. Whatever moves that panel on Linux is not this, and the magnitude
// agreeing was a coincidence. Restored.
export const MENU_PANEL_CLASS =
  "flex flex-col gap-px rounded-[10px] border-0 bg-popover p-1.5 text-popover-foreground shadow-[shadow:var(--popover-shadow)]";
// `min-h-7`, not `h-7`: a single-line row measures exactly 28px, and the few
// rows that carry two lines or a swatch (the workspace switcher's recents, the
// settings theme picker) still grow instead of clipping.
export const MENU_ROW_CLASS =
  "relative flex min-h-7 w-full cursor-pointer select-none items-center rounded-md px-2 text-sm outline-none transition-colors duration-[20ms] ease-in";
export const MENU_ICON_CLASS = "h-4 w-4";

interface DropdownMenuProps {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** When set, the dropdown positions at this point instead of the trigger element */
  anchorPoint?: { x: number; y: number } | null;
}

interface DropdownMenuTriggerProps {
  children: React.ReactNode;
  asChild?: boolean;
}

interface DropdownMenuContentProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: "start" | "center" | "end";
  side?: "bottom" | "top";
  sideOffset?: number;
}

interface DropdownMenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  inset?: boolean;
}

const DropdownMenuContext = React.createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  anchorPoint: { x: number; y: number } | null;
  focusedId: string | null;
  setFocusedId: (id: string | null) => void;
  itemIds: string[];
  registerItem: (id: string) => void;
  unregisterItem: (id: string) => void;
  hoverReady: boolean;
  hasOpenSub: boolean;
  /**
   * The same fact as `hasOpenSub`, readable during the commit that changed it.
   *
   * The state is a render behind: a sub-panel closed by Escape is out of the DOM one commit before
   * `hasOpenSub` reaches this panel, and gating the document listeners on the state left a window
   * where neither level answered the keyboard. Two Escapes 5ms apart — which is all a test, or a
   * fast user, needs — closed the sub-panel and then dropped the second press entirely.
   */
  hasOpenSubRef: React.RefObject<boolean>;
  setHasOpenSub: (open: boolean) => void;
}>({
  open: false,
  setOpen: () => {},
  triggerRef: { current: null },
  anchorPoint: null,
  focusedId: null,
  setFocusedId: () => {},
  itemIds: [],
  registerItem: () => {},
  unregisterItem: () => {},
  hoverReady: false,
  hasOpenSub: false,
  hasOpenSubRef: { current: false },
  setHasOpenSub: () => {},
});

export function DropdownMenu({
  children,
  open: controlledOpen,
  onOpenChange,
  anchorPoint: anchorPointProp,
}: DropdownMenuProps) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = React.useCallback(
    (value: boolean) => {
      if (!isControlled) setInternalOpen(value);
      onOpenChange?.(value);
    },
    [isControlled, onOpenChange]
  );
  const [focusedId, setFocusedId] = React.useState<string | null>(null);
  const [itemIds, setItemIds] = React.useState<string[]>([]);
  const [hoverReady, setHoverReady] = React.useState(false);
  const [hasOpenSub, setHasOpenSubState] = React.useState(false);
  const hasOpenSubRef = React.useRef(false);
  const setHasOpenSub = React.useCallback((value: boolean) => {
    hasOpenSubRef.current = value;
    setHasOpenSubState(value);
  }, []);
  const triggerRef = React.useRef<HTMLElement>(null);

  // Hand focus back to whatever had it when the menu opened. Nothing did: the focused row simply
  // unmounted and `document.activeElement` became BODY and stayed there — 5/5 trials on the block
  // gutter's menu after Escape, with typing dead until the user pressed Shift+Tab or clicked
  // something. (The gutter re-focuses its own grip on close, but that runs against a control the
  // row may have already unhovered away, so it did not save the keyboard either.) Restored only
  // when focus was actually orphaned, so a click that lands in another control keeps it;
  // `preventScroll` because an unguarded `focus()` on a Block off-screen scrolls the editor to it.
  const previouslyFocused = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (open) {
      previouslyFocused.current = document.activeElement as HTMLElement | null;
      return;
    }
    const previous = previouslyFocused.current;
    previouslyFocused.current = null;
    const orphaned = !document.activeElement || document.activeElement === document.body;
    if (orphaned) previous?.focus({ preventScroll: true });
  }, [open]);

  // Reset state when menu closes, enable hover after delay when opens
  React.useEffect(() => {
    if (!open) {
      setFocusedId(null);
      setItemIds([]);
      setHoverReady(false);
      setHasOpenSub(false);
    } else {
      // Delay hover effects to prevent accidental highlight on open
      const timer = setTimeout(() => {
        setHoverReady(true);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [open, setHasOpenSub]);

  const registerItem = React.useCallback((id: string) => {
    setItemIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const unregisterItem = React.useCallback((id: string) => {
    setItemIds((prev) => prev.filter((itemId) => itemId !== id));
  }, []);

  return (
    <DropdownMenuContext.Provider
      value={{
        open,
        setOpen,
        triggerRef,
        anchorPoint: anchorPointProp ?? null,
        focusedId,
        setFocusedId,
        itemIds,
        registerItem,
        unregisterItem,
        hoverReady,
        hasOpenSub,
        hasOpenSubRef,
        setHasOpenSub,
      }}
    >
      <div className="relative inline-block">{children}</div>
    </DropdownMenuContext.Provider>
  );
}

/**
 * The arrow/Home/End walk a `role="menu"` panel runs over its own rows.
 *
 * Shared by a panel and its sub-panels. A sub-panel is a second menu with its own rows and its own
 * roving ring, and it had no walk at all: the block gutter's eleven "Turn into" options could be
 * opened with ArrowRight and then not reached with anything.
 *
 * `itemIds` is a registration log, not a reading order: a menu that mounts extra rows while it is
 * open (the block gutter's filtered "Turn into" group) appends them after the rows they render
 * above, so arrow keys would walk the list in a different order than the eye. Read the live DOM
 * instead — it is the order the user sees. It is also the only place rows that are not
 * `DropdownMenuItem`s appear, since those never register.
 *
 * Disabled rows are left out of the walk: a disabled button cannot take DOM focus, so parking the
 * roving ring on one dropped focus out of the menu and cost the user a keypress that did nothing
 * visible — reaching Move down past a disabled Move up took two presses, not one.
 */
function useMenuArrowKeys({
  active,
  pausedRef,
  contentRef,
  focusedId,
  setFocusedId,
  itemIds,
}: {
  active: boolean;
  /** Read inside the handler, not in the dependency list — see `hasOpenSubRef`. */
  pausedRef?: React.RefObject<boolean>;
  contentRef: React.RefObject<HTMLDivElement | null>;
  focusedId: string | null;
  setFocusedId: (id: string | null) => void;
  itemIds: string[];
}) {
  React.useEffect(() => {
    if (!active) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (pausedRef?.current) return;
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;

      const domIds = Array.from(
        contentRef.current?.querySelectorAll<HTMLElement>(
          '[data-dropdown-item]:not([aria-disabled="true"])'
        ) ?? [],
        (node) => node.dataset.dropdownItem ?? ""
      ).filter(Boolean);
      const ids = domIds.length > 0 ? domIds : itemIds;
      if (ids.length === 0) return;

      const currentIndex = focusedId ? ids.indexOf(focusedId) : -1;

      e.preventDefault();
      switch (e.key) {
        case "ArrowDown":
          setFocusedId(currentIndex < ids.length - 1 ? ids[currentIndex + 1] : ids[0]);
          break;
        case "ArrowUp":
          setFocusedId(currentIndex > 0 ? ids[currentIndex - 1] : ids[ids.length - 1]);
          break;
        case "Home":
          setFocusedId(ids[0]);
          break;
        case "End":
          setFocusedId(ids[ids.length - 1]);
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [active, pausedRef, contentRef, focusedId, setFocusedId, itemIds]);
}

export function DropdownMenuTrigger({ children, asChild }: DropdownMenuTriggerProps) {
  const { open, setOpen, triggerRef } = React.useContext(DropdownMenuContext);

  const handleClick = () => setOpen(!open);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
    }
  };

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(
      children as React.ReactElement<{
        onClick?: () => void;
        onKeyDown?: (e: React.KeyboardEvent) => void;
        ref?: React.Ref<HTMLElement>;
        "aria-expanded"?: boolean;
        "aria-haspopup"?: boolean;
      }>,
      {
        onClick: handleClick,
        onKeyDown: handleKeyDown,
        ref: triggerRef as React.RefObject<HTMLElement>,
        "aria-expanded": open,
        "aria-haspopup": true,
      }
    );
  }

  return (
    <button
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      ref={triggerRef as React.RefObject<HTMLButtonElement>}
      aria-expanded={open}
      aria-haspopup={true}
    >
      {children}
    </button>
  );
}

export function DropdownMenuContent({
  children,
  className,
  align = "center",
  side = "bottom",
  sideOffset = 4,
  ...props
}: DropdownMenuContentProps) {
  const {
    open,
    setOpen,
    triggerRef,
    anchorPoint,
    focusedId,
    setFocusedId,
    itemIds,
    hoverReady,
    hasOpenSubRef,
  } = React.useContext(DropdownMenuContext);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{
    top: number | "auto";
    bottom: number | "auto";
    left: number;
  } | null>(null);

  // Calculate position from anchor point (right-click) or trigger element.
  // Initial pass uses the requested `side`; a second useLayoutEffect below
  // measures the actual content and flips to the opposite side when the
  // content would clip outside the viewport.
  React.useEffect(() => {
    if (!open) return;

    if (anchorPoint) {
      setPos({ top: anchorPoint.y, bottom: "auto", left: anchorPoint.x });
      return;
    }

    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    let left: number;
    if (align === "end") {
      left = rect.right;
    } else if (align === "start") {
      left = rect.left;
    } else {
      left = rect.left + rect.width / 2;
    }
    if (side === "top") {
      const bottomFromViewport = window.innerHeight - rect.top + sideOffset;
      setPos({ top: "auto", bottom: bottomFromViewport, left });
    } else {
      setPos({ top: rect.bottom + sideOffset, bottom: "auto", left });
    }
  }, [open, triggerRef, anchorPoint, align, side, sideOffset]);

  // Auto-flip and fit: measure the panel's actual height, flip to the opposite side if the
  // requested one would overflow the viewport, and keep the box inside the viewport when neither
  // side can hold it. Runs as a layout effect so the corrected position is applied before paint —
  // no visible flicker from the initial placement. Skipped for anchor-point (right-click) menus
  // where the caller has already chosen y.
  //
  // No dependency list: a menu can change height while it is open, and the height is only knowable
  // after the commit that changed it. The block gutter's "Turn into" grows this panel from 270.5px
  // to 396.0px in a single frame, and a placement measured once at open left 18 of 38 openings at
  // 1440x520 (5 of 40 at 1440x900) with 1-5 rows past the viewport edge — unreachable by pointer,
  // and unscrollable, because the panel's own max-height (448px) was never what clipped them. The
  // pass costs one forced layout per commit of an open menu and derives the placement from the
  // trigger each time rather than nudging the last one, so the panel returns to the trigger when
  // the content shrinks back.
  React.useLayoutEffect(() => {
    if (!open || !pos || anchorPoint) return;
    if (!contentRef.current || !triggerRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const contentH = contentRef.current.offsetHeight;
    const viewportH = window.innerHeight;
    const margin = 8; // breathing room from viewport edge

    const belowTop = triggerRect.bottom + sideOffset;
    const aboveTop = triggerRect.top - sideOffset - contentH;
    const fitsBelow = belowTop + contentH + margin <= viewportH;
    const fitsAbove = aboveTop - margin >= 0;

    // Only flip if the opposite side actually has more room — otherwise we'd just clip on the
    // other end.
    let top = side === "top" ? aboveTop : belowTop;
    if (side !== "top" && !fitsBelow) {
      if (fitsAbove || triggerRect.top > viewportH - triggerRect.bottom) top = aboveTop;
    } else if (side === "top" && !fitsAbove) {
      if (fitsBelow || viewportH - triggerRect.bottom > triggerRect.top) top = belowTop;
    }
    top = Math.min(Math.max(top, margin), Math.max(margin, viewportH - contentH - margin));

    const currentTop =
      typeof pos.top === "number" ? pos.top : viewportH - (pos.bottom as number) - contentH;
    if (Math.abs(currentTop - top) < 0.5) return;
    setPos({ top, bottom: "auto", left: pos.left });
  });

  // Answer the pointer that was already inside the panel when the 100ms hover gate lifted. The
  // gate is deliberate (see `hoverReady`), but nothing armed the row underneath once it opened:
  // `mouseenter` had already fired and is edge-triggered, so that row stayed unhighlighted for the
  // life of the menu — a pointer that glided onto "Copy Markdown" inside the gate and stopped read
  // rgba(0,0,0,0) 5/5 at +400ms, and 5/5 again after a 1px jiggle. `:hover` is the browser's own
  // level-triggered state, so it answers under a pointer that has not moved and needs no
  // coordinates to ask for.
  React.useEffect(() => {
    if (!open || !hoverReady) return;
    const hovered = contentRef.current?.querySelector<HTMLElement>("[data-dropdown-item]:hover");
    if (hovered?.dataset.dropdownItem) setFocusedId(hovered.dataset.dropdownItem);
  }, [open, hoverReady, setFocusedId]);

  // Handle click outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (contentRef.current && !contentRef.current.contains(event.target as Node)) {
        // Don't close if click is inside a portalled sub-menu
        if ((event.target as Element).closest?.("[data-dropdown-sub-content]")) {
          return;
        }
        setOpen(false);
      }
    };

    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open, setOpen]);

  // An open sub-panel owns the keyboard: it walks its own rows, and it answers Escape by closing
  // only itself. Stepping into "Turn into" and changing your mind must cost one level, not the
  // whole menu.
  useMenuArrowKeys({
    active: open,
    pausedRef: hasOpenSubRef,
    contentRef,
    focusedId,
    setFocusedId,
    itemIds,
  });

  // Escape is answered without reading the rows at all, so a menu whose every row is unavailable
  // can still be dismissed.
  React.useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (hasOpenSubRef.current || e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, hasOpenSubRef, setOpen]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      ref={contentRef}
      role="menu"
      aria-orientation="vertical"
      data-dropdown-portal=""
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        "fixed z-50 min-w-[8rem] overflow-hidden",
        MENU_PANEL_CLASS,
        "animate-in fade-in-0 zoom-in-95",
        "max-h-[65vh] overflow-y-auto",
        className
      )}
      style={{
        ...(pos.top !== "auto" ? { top: pos.top } : {}),
        ...(pos.bottom !== "auto" ? { bottom: pos.bottom } : {}),
        ...(anchorPoint
          ? { left: pos.left }
          : align === "end"
            ? { right: window.innerWidth - pos.left }
            : align === "start"
              ? { left: pos.left }
              : { left: pos.left, transform: "translateX(-50%)" }),
      }}
      {...props}
    >
      {children}
    </div>,
    document.body
  );
}

export function DropdownMenuItem({
  children,
  className,
  inset,
  disabled,
  onClick,
  ...props
}: DropdownMenuItemProps) {
  const { setOpen, focusedId, setFocusedId, registerItem, unregisterItem, hoverReady, hasOpenSub } =
    React.useContext(DropdownMenuContext);
  const itemId = React.useId();
  const itemRef = React.useRef<HTMLButtonElement>(null);

  // Register item on mount
  React.useEffect(() => {
    registerItem(itemId);
    return () => unregisterItem(itemId);
  }, [itemId, registerItem, unregisterItem]);

  // Focus when this item is focused via keyboard
  const isFocused = focusedId === itemId;
  React.useEffect(() => {
    if (isFocused && itemRef.current) {
      itemRef.current.focus();
    }
  }, [isFocused]);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    onClick?.(e);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!disabled) {
        onClick?.(e as unknown as React.MouseEvent<HTMLButtonElement>);
        setOpen(false);
      }
    }
  };

  // `pointermove`, not `mouseenter`: `mouseenter` fires once on the way in, so a row the pointer
  // was already resting on when the 100ms hover gate lifted never got a second chance and stayed
  // dead for the life of the menu — 0/5 rows recovered on a 1px jiggle, and none on a 30px move
  // inside the same row, while crossing into a different row always did. `pointermove` is
  // level-triggered, so the first movement heals it. Re-setting the id the row already holds is a
  // React bail-out, so the extra events cost no render.
  const handlePointerMove = () => {
    if (hoverReady && !hasOpenSub) {
      setFocusedId(itemId);
    }
  };

  const handleMouseLeave = () => {
    if (hoverReady && !hasOpenSub) {
      setFocusedId(null);
    }
  };

  return (
    <button
      ref={itemRef}
      role="menuitem"
      data-dropdown-item={itemId}
      tabIndex={isFocused ? 0 : -1}
      className={cn(
        MENU_ROW_CLASS,
        // One highlight per menu: `accent` is the fill the slash panel and the block gutter's own
        // "Turn into" row already use, so a panel that mixes shared items with a caller's own rows
        // paints them the same colour. It was the neutral sidebar-hover gray, which is a cooler,
        // blue-leaning tone and split the block actions menu into two hues down one 265px panel.
        // `cursor-pointer` for the same reason — the custom rows are pointer, these were default.
        isFocused && "bg-accent text-accent-foreground",
        "focus-visible:ring-1 focus-visible:ring-ring",
        disabled && "pointer-events-none opacity-50",
        inset && "pl-8",
        className
      )}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onPointerMove={handlePointerMove}
      onMouseLeave={handleMouseLeave}
      disabled={disabled}
      aria-disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * Joins a row a menu renders for itself — a raw `<button role="menuitem">` whose click navigates
 * inside the open menu instead of closing it — to the same roving focus ring `DropdownMenuItem`
 * uses. Without the `data-dropdown-item` marker and the focus effect, `DropdownMenuContent`'s
 * arrow-key walk reads straight past the row and a keyboard user can never reach it.
 *
 * Must be called from a component rendered inside `DropdownMenuContent`, not from the component
 * that renders the `DropdownMenu` itself — the shared focus lives in the menu's context.
 */
export function useDropdownMenuItemFocus(itemId: string) {
  const { focusedId } = React.useContext(DropdownMenuContext);
  const ref = React.useRef<HTMLButtonElement>(null);
  const isFocused = focusedId === itemId;

  React.useEffect(() => {
    if (isFocused) ref.current?.focus();
  }, [isFocused]);

  return {
    ref,
    "data-dropdown-item": itemId,
    tabIndex: isFocused ? 0 : -1,
  } as const;
}

export function DropdownMenuSeparator() {
  // -mx-1.5 matches MENU_PANEL_CLASS's 6px padding so the rule spans the panel.
  return <div role="separator" className="-mx-1.5 my-1 h-px bg-muted" />;
}

export function DropdownMenuLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("px-2 py-1.5 text-sm font-semibold", className)}>{children}</div>;
}

// SubMenu context
const DropdownMenuSubContext = React.createContext<{
  open: boolean;
  /** The trigger row's roving-ring id, owned here so a close path can hand the ring back to it. */
  triggerItemId: string;
  openSub: () => void;
  closeSub: () => void;
  closeSubToTrigger: () => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  cancelClose: () => void;
  startClose: () => void;
}>({
  open: false,
  triggerItemId: "",
  openSub: () => {},
  closeSub: () => {},
  closeSubToTrigger: () => {},
  triggerRef: { current: null },
  cancelClose: () => {},
  startClose: () => {},
});

export function DropdownMenuSub({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const { setHasOpenSub, setFocusedId } = React.useContext(DropdownMenuContext);
  const triggerRef = React.useRef<HTMLElement>(null);
  const triggerItemId = React.useId();
  const openTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const closeTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const cancelOpen = React.useCallback(() => {
    if (openTimeoutRef.current) {
      clearTimeout(openTimeoutRef.current);
      openTimeoutRef.current = null;
    }
  }, []);

  const cancelClose = React.useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const openSub = React.useCallback(() => {
    cancelClose();
    setOpen(true);
  }, [cancelClose]);

  // Every close cancels the pending hover-open first. It is armed by `mouseenter` and the pointer
  // that arms it is usually the same pointer that then *clicks* the row, so a press followed within
  // 150ms by Escape left a timer in flight that reopened the panel behind the user: measured on the
  // block gutter, Escape left it closed at +0ms and +60ms and open again at +260ms, and the next
  // press went to a menu they had already dismissed.
  //
  // The two closes want different things from the parent's roving ring, though. A pointer that
  // wandered off drops the ring entirely, so the row it wandered onto can take the highlight.
  // Escape and ArrowLeft put the ring — and DOM focus — back on the trigger row instead: without
  // that, focus is left on a row that is about to unmount, `document.activeElement` falls to BODY,
  // and the next ArrowDown resumes at the top of the menu rather than below the row the user
  // stepped in from.
  const closeSub = React.useCallback(() => {
    cancelOpen();
    setOpen(false);
    setFocusedId(null);
  }, [cancelOpen, setFocusedId]);

  const closeSubToTrigger = React.useCallback(() => {
    cancelOpen();
    setOpen(false);
    setFocusedId(triggerItemId);
    triggerRef.current?.focus({ preventScroll: true });
  }, [cancelOpen, setFocusedId, triggerItemId]);

  // Exposed to the portalled sub-content, which is not a DOM descendant of the wrapper below and so
  // leaves it the moment the pointer travels into the panel it opened.
  const startClose = React.useCallback(() => {
    closeTimeoutRef.current = setTimeout(closeSub, 100);
  }, [closeSub]);

  const handleMouseEnter = () => {
    cancelClose();
    // 150ms before opening, so a pointer crossing this row on its way to another one does not drag
    // a second panel across the menu behind it.
    openTimeoutRef.current = setTimeout(openSub, 150);
  };

  const handleMouseLeave = () => {
    cancelOpen();
    startClose();
  };

  // Tell the parent panel to stand down while this one is open: it stops walking its own rows,
  // stops answering Escape, and stops letting `pointermove` move its highlight. Cleared on unmount
  // too, not just on close — the block gutter replaces its whole navigation half the moment a query
  // is typed, so the row this panel hangs off can vanish while the panel is still open, and a parent
  // left believing a level was still there answered nothing at all.
  React.useEffect(() => {
    if (!open) return;
    setHasOpenSub(true);
    return () => setHasOpenSub(false);
  }, [open, setHasOpenSub]);

  // Cleanup timeouts on unmount
  React.useEffect(() => {
    return () => {
      if (openTimeoutRef.current) clearTimeout(openTimeoutRef.current);
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  const value = React.useMemo(
    () => ({
      open,
      triggerItemId,
      openSub,
      closeSub,
      closeSubToTrigger,
      triggerRef,
      cancelClose,
      startClose,
    }),
    [open, triggerItemId, openSub, closeSub, closeSubToTrigger, cancelClose, startClose]
  );

  return (
    <DropdownMenuSubContext.Provider value={value}>
      <div className="relative" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
        {children}
      </div>
    </DropdownMenuSubContext.Provider>
  );
}

export function DropdownMenuSubTrigger({
  children,
  className,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const { open, openSub, triggerRef, triggerItemId } = React.useContext(DropdownMenuSubContext);
  const { hoverReady, focusedId, setFocusedId, registerItem, unregisterItem } =
    React.useContext(DropdownMenuContext);
  const isFocused = focusedId === triggerItemId;

  // Register item on mount
  React.useEffect(() => {
    registerItem(triggerItemId);
    return () => unregisterItem(triggerItemId);
  }, [triggerItemId, registerItem, unregisterItem]);

  // Lock focus on this trigger when sub-menu opens
  React.useEffect(() => {
    if (open) {
      setFocusedId(triggerItemId);
    }
  }, [open, triggerItemId, setFocusedId]);

  // Take DOM focus when the roving ring lands here, exactly as `DropdownMenuItem` does. Without it
  // the row painted as focused while the keystroke still went wherever the browser had left focus —
  // so ArrowRight, the one gesture that opens this panel from the keyboard, never reached the
  // button that answers it.
  React.useEffect(() => {
    if (isFocused) triggerRef.current?.focus();
  }, [isFocused, triggerRef]);

  const handleClick = (e: React.MouseEvent) => {
    onClick?.(e);
    // Opens, never toggles. A second press at the same unmoved point is the gesture this whole
    // side-opening arrangement exists to make harmless; closing on it would put a different row
    // back under a stationary pointer for the third one.
    openSub();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "Enter") {
      e.preventDefault();
      openSub();
    }
  };

  const handleMouseEnter = () => {
    if (hoverReady) {
      setFocusedId(triggerItemId);
    }
  };

  const handleMouseLeave = () => {
    if (hoverReady && !open) {
      setFocusedId(null);
    }
  };

  return (
    <button
      ref={triggerRef as React.RefObject<HTMLButtonElement>}
      role="menuitem"
      data-dropdown-item={triggerItemId}
      aria-haspopup="menu"
      aria-expanded={open}
      tabIndex={isFocused ? 0 : -1}
      className={cn(
        MENU_ROW_CLASS,
        (isFocused || open) && "bg-accent text-accent-foreground",
        "focus-visible:ring-1 focus-visible:ring-ring",
        className
      )}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      <svg
        className="ml-auto h-4 w-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

export function DropdownMenuSubContent({
  children,
  className,
  side = "auto",
  "aria-label": ariaLabel,
}: {
  children: React.ReactNode;
  className?: string;
  side?: "auto" | "left" | "right";
  /** Names the second `role="menu"` after the row it opened from, which is all that distinguishes
   *  the two panels to assistive tech — and to a test looking for one of them. */
  "aria-label"?: string;
}) {
  const { open, closeSubToTrigger, triggerRef, cancelClose, startClose } =
    React.useContext(DropdownMenuSubContext);
  const parentCtx = React.useContext(DropdownMenuContext);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  const [isPositionReady, setIsPositionReady] = React.useState(false);

  // Independent hover state for sub-menu items
  const [subFocusedId, setSubFocusedId] = React.useState<string | null>(null);
  const [subItemIds, setSubItemIds] = React.useState<string[]>([]);
  const [subHasOpenSub, setSubHasOpenSubState] = React.useState(false);
  const subHasOpenSubRef = React.useRef(false);
  const setSubHasOpenSub = React.useCallback((value: boolean) => {
    subHasOpenSubRef.current = value;
    setSubHasOpenSubState(value);
  }, []);

  const registerItem = React.useCallback((id: string) => {
    setSubItemIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);
  const unregisterItem = React.useCallback((id: string) => {
    setSubItemIds((prev) => prev.filter((i) => i !== id));
  }, []);

  // Reset focused item when sub-menu closes
  React.useEffect(() => {
    if (!open) setSubFocusedId(null);
  }, [open]);

  // Hide submenu until final position is calculated to avoid side-flip flicker
  React.useEffect(() => {
    if (open) {
      setIsPositionReady(false);
    }
  }, [open]);

  const subCtxValue = React.useMemo(
    () => ({
      open: parentCtx.open,
      setOpen: parentCtx.setOpen,
      triggerRef: parentCtx.triggerRef,
      anchorPoint: null,
      focusedId: subFocusedId,
      setFocusedId: setSubFocusedId,
      itemIds: subItemIds,
      registerItem,
      unregisterItem,
      hoverReady: true,
      hasOpenSub: subHasOpenSub,
      hasOpenSubRef: subHasOpenSubRef,
      setHasOpenSub: setSubHasOpenSub,
    }),
    [
      parentCtx.open,
      parentCtx.setOpen,
      parentCtx.triggerRef,
      subFocusedId,
      subItemIds,
      registerItem,
      unregisterItem,
      subHasOpenSub,
      setSubHasOpenSub,
    ]
  );

  const contentRef = React.useRef<HTMLDivElement>(null);

  // Calculate position from trigger element, then adjust after render
  React.useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();

    // Find the parent dropdown portal to position relative to it
    const parentPortal = triggerRef.current.closest?.("[data-dropdown-portal]");
    const parentRect = parentPortal?.getBoundingClientRect();

    let left: number;
    const top = rect.top;

    if (parentRect) {
      left = side === "right" ? parentRect.right + 4 : parentRect.left - 4;
    } else {
      left = side === "left" ? rect.left - 4 : rect.right + 4;
    }

    setPos({ top, left });
  }, [open, triggerRef, side]);

  // Adjust position after render using actual dimensions
  React.useEffect(() => {
    if (!pos || !contentRef.current || !triggerRef.current) return;
    const el = contentRef.current;
    const elRect = el.getBoundingClientRect();
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const parentPortal = triggerRef.current.closest?.("[data-dropdown-portal]");
    const parentRect = parentPortal?.getBoundingClientRect();

    let left = pos.left;
    let top = pos.top;

    if (parentRect) {
      if (side === "right") {
        left = parentRect.right + 4;
      } else if (side === "left") {
        left = parentRect.left - elRect.width - 4;
      } else {
        // Auto mode: prefer left, fallback to right when needed
        left = parentRect.left - elRect.width - 4;
        if (left < 8) {
          left = parentRect.right + 4;
        }
      }
    } else {
      if (side === "left") {
        left = triggerRect.left - elRect.width - 4;
      } else if (side === "right") {
        left = triggerRect.right + 4;
      } else {
        // Auto mode: prefer right, fallback to left when needed
        if (left + elRect.width > window.innerWidth - 8) {
          left = triggerRect.left - elRect.width - 4;
        }
      }
    }

    // Vertical: if overflows bottom, shift up
    if (top + elRect.height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - elRect.height - 8);
    }

    if (top !== pos.top || left !== pos.left) {
      setPos({ top, left });
      return;
    }

    setIsPositionReady(true);
  }, [pos, triggerRef, side]);

  // This panel's own rows. The walk cannot come from `DropdownMenuContent`, which is not in the tree
  // here — without it a sub-panel opened with ArrowRight could not be moved through at all.
  useMenuArrowKeys({
    active: open,
    pausedRef: subHasOpenSubRef,
    contentRef,
    focusedId: subFocusedId,
    setFocusedId: setSubFocusedId,
    itemIds: subItemIds,
  });

  // Escape and ArrowLeft step back out to the row this panel belongs to, and stop there: the parent
  // panel stands down while a sub-panel is open, so one press closes one level.
  React.useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (subHasOpenSubRef.current) return;
      if (e.key !== "Escape" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      e.stopPropagation();
      closeSubToTrigger();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, closeSubToTrigger]);

  if (!open || !pos) return null;

  return createPortal(
    <DropdownMenuContext.Provider value={subCtxValue}>
      <div
        ref={contentRef}
        data-dropdown-sub-content
        data-dropdown-portal=""
        role="menu"
        aria-label={ariaLabel}
        aria-orientation="vertical"
        onMouseDown={(e) => e.preventDefault()}
        onMouseEnter={cancelClose}
        onMouseLeave={startClose}
        className={cn(
          "fixed z-50 min-w-[8rem] overflow-hidden",
          MENU_PANEL_CLASS,
          "animate-in fade-in-0 zoom-in-95",
          "max-h-[65vh] overflow-y-auto",
          className
        )}
        style={{ top: pos.top, left: pos.left, visibility: isPositionReady ? "visible" : "hidden" }}
      >
        {children}
      </div>
    </DropdownMenuContext.Provider>,
    document.body
  );
}
