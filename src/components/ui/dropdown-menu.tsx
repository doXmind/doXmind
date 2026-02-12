"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface DropdownMenuProps {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
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
  focusedId: string | null;
  setFocusedId: (id: string | null) => void;
  itemIds: string[];
  registerItem: (id: string) => void;
  unregisterItem: (id: string) => void;
  hoverReady: boolean;
  hasOpenSub: boolean;
  setHasOpenSub: (open: boolean) => void;
}>({
  open: false,
  setOpen: () => {},
  triggerRef: { current: null },
  focusedId: null,
  setFocusedId: () => {},
  itemIds: [],
  registerItem: () => {},
  unregisterItem: () => {},
  hoverReady: false,
  hasOpenSub: false,
  setHasOpenSub: () => {},
});

export function DropdownMenu({ children, open: controlledOpen, onOpenChange }: DropdownMenuProps) {
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
  const [hasOpenSub, setHasOpenSub] = React.useState(false);
  const triggerRef = React.useRef<HTMLElement>(null);

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
  }, [open]);

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
        focusedId,
        setFocusedId,
        itemIds,
        registerItem,
        unregisterItem,
        hoverReady,
        hasOpenSub,
        setHasOpenSub,
      }}
    >
      <div className="relative inline-block">{children}</div>
    </DropdownMenuContext.Provider>
  );
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
  const { open, setOpen, triggerRef, focusedId, setFocusedId, itemIds } =
    React.useContext(DropdownMenuContext);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{
    top: number | "auto";
    bottom: number | "auto";
    left: number;
  } | null>(null);

  // Calculate position from trigger element
  React.useEffect(() => {
    if (!open || !triggerRef.current) return;
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
  }, [open, triggerRef, align, side, sideOffset]);

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

  // Handle keyboard navigation
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open || itemIds.length === 0) return;

      const currentIndex = focusedId ? itemIds.indexOf(focusedId) : -1;

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          setOpen(false);
          break;
        case "ArrowDown":
          e.preventDefault();
          if (currentIndex < itemIds.length - 1) {
            setFocusedId(itemIds[currentIndex + 1]);
          } else {
            setFocusedId(itemIds[0]);
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          if (currentIndex > 0) {
            setFocusedId(itemIds[currentIndex - 1]);
          } else {
            setFocusedId(itemIds[itemIds.length - 1]);
          }
          break;
        case "Home":
          e.preventDefault();
          setFocusedId(itemIds[0]);
          break;
        case "End":
          e.preventDefault();
          setFocusedId(itemIds[itemIds.length - 1]);
          break;
      }
    };

    if (open) {
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, setOpen, setFocusedId, focusedId, itemIds]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      ref={contentRef}
      role="menu"
      aria-orientation="vertical"
      data-dropdown-portal=""
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        "fixed z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
        "animate-in fade-in-0 zoom-in-95",
        "max-h-[300px] overflow-y-auto",
        className
      )}
      style={{
        ...(pos.top !== "auto" ? { top: pos.top } : {}),
        ...(pos.bottom !== "auto" ? { bottom: pos.bottom } : {}),
        ...(align === "end"
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

  const handleMouseEnter = () => {
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
      tabIndex={isFocused ? 0 : -1}
      className={cn(
        "relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors",
        isFocused && "bg-accent text-accent-foreground",
        "focus-visible:ring-1 focus-visible:ring-ring",
        disabled && "pointer-events-none opacity-50",
        inset && "pl-8",
        className
      )}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      disabled={disabled}
      aria-disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}

export function DropdownMenuSeparator() {
  return <div role="separator" className="-mx-1 my-1 h-px bg-muted" />;
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
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  cancelClose: () => void;
  startClose: () => void;
}>({
  open: false,
  setOpen: () => {},
  triggerRef: { current: null },
  cancelClose: () => {},
  startClose: () => {},
});

export function DropdownMenuSub({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const { setHasOpenSub, setFocusedId } = React.useContext(DropdownMenuContext);
  const triggerRef = React.useRef<HTMLElement>(null);
  const openTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const closeTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    // Clear any pending close timeout
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    // Add 150ms delay before opening to prevent accidental triggers
    openTimeoutRef.current = setTimeout(() => {
      setOpen(true);
    }, 150);
  };

  const handleMouseLeave = () => {
    // Clear any pending open timeout
    if (openTimeoutRef.current) {
      clearTimeout(openTimeoutRef.current);
      openTimeoutRef.current = null;
    }
    // Add small delay before closing
    closeTimeoutRef.current = setTimeout(() => {
      setOpen(false);
    }, 100);
  };

  // Expose timeout controls for portalled sub-content
  const cancelClose = React.useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const startClose = React.useCallback(() => {
    closeTimeoutRef.current = setTimeout(() => {
      setOpen(false);
    }, 100);
  }, []);

  // Notify parent context when sub-menu opens/closes
  React.useEffect(() => {
    setHasOpenSub(open);
    if (!open) {
      // When sub closes, clear any locked focusedId so hover works again
      setFocusedId(null);
    }
  }, [open, setHasOpenSub, setFocusedId]);

  // Cleanup timeouts on unmount
  React.useEffect(() => {
    return () => {
      if (openTimeoutRef.current) clearTimeout(openTimeoutRef.current);
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  return (
    <DropdownMenuSubContext.Provider value={{ open, setOpen, triggerRef, cancelClose, startClose }}>
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
  const { open, setOpen, triggerRef } = React.useContext(DropdownMenuSubContext);
  const { hoverReady, focusedId, setFocusedId, registerItem, unregisterItem } =
    React.useContext(DropdownMenuContext);
  const itemId = React.useId();
  const isFocused = focusedId === itemId;

  // Register item on mount
  React.useEffect(() => {
    registerItem(itemId);
    return () => unregisterItem(itemId);
  }, [itemId, registerItem, unregisterItem]);

  // Lock focus on this trigger when sub-menu opens
  React.useEffect(() => {
    if (open) {
      setFocusedId(itemId);
    }
  }, [open, itemId, setFocusedId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "Enter") {
      e.preventDefault();
      setOpen(true);
    }
  };

  const handleMouseEnter = () => {
    if (hoverReady) {
      setFocusedId(itemId);
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
      aria-haspopup="menu"
      aria-expanded={open}
      className={cn(
        "relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors",
        (isFocused || open) && "bg-accent text-accent-foreground",
        "focus-visible:ring-1 focus-visible:ring-ring",
        className
      )}
      onClick={onClick}
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
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { open, setOpen, triggerRef, cancelClose, startClose } =
    React.useContext(DropdownMenuSubContext);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);

  // Calculate position from trigger element
  React.useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const subMenuWidth = 200; // approximate width for viewport check

    let left = rect.right + 4;
    let top = rect.top;

    // If sub-menu would overflow right edge, show on left side
    if (left + subMenuWidth > window.innerWidth) {
      left = rect.left - subMenuWidth - 4;
    }

    // If sub-menu would overflow bottom edge, shift up
    const maxHeight = 300;
    if (top + maxHeight > window.innerHeight) {
      top = Math.max(8, window.innerHeight - maxHeight - 8);
    }

    setPos({ top, left });
  }, [open, triggerRef]);

  // Handle Escape key to close submenu
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (open && (e.key === "Escape" || e.key === "ArrowLeft")) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };

    if (open) {
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, setOpen]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      data-dropdown-sub-content
      data-dropdown-portal=""
      role="menu"
      aria-orientation="vertical"
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={cancelClose}
      onMouseLeave={startClose}
      className={cn(
        "fixed z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
        "animate-in fade-in-0 zoom-in-95",
        "max-h-[300px] overflow-y-auto",
        className
      )}
      style={{ top: pos.top, left: pos.left }}
    >
      {children}
    </div>,
    document.body
  );
}
