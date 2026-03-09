"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { motion, AnimatePresence, useDragControls, type PanInfo } from "framer-motion";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-device-type";
import { MOBILE_SPRINGS, Z_INDEX } from "@/lib/constants";
import { Button } from "./button";

const ModalTitleIdContext = React.createContext<string>("modal-title");

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

// Get all focusable elements within a container
function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const focusableSelectors = [
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "a[href]",
    '[tabindex]:not([tabindex="-1"])',
  ].join(", ");

  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelectors));
}

export function Modal({ open, onClose, children, className }: ModalProps) {
  const [mounted, setMounted] = React.useState(false);
  const modalRef = React.useRef<HTMLDivElement>(null);
  const previousActiveElement = React.useRef<HTMLElement | null>(null);
  const isMobile = useIsMobile();
  const dragControls = useDragControls();
  const modalIdRef = React.useRef(`modal-title-${Math.random().toString(36).slice(2, 8)}`);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Store the previously focused element and focus the modal when it opens
  React.useEffect(() => {
    if (open) {
      previousActiveElement.current = document.activeElement as HTMLElement;

      // Focus the first focusable element in the modal after a short delay
      // On mobile, focus the modal container instead to avoid keyboard popup
      requestAnimationFrame(() => {
        if (modalRef.current) {
          if (typeof window !== "undefined" && window.innerWidth < 768) {
            // On mobile, focus the modal container to maintain accessibility
            // without triggering keyboard popup
            modalRef.current.focus();
          } else {
            const focusableElements = getFocusableElements(modalRef.current);
            if (focusableElements.length > 0) {
              focusableElements[0].focus();
            } else {
              // If no focusable elements, focus the modal itself
              modalRef.current.focus();
            }
          }
        }
      });
    } else {
      // Restore focus when modal closes
      if (previousActiveElement.current) {
        previousActiveElement.current.focus();
      }
    }
  }, [open]);

  // Handle keyboard events
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open || !modalRef.current) return;

      // Close on Escape
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      // Focus trap on Tab
      if (e.key === "Tab") {
        const focusableElements = getFocusableElements(modalRef.current);
        if (focusableElements.length === 0) {
          e.preventDefault();
          return;
        }

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          // Shift + Tab: go to previous element
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          // Tab: go to next element
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  const handleDragEnd = React.useCallback(
    (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      if (info.offset.y > 100 || info.velocity.y > 300) {
        onClose();
      }
    },
    [onClose]
  );

  if (!mounted) return null;

  // Mobile: iOS-style bottom sheet
  if (isMobile) {
    return createPortal(
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              className="fixed inset-0"
              style={{ zIndex: Z_INDEX.MODAL - 1 }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={onClose}
              aria-hidden="true"
            >
              <div className="h-full w-full bg-black/40 dark:bg-black/60" />
            </motion.div>

            {/* Bottom sheet panel */}
            <motion.div
              ref={modalRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={modalIdRef.current}
              tabIndex={-1}
              className={cn(
                "fixed inset-x-0 bottom-0",
                "rounded-t-2xl border-t border-border bg-popover shadow-2xl",
                "flex flex-col focus:outline-none",
                className
              )}
              style={{
                zIndex: Z_INDEX.MODAL,
                maxHeight: "90vh",
                paddingBottom: "env(safe-area-inset-bottom)",
              }}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", ...MOBILE_SPRINGS.SMOOTH }}
              drag="y"
              dragControls={dragControls}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0.1, bottom: 0.3 }}
              onDragEnd={handleDragEnd}
            >
              {/* Drag handle */}
              <div
                className="flex shrink-0 cursor-grab touch-none justify-center pb-2 pt-3 active:cursor-grabbing"
                onPointerDown={(e) => dragControls.start(e)}
              >
                <div className="h-1 w-10 rounded-full bg-border" />
              </div>

              {/* Content */}
              <div className="overflow-y-auto px-6 pb-6">
                <ModalTitleIdContext.Provider value={modalIdRef.current}>
                  {children}
                </ModalTitleIdContext.Provider>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>,
      document.body
    );
  }

  // Desktop: centered dialog with enter/exit animations
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          />
          {/* Modal content */}
          <motion.div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={modalIdRef.current}
            tabIndex={-1}
            className={cn(
              "relative z-50 w-full max-w-md rounded-lg border border-border bg-popover p-6 shadow-lg",
              "focus:outline-none",
              className
            )}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
          >
            <ModalTitleIdContext.Provider value={modalIdRef.current}>
              {children}
            </ModalTitleIdContext.Provider>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

interface ModalHeaderProps {
  children: React.ReactNode;
  onClose?: () => void;
}

export function ModalHeader({ children, onClose }: ModalHeaderProps) {
  const titleId = React.useContext(ModalTitleIdContext);
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 id={titleId} className="text-lg font-semibold">
        {children}
      </h2>
      {onClose && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-8 w-8"
          aria-label="Close dialog"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

interface ModalFooterProps {
  children: React.ReactNode;
}

export function ModalFooter({ children }: ModalFooterProps) {
  return <div className="mt-6 flex items-center justify-end gap-2">{children}</div>;
}
