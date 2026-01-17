"use client";

import { useCallback } from "react";
import { Editor } from "@tiptap/react";
import {
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Code2,
  Minus,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/stores/layout-store";
import { MOBILE_V2, MOBILE_SPRINGS, Z_INDEX } from "@/lib/constants";
import { haptics } from "@/lib/haptics";

interface BlockOption {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  action: (editor: Editor) => void;
  isActive?: (editor: Editor) => boolean;
}

const BLOCK_OPTIONS: BlockOption[] = [
  {
    id: "paragraph",
    label: "Text",
    description: "Plain text",
    icon: <Type className="h-5 w-5" />,
    action: (editor) => editor.chain().focus().setParagraph().run(),
    isActive: (editor) => editor.isActive("paragraph"),
  },
  {
    id: "heading1",
    label: "Heading 1",
    description: "Large heading",
    icon: <Heading1 className="h-5 w-5" />,
    action: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    isActive: (editor) => editor.isActive("heading", { level: 1 }),
  },
  {
    id: "heading2",
    label: "Heading 2",
    description: "Medium heading",
    icon: <Heading2 className="h-5 w-5" />,
    action: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    isActive: (editor) => editor.isActive("heading", { level: 2 }),
  },
  {
    id: "heading3",
    label: "Heading 3",
    description: "Small heading",
    icon: <Heading3 className="h-5 w-5" />,
    action: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    isActive: (editor) => editor.isActive("heading", { level: 3 }),
  },
  {
    id: "bulletList",
    label: "Bullet List",
    description: "Unordered list",
    icon: <List className="h-5 w-5" />,
    action: (editor) => editor.chain().focus().toggleBulletList().run(),
    isActive: (editor) => editor.isActive("bulletList"),
  },
  {
    id: "orderedList",
    label: "Numbered List",
    description: "Ordered list",
    icon: <ListOrdered className="h-5 w-5" />,
    action: (editor) => editor.chain().focus().toggleOrderedList().run(),
    isActive: (editor) => editor.isActive("orderedList"),
  },
  {
    id: "taskList",
    label: "Task List",
    description: "Checkboxes",
    icon: <ListTodo className="h-5 w-5" />,
    action: (editor) => editor.chain().focus().toggleTaskList().run(),
    isActive: (editor) => editor.isActive("taskList"),
  },
  {
    id: "blockquote",
    label: "Quote",
    description: "Blockquote",
    icon: <Quote className="h-5 w-5" />,
    action: (editor) => editor.chain().focus().toggleBlockquote().run(),
    isActive: (editor) => editor.isActive("blockquote"),
  },
  {
    id: "codeBlock",
    label: "Code",
    description: "Code block",
    icon: <Code2 className="h-5 w-5" />,
    action: (editor) => editor.chain().focus().toggleCodeBlock().run(),
    isActive: (editor) => editor.isActive("codeBlock"),
  },
  {
    id: "horizontalRule",
    label: "Divider",
    description: "Horizontal line",
    icon: <Minus className="h-5 w-5" />,
    action: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
];

interface BlockSelectorProps {
  editor: Editor | null;
}

export function BlockSelector({ editor }: BlockSelectorProps) {
  const { isBlockSelectorOpen, setBlockSelectorOpen } = useLayoutStore();

  const handleSelect = useCallback(
    (option: BlockOption) => {
      if (!editor) return;
      haptics.medium();
      option.action(editor);
      setBlockSelectorOpen(false);
    },
    [editor, setBlockSelectorOpen]
  );

  const handleClose = useCallback(() => {
    haptics.light();
    setBlockSelectorOpen(false);
  }, [setBlockSelectorOpen]);

  if (!editor) return null;

  return (
    <AnimatePresence>
      {isBlockSelectorOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/40 dark:bg-black/60 md:hidden"
            style={{ zIndex: Z_INDEX.MOBILE_OVERLAY }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
          />

          {/* Selector Sheet */}
          <motion.div
            className={cn(
              "fixed bottom-0 left-0 right-0 md:hidden",
              "bg-background border-t border-border",
              "pb-[env(safe-area-inset-bottom)]"
            )}
            style={{
              zIndex: Z_INDEX.MOBILE_PANEL,
              borderTopLeftRadius: MOBILE_V2.PANEL_BORDER_RADIUS,
              borderTopRightRadius: MOBILE_V2.PANEL_BORDER_RADIUS,
            }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", ...MOBILE_SPRINGS.SMOOTH }}
          >
            {/* Handle */}
            <div className="flex justify-center py-3">
              <div className="h-1 w-10 rounded-full bg-border" />
            </div>

            {/* Header */}
            <div className="px-4 pb-2">
              <h3 className="text-base font-semibold">Turn into</h3>
            </div>

            {/* Options */}
            <div className="max-h-[60vh] overflow-y-auto px-2 pb-4">
              {BLOCK_OPTIONS.map((option, index) => {
                const isActive = option.isActive?.(editor) || false;
                return (
                  <motion.button
                    key={option.id}
                    type="button"
                    onClick={() => handleSelect(option)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 rounded-xl transition-colors",
                      "active:scale-[0.98]",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-accent"
                    )}
                    style={{ height: MOBILE_V2.BLOCK_SELECTOR_ITEM_HEIGHT }}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03 }}
                  >
                    <div
                      className={cn(
                        "flex items-center justify-center w-10 h-10 rounded-lg",
                        isActive ? "bg-primary/20" : "bg-accent"
                      )}
                    >
                      {option.icon}
                    </div>
                    <div className="flex-1 text-left">
                      <div className="font-medium">{option.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {option.description}
                      </div>
                    </div>
                    {isActive && (
                      <div className="w-2 h-2 rounded-full bg-primary" />
                    )}
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
