"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { Editor } from "@tiptap/react";
import {
  Type,
  Bold,
  Italic,
  Link as LinkIcon,
  Plus,
  Sparkles,
  Strikethrough,
  Code,
  Highlighter,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/stores/layout-store";
import { MOBILE_V2, MOBILE_SPRINGS, Z_INDEX } from "@/lib/constants";
import { haptics } from "@/lib/haptics";

interface FloatingToolbarProps {
  editor: Editor | null;
  onLinkClick?: () => void;
  onMoreClick?: () => void;
}

interface ToolbarButtonProps {
  icon: React.ReactNode;
  isActive?: boolean;
  onClick: () => void;
  className?: string;
}

function ToolbarButton({ icon, isActive, onClick, className }: ToolbarButtonProps) {
  const handleClick = useCallback(() => {
    haptics.light();
    onClick();
  }, [onClick]);

  return (
    <motion.button
      type="button"
      onClick={handleClick}
      className={cn(
        "flex items-center justify-center rounded-lg transition-colors",
        "active:scale-95",
        isActive ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/50",
        className
      )}
      style={{
        width: MOBILE_V2.TOOLBAR_BUTTON_SIZE,
        height: MOBILE_V2.TOOLBAR_BUTTON_SIZE,
      }}
      whileTap={{ scale: 0.95 }}
    >
      {icon}
    </motion.button>
  );
}

function ToolbarDivider() {
  return <div className="w-px h-6 bg-border/50 mx-0.5 flex-shrink-0" />;
}

export function FloatingToolbar({ editor, onLinkClick, onMoreClick }: FloatingToolbarProps) {
  const { isFloatingToolbarVisible, setFloatingToolbarVisible, setBlockSelectorOpen, openAIPanel } =
    useLayoutStore();
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const toolbarRef = useRef<HTMLDivElement>(null);

  // Update position based on selection
  useEffect(() => {
    if (!editor) return;

    const updatePosition = () => {
      const { selection } = editor.state;
      const { from, to } = selection;

      // Only show for non-empty selections
      if (from === to) {
        setFloatingToolbarVisible(false);
        return;
      }

      // Get selection coordinates
      const start = editor.view.coordsAtPos(from);
      const end = editor.view.coordsAtPos(to);

      // Calculate center position above selection
      const centerX = (start.left + end.left) / 2;
      const topY = Math.min(start.top, end.top);

      // Get toolbar width for centering
      const toolbarWidth = toolbarRef.current?.offsetWidth || MOBILE_V2.TOOLBAR_MAX_WIDTH;
      const toolbarHeight = MOBILE_V2.FLOATING_TOOLBAR_HEIGHT;

      // Calculate position with viewport bounds
      const viewportWidth = window.innerWidth;
      const padding = 16;

      let x = centerX - toolbarWidth / 2;
      let y = topY - toolbarHeight - 12; // 12px gap above selection

      // Constrain to viewport
      x = Math.max(padding, Math.min(viewportWidth - toolbarWidth - padding, x));

      // If toolbar would be above viewport, show below selection
      if (y < padding) {
        const bottomY = Math.max(start.bottom, end.bottom);
        y = bottomY + 12;
      }

      setPosition({ x, y });
      setFloatingToolbarVisible(true);
    };

    // Listen for selection changes
    editor.on("selectionUpdate", updatePosition);
    editor.on("blur", () => setFloatingToolbarVisible(false));

    return () => {
      editor.off("selectionUpdate", updatePosition);
      editor.off("blur", () => setFloatingToolbarVisible(false));
    };
  }, [editor, setFloatingToolbarVisible]);

  // Format actions
  const toggleBold = useCallback(() => {
    editor?.chain().focus().toggleBold().run();
  }, [editor]);

  const toggleItalic = useCallback(() => {
    editor?.chain().focus().toggleItalic().run();
  }, [editor]);

  const toggleStrike = useCallback(() => {
    editor?.chain().focus().toggleStrike().run();
  }, [editor]);

  const toggleCode = useCallback(() => {
    editor?.chain().focus().toggleCode().run();
  }, [editor]);

  const toggleHighlight = useCallback(() => {
    editor?.chain().focus().toggleHighlight().run();
  }, [editor]);

  const handleBlockSelector = useCallback(() => {
    haptics.light();
    setBlockSelectorOpen(true);
  }, [setBlockSelectorOpen]);

  const handleAI = useCallback(() => {
    haptics.medium();
    openAIPanel();
  }, [openAIPanel]);

  if (!editor) return null;

  return (
    <AnimatePresence>
      {isFloatingToolbarVisible && (
        <motion.div
          ref={toolbarRef}
          className={cn(
            "fixed flex items-center gap-0.5 px-2 py-1",
            "bg-background/95 backdrop-blur-xl border border-border/50",
            "shadow-lg shadow-black/10 dark:shadow-black/30",
            "md:hidden"
          )}
          style={{
            left: position.x,
            top: position.y,
            maxWidth: MOBILE_V2.TOOLBAR_MAX_WIDTH,
            height: MOBILE_V2.FLOATING_TOOLBAR_HEIGHT,
            borderRadius: MOBILE_V2.TOOLBAR_BORDER_RADIUS,
            zIndex: Z_INDEX.BUBBLE_MENU,
          }}
          initial={{ opacity: 0, y: 10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.95 }}
          transition={{ type: "spring", ...MOBILE_SPRINGS.SNAPPY }}
        >
          {/* Block Type Selector */}
          <ToolbarButton
            icon={<Type className="h-5 w-5" />}
            onClick={handleBlockSelector}
          />

          <ToolbarDivider />

          {/* Basic Formatting */}
          <ToolbarButton
            icon={<Bold className="h-5 w-5" />}
            isActive={editor.isActive("bold")}
            onClick={toggleBold}
          />
          <ToolbarButton
            icon={<Italic className="h-5 w-5" />}
            isActive={editor.isActive("italic")}
            onClick={toggleItalic}
          />
          <ToolbarButton
            icon={<Strikethrough className="h-5 w-5" />}
            isActive={editor.isActive("strike")}
            onClick={toggleStrike}
          />

          <ToolbarDivider />

          {/* Extended Formatting */}
          <ToolbarButton
            icon={<Code className="h-5 w-5" />}
            isActive={editor.isActive("code")}
            onClick={toggleCode}
          />
          <ToolbarButton
            icon={<Highlighter className="h-5 w-5" />}
            isActive={editor.isActive("highlight")}
            onClick={toggleHighlight}
          />

          <ToolbarDivider />

          {/* Link */}
          <ToolbarButton
            icon={<LinkIcon className="h-5 w-5" />}
            isActive={editor.isActive("link")}
            onClick={() => {
              haptics.light();
              onLinkClick?.();
            }}
          />

          {/* More Actions */}
          <ToolbarButton
            icon={<Plus className="h-5 w-5" />}
            onClick={() => {
              haptics.light();
              onMoreClick?.();
            }}
          />

          <ToolbarDivider />

          {/* AI Button (Primary) */}
          <motion.button
            type="button"
            onClick={handleAI}
            className={cn(
              "flex items-center justify-center rounded-full",
              "bg-primary text-primary-foreground",
              "active:scale-95"
            )}
            style={{
              width: 36,
              height: 36,
            }}
            whileTap={{ scale: 0.95 }}
          >
            <Sparkles className="h-4 w-4" />
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
