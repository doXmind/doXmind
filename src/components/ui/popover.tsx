"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { MENU_PANEL_CLASS } from "@/components/ui/dropdown-menu";

interface PopoverContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLElement | null>;
}

const PopoverContext = React.createContext<PopoverContextValue>({
  open: false,
  setOpen: () => {},
  triggerRef: { current: null },
});

interface PopoverProps {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Popover({ children, open: controlledOpen, onOpenChange }: PopoverProps) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLElement>(null);

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;

  const setOpen = React.useCallback(
    (newOpen: boolean) => {
      if (!isControlled) {
        setInternalOpen(newOpen);
      }
      onOpenChange?.(newOpen);
    },
    [isControlled, onOpenChange]
  );

  return (
    <PopoverContext.Provider value={{ open, setOpen, triggerRef }}>
      <div className="relative">{children}</div>
    </PopoverContext.Provider>
  );
}

interface PopoverTriggerProps {
  children: React.ReactNode;
  asChild?: boolean;
}

export function PopoverTrigger({ children, asChild }: PopoverTriggerProps) {
  const { open, setOpen, triggerRef } = React.useContext(PopoverContext);

  const handleClick = () => setOpen(!open);

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(
      children as React.ReactElement<{
        onClick?: () => void;
        ref?: React.Ref<HTMLElement>;
        "aria-expanded"?: boolean;
        "aria-haspopup"?: boolean;
      }>,
      {
        onClick: handleClick,
        ref: triggerRef as React.RefObject<HTMLElement>,
        "aria-expanded": open,
        "aria-haspopup": true,
      }
    );
  }

  return (
    <button
      onClick={handleClick}
      ref={triggerRef as React.RefObject<HTMLButtonElement>}
      aria-expanded={open}
      aria-haspopup={true}
    >
      {children}
    </button>
  );
}

interface PopoverContentProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: "start" | "center" | "end";
  side?: "top" | "bottom";
  sideOffset?: number;
}

export function PopoverContent({
  children,
  className,
  align = "center",
  side = "bottom",
  sideOffset = 4,
  ...props
}: PopoverContentProps) {
  const { open, setOpen } = React.useContext(PopoverContext);
  const contentRef = React.useRef<HTMLDivElement>(null);

  // Handle click outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (contentRef.current && !contentRef.current.contains(event.target as Node)) {
        // Check if the click is on the trigger element
        const triggerClicked = (event.target as HTMLElement).closest("[aria-haspopup]");
        if (!triggerClicked) {
          setOpen(false);
        }
      }
    };

    if (open) {
      // Delay to avoid immediate close on open click
      const timer = setTimeout(() => {
        document.addEventListener("mousedown", handleClickOutside);
      }, 0);
      return () => {
        clearTimeout(timer);
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open, setOpen]);

  // Handle Escape key
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
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

  if (!open) return null;

  // For side="top", we need to position above the trigger
  const positionStyles: React.CSSProperties =
    side === "top"
      ? { bottom: "100%", marginBottom: sideOffset }
      : { top: "100%", marginTop: sideOffset };

  return (
    <div
      ref={contentRef}
      className={cn(
        // Same panel chrome as every menu — a popover anchored to a chrome
        // button is the same object to the eye, and it read as a different one
        // at 6px radius with a border while the menus were at 10px with a ring.
        "absolute z-50 min-w-[8rem] overflow-hidden",
        MENU_PANEL_CLASS,
        // The panel class carries the menus' 6px row padding; a popover's
        // content sets its own, so keep the historical zero default here.
        "p-0",
        "animate-in fade-in-0 zoom-in-95",
        align === "start" && "left-0",
        align === "center" && "left-1/2 -translate-x-1/2",
        align === "end" && "right-0",
        className
      )}
      style={positionStyles}
      {...props}
    >
      {children}
    </div>
  );
}
