"use client";

import { useCallback, useState, useEffect } from "react";
import { Editor } from "@tiptap/react";
import { Wand2, Scissors, Maximize2, Check, Languages, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor-store";
import { MOBILE_SPRINGS, Z_INDEX } from "@/lib/constants";
import { haptics } from "@/lib/haptics";
import { useQuickEdit } from "@/hooks/use-quick-edit";

interface QuickAIAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  prompt: string;
}

const QUICK_ACTIONS: QuickAIAction[] = [
  {
    id: "improve",
    label: "Improve",
    icon: <Wand2 className="h-4 w-4" />,
    prompt: "Improve the writing quality of this text while preserving its meaning:",
  },
  {
    id: "shorten",
    label: "Shorten",
    icon: <Scissors className="h-4 w-4" />,
    prompt: "Make this text more concise while keeping the key points:",
  },
  {
    id: "expand",
    label: "Expand",
    icon: <Maximize2 className="h-4 w-4" />,
    prompt: "Expand this text with more detail and explanation:",
  },
  {
    id: "fix",
    label: "Fix",
    icon: <Check className="h-4 w-4" />,
    prompt: "Fix any grammar, spelling, or punctuation errors in this text:",
  },
  {
    id: "translate",
    label: "Translate",
    icon: <Languages className="h-4 w-4" />,
    prompt: "Translate this text to English (or the user's preferred language):",
  },
];

// Map mobile action IDs to backend action IDs
const ACTION_ID_MAP: Record<string, string> = {
  improve: "improve",
  shorten: "shorten",
  expand: "expand",
  fix: "fix-grammar",
  translate: "translate-en",
};

interface InlineAIActionsProps {
  editor: Editor | null;
  position: { x: number; y: number } | null;
  visible: boolean;
  onAction?: (action: string, result: string) => void;
}

export function InlineAIActions({ editor, position, visible, onAction }: InlineAIActionsProps) {
  const { selection } = useEditorStore();
  const { edit, cancel, isEditing } = useQuickEdit();
  const [activeActionId, setActiveActionId] = useState<string | null>(null);

  // Cancel AI request when component becomes invisible
  useEffect(() => {
    if (!visible) {
      cancel();
      setActiveActionId(null);
    }
  }, [visible, cancel]);

  const handleAction = useCallback(
    async (action: QuickAIAction) => {
      if (!editor || !selection?.text) return;

      haptics.medium();
      setActiveActionId(action.id);

      try {
        // Map action ID to backend action
        const backendAction = ACTION_ID_MAP[action.id] || action.id;

        // Call AI via hook
        const result = await edit(selection.text, backendAction);

        if (result) {
          // Apply the result to the editor - replace selection with AI result
          editor
            .chain()
            .focus()
            .setTextSelection({ from: selection.from, to: selection.to })
            .insertContent(result)
            .run();

          haptics.success();
          onAction?.(action.id, result);
        }
      } catch (error) {
        haptics.error();
        console.error("AI action failed:", error);
      } finally {
        setActiveActionId(null);
      }
    },
    [editor, selection, onAction, edit]
  );

  if (!visible || !position || !selection?.text) return null;

  return (
    <AnimatePresence>
      <motion.div
        className={cn(
          "fixed flex items-center gap-1 px-2 py-1.5",
          "border border-border/50 bg-background/95 backdrop-blur-xl",
          "rounded-full shadow-lg shadow-black/10 dark:shadow-black/30",
          "md:hidden"
        )}
        style={{
          left: position.x,
          top: position.y,
          zIndex: Z_INDEX.BUBBLE_MENU,
        }}
        initial={{ opacity: 0, y: 10, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.95 }}
        transition={{ type: "spring", ...MOBILE_SPRINGS.SNAPPY }}
      >
        {QUICK_ACTIONS.map((action) => (
          <motion.button
            key={action.id}
            type="button"
            onClick={() => handleAction(action)}
            disabled={isEditing}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-2",
              "text-sm font-medium transition-colors",
              "active:scale-95",
              isEditing && activeActionId === action.id
                ? "bg-primary text-primary-foreground"
                : "text-foreground hover:bg-accent"
            )}
            whileTap={{ scale: 0.95 }}
          >
            {isEditing && activeActionId === action.id ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              action.icon
            )}
            <span className="hidden sm:inline">{action.label}</span>
          </motion.button>
        ))}
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * Hook to manage inline AI actions visibility and position
 */
export function useInlineAIActions(_editor: Editor | null) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const { selection } = useEditorStore();

  const show = useCallback(
    (x: number, y: number) => {
      if (selection?.text) {
        setPosition({ x, y });
        setVisible(true);
      }
    },
    [selection]
  );

  const hide = useCallback(() => {
    setVisible(false);
    setPosition(null);
  }, []);

  return {
    visible,
    position,
    show,
    hide,
  };
}
