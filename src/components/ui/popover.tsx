"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

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
      if (
        contentRef.current &&
        !contentRef.current.contains(event.target as Node)
      ) {
        // Check if the click is on the trigger element
        const triggerClicked = (event.target as HTMLElement).closest(
          "[aria-haspopup]"
        );
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
  const positionStyles: React.CSSProperties = side === "top"
    ? { bottom: "100%", marginBottom: sideOffset }
    : { top: "100%", marginTop: sideOffset };

  return (
    <div
      ref={contentRef}
      className={cn(
        "absolute z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md",
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
