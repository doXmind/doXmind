"use client";

/**
 * Mobile Block Insert Sheet
 *
 * Bottom sheet for inserting blocks (headings, lists, images, etc.).
 * Triggered by the [+] button in the MobileFormattingToolbar.
 */

import { useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Code,
  Minus,
  Table,
  Image,
  Sigma,
  MessageSquareQuote,
  ChevronRight,
  TableOfContents,
  GitBranch,
  X,
} from "lucide-react";
import type { Editor } from "@tiptap/core";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useEditorStore } from "@/stores/editor-store";
import { useLayoutStore } from "@/stores/layout-store";
import { haptics } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { Z_INDEX, MOBILE_SPRINGS } from "@/lib/constants";

interface BlockCommand {
  title: string;
  description: string;
  iconName: string;
  category: "basic" | "lists" | "media" | "advanced";
  action: (editor: Editor) => void;
}

const categoryLabels: Record<string, string> = {
  basic: "Basic Blocks",
  lists: "Lists",
  media: "Media",
  advanced: "Advanced",
};

const iconMap: Record<string, React.ReactNode> = {
  Type: <Type className="h-5 w-5" />,
  Heading1: <Heading1 className="h-5 w-5" />,
  Heading2: <Heading2 className="h-5 w-5" />,
  Heading3: <Heading3 className="h-5 w-5" />,
  List: <List className="h-5 w-5" />,
  ListOrdered: <ListOrdered className="h-5 w-5" />,
  ListTodo: <ListTodo className="h-5 w-5" />,
  Quote: <Quote className="h-5 w-5" />,
  Code: <Code className="h-5 w-5" />,
  Minus: <Minus className="h-5 w-5" />,
  Table: <Table className="h-5 w-5" />,
  // eslint-disable-next-line jsx-a11y/alt-text -- Lucide icon, not an img element
  Image: <Image className="h-5 w-5" />,
  Sigma: <Sigma className="h-5 w-5" />,
  MessageSquareQuote: <MessageSquareQuote className="h-5 w-5" />,
  ChevronRight: <ChevronRight className="h-5 w-5" />,
  TableOfContents: <TableOfContents className="h-5 w-5" />,
  GitBranch: <GitBranch className="h-5 w-5" />,
  InlineMath: (
    <span className="flex h-5 w-5 items-center justify-center font-serif text-sm">x²</span>
  ),
};

/** Block commands data — derived from slash-commands but without JSX icons */
const blockCommands: BlockCommand[] = [
  // Basic Blocks
  {
    title: "Text",
    description: "Plain text paragraph",
    iconName: "Type",
    category: "basic",
    action: (editor) => {
      editor.chain().focus().setParagraph().run();
    },
  },
  {
    title: "Heading 1",
    description: "Large section heading",
    iconName: "Heading1",
    category: "basic",
    action: (editor) => {
      editor.chain().focus().setNode("heading", { level: 1 }).run();
    },
  },
  {
    title: "Heading 2",
    description: "Medium section heading",
    iconName: "Heading2",
    category: "basic",
    action: (editor) => {
      editor.chain().focus().setNode("heading", { level: 2 }).run();
    },
  },
  {
    title: "Heading 3",
    description: "Small section heading",
    iconName: "Heading3",
    category: "basic",
    action: (editor) => {
      editor.chain().focus().setNode("heading", { level: 3 }).run();
    },
  },
  {
    title: "Quote",
    description: "Create a blockquote",
    iconName: "Quote",
    category: "basic",
    action: (editor) => {
      editor.chain().focus().toggleBlockquote().run();
    },
  },
  {
    title: "Callout",
    description: "Highlighted info block",
    iconName: "MessageSquareQuote",
    category: "basic",
    action: (editor) => {
      editor.chain().focus().setCallout({ type: "info" }).run();
    },
  },
  {
    title: "Toggle",
    description: "Collapsible content",
    iconName: "ChevronRight",
    category: "basic",
    action: (editor) => {
      editor.chain().focus().setToggle().run();
    },
  },
  {
    title: "Table of Contents",
    description: "Auto-generated from headings",
    iconName: "TableOfContents",
    category: "basic",
    action: (editor) => {
      editor.chain().focus().setTableOfContents().run();
    },
  },
  {
    title: "Divider",
    description: "Horizontal divider line",
    iconName: "Minus",
    category: "basic",
    action: (editor) => {
      editor.chain().focus().setHorizontalRule().run();
    },
  },

  // Lists
  {
    title: "Bullet List",
    description: "Simple bullet list",
    iconName: "List",
    category: "lists",
    action: (editor) => {
      editor.chain().focus().toggleBulletList().run();
    },
  },
  {
    title: "Numbered List",
    description: "Numbered list",
    iconName: "ListOrdered",
    category: "lists",
    action: (editor) => {
      editor.chain().focus().toggleOrderedList().run();
    },
  },
  {
    title: "Task List",
    description: "List with checkboxes",
    iconName: "ListTodo",
    category: "lists",
    action: (editor) => {
      editor.chain().focus().toggleTaskList().run();
    },
  },

  // Media
  {
    title: "Image",
    description: "Upload or embed an image",
    iconName: "Image",
    category: "media",
    action: (editor) => {
      const { openImageModal } = useEditorStore.getState();
      openImageModal((url, alt) => {
        editor
          .chain()
          .focus()
          .insertContent([{ type: "image", attrs: { src: url, alt } }, { type: "paragraph" }])
          .run();
      });
    },
  },
  {
    title: "Table",
    description: "Insert a table",
    iconName: "Table",
    category: "media",
    action: (editor) => {
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    },
  },

  // Advanced
  {
    title: "Code Block",
    description: "Code with syntax highlighting",
    iconName: "Code",
    category: "advanced",
    action: (editor) => {
      editor.chain().focus().toggleCodeBlock().run();
    },
  },
  {
    title: "Math Block",
    description: "Block math equation",
    iconName: "Sigma",
    category: "advanced",
    action: (editor) => {
      editor
        .chain()
        .focus()
        .insertContent({ type: "blockMath", attrs: { latex: "" } })
        .run();
    },
  },
  {
    title: "Mermaid Chart",
    description: "Diagram or chart",
    iconName: "GitBranch",
    category: "advanced",
    action: (editor) => {
      editor
        .chain()
        .focus()
        .insertContent({ type: "mermaidChart", attrs: { code: "" } })
        .run();
    },
  },
  {
    title: "Inline Math",
    description: "Inline math expression",
    iconName: "InlineMath",
    category: "advanced",
    action: (editor) => {
      editor
        .chain()
        .focus()
        .insertContent({ type: "inlineMath", attrs: { latex: "" } })
        .run();
    },
  },
];

export function MobileBlockInsertSheet() {
  const { editor } = useEditorRefStore();
  const { isMobileBlockInsertOpen, setMobileBlockInsertOpen } = useLayoutStore();
  const [filter, setFilter] = useState("");

  const filteredCommands = useMemo(() => {
    if (!filter.trim()) return blockCommands;
    const q = filter.toLowerCase();
    return blockCommands.filter(
      (cmd) => cmd.title.toLowerCase().includes(q) || cmd.description.toLowerCase().includes(q)
    );
  }, [filter]);

  // Group by category
  const grouped = useMemo(() => {
    const groups: {
      category: string;
      items: BlockCommand[];
    }[] = [];
    let currentCategory = "";

    for (const cmd of filteredCommands) {
      if (cmd.category !== currentCategory) {
        currentCategory = cmd.category;
        groups.push({ category: cmd.category, items: [] });
      }
      groups[groups.length - 1].items.push(cmd);
    }

    return groups;
  }, [filteredCommands]);

  const handleSelect = useCallback(
    (command: BlockCommand) => {
      if (!editor) return;
      haptics.light();
      setMobileBlockInsertOpen(false);
      setFilter("");
      // Small delay to let sheet close, then insert
      setTimeout(() => {
        command.action(editor);
      }, 100);
    },
    [editor, setMobileBlockInsertOpen]
  );

  const handleClose = useCallback(() => {
    setMobileBlockInsertOpen(false);
    setFilter("");
  }, [setMobileBlockInsertOpen]);

  return (
    <AnimatePresence>
      {isMobileBlockInsertOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/40 dark:bg-black/60 md:hidden"
            style={{ zIndex: Z_INDEX.MOBILE_OVERLAY }}
            onClick={handleClose}
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", ...MOBILE_SPRINGS.SMOOTH }}
            className="fixed inset-x-0 bottom-0 md:hidden"
            style={{ zIndex: Z_INDEX.MOBILE_PANEL, maxHeight: "70vh" }}
          >
            <div className="rounded-t-2xl bg-background shadow-2xl">
              {/* Drag handle */}
              <div className="flex justify-center py-2">
                <div className="h-1 w-10 rounded-full bg-muted-foreground/20" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-4 pb-2">
                <h3 className="text-base font-semibold">Insert Block</h3>
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Search filter */}
              <div className="px-4 pb-2">
                <input
                  type="text"
                  placeholder="Filter blocks..."
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className={cn(
                    "w-full rounded-lg border border-border/50 bg-muted/50 px-3 py-2",
                    "text-sm placeholder:text-muted-foreground/60",
                    "focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20"
                  )}
                />
              </div>

              {/* Block list */}
              <div
                className="overflow-y-auto px-2 pb-[env(safe-area-inset-bottom)]"
                style={{ maxHeight: "calc(70vh - 120px)" }}
              >
                {grouped.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                    No blocks found
                  </div>
                ) : (
                  grouped.map((group, groupIndex) => (
                    <div key={group.category}>
                      {groupIndex > 0 && <div className="mx-2 my-1 h-px bg-border/30" />}
                      <div className="px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                        {categoryLabels[group.category] ?? group.category}
                      </div>
                      {group.items.map((cmd) => (
                        <button
                          key={cmd.title}
                          type="button"
                          onClick={() => handleSelect(cmd)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left",
                            "transition-colors active:scale-[0.98] active:bg-accent"
                          )}
                        >
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/40 bg-muted/50">
                            {iconMap[cmd.iconName] || <Type className="h-5 w-5" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">{cmd.title}</p>
                            <p className="text-xs text-muted-foreground">{cmd.description}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
