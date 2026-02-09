"use client";

import { useRef, useCallback, ReactNode } from "react";
import { motion, AnimatePresence, useDragControls, PanInfo } from "framer-motion";
import { cn } from "@/lib/utils";
import { Z_INDEX, MOBILE_V2, MOBILE_SPRINGS } from "@/lib/constants";
import { haptics } from "@/lib/haptics";

type PanelPosition = "left" | "right" | "bottom";

interface PanelContainerProps {
  isOpen: boolean;
  onClose: () => void;
  position: PanelPosition;
  children: ReactNode;
  width?: number | string;
  height?: number | string;
  showBackdrop?: boolean;
  className?: string;
}

// Animation variants for different positions
const getVariants = (position: PanelPosition) => {
  switch (position) {
    case "left":
      return {
        initial: { x: "-100%" },
        animate: { x: 0 },
        exit: { x: "-100%" },
      };
    case "right":
      return {
        initial: { x: "100%" },
        animate: { x: 0 },
        exit: { x: "100%" },
      };
    case "bottom":
      return {
        initial: { y: "100%" },
        animate: { y: 0 },
        exit: { y: "100%" },
      };
  }
};

// Get drag axis based on position
const getDragAxis = (position: PanelPosition): "x" | "y" => {
  return position === "bottom" ? "y" : "x";
};

// Get drag constraints based on position
const getDragConstraints = (position: PanelPosition) => {
  switch (position) {
    case "left":
      return { left: 0, right: 0 };
    case "right":
      return { left: 0, right: 0 };
    case "bottom":
      return { top: 0, bottom: 0 };
  }
};

// Get drag elastic based on position
const getDragElastic = (position: PanelPosition) => {
  switch (position) {
    case "left":
      return { left: 0.3, right: 0.1 };
    case "right":
      return { left: 0.1, right: 0.3 };
    case "bottom":
      return { top: 0.1, bottom: 0.3 };
  }
};

export function PanelContainer({
  isOpen,
  onClose,
  position,
  children,
  width = 300,
  height = "85vh",
  showBackdrop = true,
  className,
}: PanelContainerProps) {
  const dragControls = useDragControls();
  const containerRef = useRef<HTMLDivElement>(null);

  const variants = getVariants(position);
  const dragAxis = getDragAxis(position);
  const dragConstraints = getDragConstraints(position);
  const dragElastic = getDragElastic(position);

  const handleDragEnd = useCallback(
    (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      const velocity = dragAxis === "x" ? info.velocity.x : info.velocity.y;
      const offset = dragAxis === "x" ? info.offset.x : info.offset.y;

      // Determine close threshold based on position
      let shouldClose = false;

      switch (position) {
        case "left":
          shouldClose = velocity < -300 || offset < -100;
          break;
        case "right":
          shouldClose = velocity > 300 || offset > 100;
          break;
        case "bottom":
          shouldClose = velocity > 300 || offset > 100;
          break;
      }

      if (shouldClose) {
        haptics.tick();
        onClose();
      }
    },
    [position, dragAxis, onClose]
  );

  // Get panel styles based on position
  const getPanelStyles = () => {
    const baseStyles: React.CSSProperties = {
      zIndex: Z_INDEX.MOBILE_PANEL,
    };

    switch (position) {
      case "left":
        return {
          ...baseStyles,
          top: 0,
          left: 0,
          bottom: 0,
          width: typeof width === "number" ? width : width,
          maxWidth: "85vw",
          borderTopRightRadius: MOBILE_V2.PANEL_BORDER_RADIUS,
          borderBottomRightRadius: MOBILE_V2.PANEL_BORDER_RADIUS,
        };
      case "right":
        return {
          ...baseStyles,
          top: 0,
          right: 0,
          bottom: 0,
          width: typeof width === "number" ? width : width,
          maxWidth: "85vw",
          borderTopLeftRadius: MOBILE_V2.PANEL_BORDER_RADIUS,
          borderBottomLeftRadius: MOBILE_V2.PANEL_BORDER_RADIUS,
        };
      case "bottom":
        return {
          ...baseStyles,
          left: 0,
          right: 0,
          bottom: 0,
          height: height,
          maxHeight: "90vh",
          borderTopLeftRadius: MOBILE_V2.PANEL_BORDER_RADIUS,
          borderTopRightRadius: MOBILE_V2.PANEL_BORDER_RADIUS,
          paddingBottom: "env(safe-area-inset-bottom)",
        };
    }
  };

  // Get handle position styles
  const getHandleStyles = () => {
    switch (position) {
      case "left":
        return "absolute right-0 top-0 bottom-0 w-6 flex items-center justify-center";
      case "right":
        return "absolute left-0 top-0 bottom-0 w-6 flex items-center justify-center";
      case "bottom":
        return "flex justify-center py-3";
    }
  };

  // Render handle based on position
  const renderHandle = () => {
    if (position === "bottom") {
      return (
        <div
          className={cn(getHandleStyles(), "cursor-grab touch-none active:cursor-grabbing")}
          onPointerDown={(e) => dragControls.start(e)}
        >
          <div className="h-1 w-10 rounded-full bg-border" />
        </div>
      );
    }

    // Vertical handle for left/right panels
    return (
      <div
        className={cn(getHandleStyles(), "cursor-grab touch-none active:cursor-grabbing")}
        onPointerDown={(e) => dragControls.start(e)}
      >
        <div className="h-10 w-1 rounded-full bg-border" />
      </div>
    );
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          {showBackdrop && (
            <motion.div
              className="fixed inset-0 bg-black/40 dark:bg-black/60 md:hidden"
              style={{ zIndex: Z_INDEX.MOBILE_OVERLAY }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                haptics.light();
                onClose();
              }}
            />
          )}

          {/* Panel */}
          <motion.div
            ref={containerRef}
            className={cn(
              "fixed flex flex-col overflow-hidden bg-background shadow-2xl md:hidden",
              className
            )}
            style={getPanelStyles()}
            variants={variants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ type: "spring", ...MOBILE_SPRINGS.SMOOTH }}
            drag={dragAxis}
            dragControls={dragControls}
            dragConstraints={dragConstraints}
            dragElastic={dragElastic}
            onDragEnd={handleDragEnd}
          >
            {/* Drag Handle */}
            {renderHandle()}

            {/* Content */}
            <div className="flex-1 overflow-hidden">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/**
 * Pre-configured panel for files sidebar (left position)
 */
interface FilesPanelProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function FilesPanel({ isOpen, onClose, children }: FilesPanelProps) {
  return (
    <PanelContainer isOpen={isOpen} onClose={onClose} position="left" width={300}>
      {children}
    </PanelContainer>
  );
}

/**
 * Pre-configured panel for outline (right position)
 */
interface OutlinePanelProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function OutlinePanel({ isOpen, onClose, children }: OutlinePanelProps) {
  return (
    <PanelContainer isOpen={isOpen} onClose={onClose} position="right" width={280}>
      {children}
    </PanelContainer>
  );
}
