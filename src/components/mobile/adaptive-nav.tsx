"use client";

import { useCallback, useEffect } from "react";
import {
  FolderOpen,
  Sparkles,
  ListTree,
  Type,
  Link as LinkIcon,
  Image as ImageIcon,
  Check,
  Wand2,
  Scissors,
  Maximize2,
  MessageSquare,
  MoreHorizontal,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/stores/layout-store";
import { useEditorStore } from "@/stores/editor-store";
import { Z_INDEX, MOBILE_V2, MOBILE_SPRINGS, MOBILE_NAV_MODES } from "@/lib/constants";
import { haptics } from "@/lib/haptics";
import { useKeyboardVisible } from "@/hooks/use-mobile-gestures";

interface NavButtonProps {
  icon: React.ReactNode;
  label?: string;
  isActive?: boolean;
  isPrimary?: boolean;
  onClick: () => void;
  className?: string;
}

function NavButton({ icon, label, isActive, isPrimary, onClick, className }: NavButtonProps) {
  const handleClick = useCallback(() => {
    haptics.light();
    onClick();
  }, [onClick]);

  if (isPrimary) {
    return (
      <motion.button
        type="button"
        onClick={handleClick}
        className={cn(
          "flex items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg",
          "active:scale-95 transition-transform",
          className
        )}
        style={{
          width: MOBILE_V2.FAB_SIZE,
          height: MOBILE_V2.FAB_SIZE,
        }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        {icon}
      </motion.button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "flex flex-col items-center justify-center gap-0.5 rounded-xl transition-colors",
        "active:scale-95 active:bg-accent/50",
        isActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
        className
      )}
      style={{
        minWidth: MOBILE_V2.NAV_BUTTON_SIZE,
        height: MOBILE_V2.NAV_BUTTON_SIZE,
        padding: "8px 12px",
      }}
    >
      <div className="h-5 w-5 flex items-center justify-center">{icon}</div>
      {label && <span className="text-[10px] font-medium">{label}</span>}
    </button>
  );
}

function QuickActionButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  const handleClick = useCallback(() => {
    haptics.light();
    onClick();
  }, [onClick]);

  return (
    <motion.button
      type="button"
      onClick={handleClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-2 rounded-full",
        "bg-accent/80 text-accent-foreground text-sm font-medium",
        "active:scale-95 transition-transform"
      )}
      whileTap={{ scale: 0.95 }}
    >
      {icon}
      <span>{label}</span>
    </motion.button>
  );
}

// Idle mode: Files, AI FAB, Outline
function IdleNav() {
  const { setMobileSidebarOpen, setMobileOutlineOpen, openAIPanel, isMobileSidebarOpen } =
    useLayoutStore();

  return (
    <div className="flex items-center justify-between w-full px-8">
      <NavButton
        icon={<FolderOpen className="h-5 w-5" />}
        label="Files"
        isActive={isMobileSidebarOpen}
        onClick={() => setMobileSidebarOpen(true)}
      />
      {/* FAB is positioned absolutely to float above the nav bar */}
      <div className="relative flex items-center justify-center" style={{ width: 56 }}>
        <motion.button
          type="button"
          onClick={() => {
            haptics.light();
            openAIPanel();
          }}
          className={cn(
            "absolute flex items-center justify-center rounded-full bg-primary text-primary-foreground",
            "shadow-lg shadow-primary/30",
            "active:scale-95 transition-transform"
          )}
          style={{
            width: 56,
            height: 56,
            bottom: 4,
          }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <Sparkles className="h-6 w-6" />
        </motion.button>
      </div>
      <NavButton
        icon={<ListTree className="h-5 w-5" />}
        label="Outline"
        onClick={() => setMobileOutlineOpen(true)}
      />
    </div>
  );
}

// Editing mode: Format, AI, Link, Image, Done
function EditingNav({ onDone }: { onDone: () => void }) {
  const { setBlockSelectorOpen, openAIPanel } = useLayoutStore();

  const handleLinkClick = useCallback(() => {
    // TODO: Open link modal
    haptics.light();
  }, []);

  const handleImageClick = useCallback(() => {
    // TODO: Open image modal
    haptics.light();
  }, []);

  return (
    <div className="flex items-center justify-between w-full px-2">
      <div className="flex items-center gap-1">
        <NavButton
          icon={<Type className="h-5 w-5" />}
          onClick={() => setBlockSelectorOpen(true)}
        />
        <NavButton icon={<Sparkles className="h-5 w-5" />} onClick={openAIPanel} />
        <NavButton icon={<LinkIcon className="h-5 w-5" />} onClick={handleLinkClick} />
        <NavButton icon={<ImageIcon className="h-5 w-5" />} onClick={handleImageClick} />
      </div>
      <button
        type="button"
        onClick={() => {
          haptics.light();
          onDone();
        }}
        className={cn(
          "px-4 py-2 rounded-lg font-medium text-sm",
          "bg-primary text-primary-foreground",
          "active:scale-95 transition-transform"
        )}
      >
        Done
      </button>
    </div>
  );
}

// Selection mode: AI quick actions
function SelectionNav() {
  const { openAIPanel } = useLayoutStore();
  const { selection } = useEditorStore();

  const handleQuickAction = useCallback((action: string) => {
    haptics.medium();
    // TODO: Implement quick AI actions
    console.log("Quick action:", action, "on text:", selection?.text);
  }, [selection]);

  return (
    <div className="flex items-center gap-2 w-full px-3 overflow-x-auto hide-scrollbar">
      <QuickActionButton
        icon={<Wand2 className="h-4 w-4" />}
        label="Improve"
        onClick={() => handleQuickAction("improve")}
      />
      <QuickActionButton
        icon={<Scissors className="h-4 w-4" />}
        label="Shorten"
        onClick={() => handleQuickAction("shorten")}
      />
      <QuickActionButton
        icon={<Maximize2 className="h-4 w-4" />}
        label="Expand"
        onClick={() => handleQuickAction("expand")}
      />
      <QuickActionButton
        icon={<Check className="h-4 w-4" />}
        label="Fix"
        onClick={() => handleQuickAction("fix")}
      />
      <NavButton
        icon={<MessageSquare className="h-5 w-5" />}
        onClick={openAIPanel}
        className="ml-auto flex-shrink-0"
      />
      <NavButton
        icon={<MoreHorizontal className="h-5 w-5" />}
        onClick={() => haptics.light()}
        className="flex-shrink-0"
      />
    </div>
  );
}

export function AdaptiveNav() {
  const { mobileNavMode, setMobileNavMode, aiPanelState } = useLayoutStore();
  const { selection } = useEditorStore();
  const isKeyboardVisible = useKeyboardVisible();

  // Auto-switch modes based on state
  useEffect(() => {
    if (selection?.text && selection.text.length > 0) {
      setMobileNavMode(MOBILE_NAV_MODES.SELECTION);
    } else if (isKeyboardVisible) {
      setMobileNavMode(MOBILE_NAV_MODES.EDITING);
    } else {
      setMobileNavMode(MOBILE_NAV_MODES.IDLE);
    }
  }, [selection, isKeyboardVisible, setMobileNavMode]);

  const handleDone = useCallback(() => {
    // Blur any focused element to dismiss keyboard
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setMobileNavMode(MOBILE_NAV_MODES.IDLE);
  }, [setMobileNavMode]);

  // Don't show nav when AI panel is open
  if (aiPanelState !== "closed") {
    return null;
  }

  // Calculate total height including safe area
  const navHeight = MOBILE_V2.NAV_BAR_HEIGHT + 16; // Extra space for FAB overflow

  return (
    <motion.nav
      className={cn(
        "fixed bottom-0 left-0 right-0",
        "bg-background/95 backdrop-blur-xl border-t border-border/50",
        "flex items-end",
        "md:hidden"
      )}
      style={{
        zIndex: Z_INDEX.BOTTOM_NAV,
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        minHeight: navHeight,
      }}
      initial={{ y: 100 }}
      animate={{ y: 0 }}
      transition={{ type: "spring", ...MOBILE_SPRINGS.SMOOTH }}
    >
      <AnimatePresence mode="wait">
        {mobileNavMode === MOBILE_NAV_MODES.IDLE && (
          <motion.div
            key="idle"
            className="w-full h-12 flex items-center"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
          >
            <IdleNav />
          </motion.div>
        )}
        {mobileNavMode === MOBILE_NAV_MODES.EDITING && (
          <motion.div
            key="editing"
            className="w-full h-12 flex items-center"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
          >
            <EditingNav onDone={handleDone} />
          </motion.div>
        )}
        {mobileNavMode === MOBILE_NAV_MODES.SELECTION && (
          <motion.div
            key="selection"
            className="w-full h-12 flex items-center"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
          >
            <SelectionNav />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
}
