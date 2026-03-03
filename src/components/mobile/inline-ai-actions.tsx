"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Editor } from "@tiptap/react";
import { Wand2, Scissors, Maximize2, Check, Languages } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useChat } from "@/hooks/use-chat";
import { MOBILE_SPRINGS, Z_INDEX } from "@/lib/constants";
import { haptics } from "@/lib/haptics";
import { useFileStore } from "@/stores/file-store";

interface QuickAIAction {
  id: string;
  label: string;
  labelKey: string;
  icon: React.ReactNode;
  /** Backend action ID for quick edit prompt mapping */
  backendAction: string;
}

const QUICK_ACTIONS: QuickAIAction[] = [
  {
    id: "improve",
    label: "Improve",
    labelKey: "improve",
    icon: <Wand2 className="h-4 w-4" />,
    backendAction: "improve",
  },
  {
    id: "shorten",
    label: "Shorten",
    labelKey: "shorten",
    icon: <Scissors className="h-4 w-4" />,
    backendAction: "shorten",
  },
  {
    id: "expand",
    label: "Expand",
    labelKey: "expand",
    icon: <Maximize2 className="h-4 w-4" />,
    backendAction: "expand",
  },
  {
    id: "fix",
    label: "Fix",
    labelKey: "fix",
    icon: <Check className="h-4 w-4" />,
    backendAction: "fix-grammar",
  },
  {
    id: "translate",
    label: "Translate",
    labelKey: "translate",
    icon: <Languages className="h-4 w-4" />,
    backendAction: "translate-en",
  },
];

interface InlineAIActionsProps {
  editor: Editor | null;
  position: { x: number; y: number } | null;
  visible: boolean;
  onAction?: (action: string) => void;
}

export function InlineAIActions({ editor, position, visible, onAction }: InlineAIActionsProps) {
  const t = useTranslations("mobile");
  const { selection } = useEditorStore();
  const { sendQuickEditMessage, isStreaming } = useChat();
  const { currentFileId } = useFileStore();
  const setMobileChatOverlayOpen = useLayoutStore((s) => s.setMobileChatOverlayOpen);

  const handleAction = useCallback(
    (action: QuickAIAction) => {
      if (!editor || !selection?.text || isStreaming) return;

      haptics.medium();

      const fileId = currentFileId || "demo-file";
      sendQuickEditMessage(action.backendAction, selection.text, [fileId]);

      // Open mobile chat to show the result
      setMobileChatOverlayOpen(true);

      onAction?.(action.id);
    },
    [
      editor,
      selection,
      isStreaming,
      currentFileId,
      sendQuickEditMessage,
      setMobileChatOverlayOpen,
      onAction,
    ]
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
            disabled={isStreaming}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-2",
              "text-sm font-medium transition-colors",
              "active:scale-95",
              "text-foreground hover:bg-accent",
              "disabled:pointer-events-none disabled:opacity-50"
            )}
            whileTap={{ scale: 0.95 }}
          >
            {action.icon}
            <span className="hidden sm:inline">{t(action.labelKey)}</span>
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
