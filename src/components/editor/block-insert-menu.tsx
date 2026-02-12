"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
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
} from "lucide-react";
import { cn, formatShortcut } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor-store";
import { TableSizePicker } from "./table-size-picker";

interface BlockInsertMenuProps {
  editor: Editor;
  /** Position after which the new block is inserted */
  insertAfterPos: number;
  /** Screen anchor for positioning the popup */
  anchor: { x: number; y: number };
  onClose: () => void;
}

interface InsertItem {
  title: string;
  description: string;
  icon: React.ReactNode;
  category: "basic" | "lists" | "media" | "advanced";
  shortcut?: string;
  insert: (editor: Editor, insertPos: number) => void;
  _showSizePicker?: boolean;
}

const categoryLabels: Record<string, string> = {
  basic: "Basic Blocks",
  lists: "Lists",
  media: "Media",
  advanced: "Advanced",
};

const insertItems: InsertItem[] = [
  {
    title: "Text",
    description: "Plain text paragraph",
    icon: <Type className="h-4 w-4" />,
    category: "basic",
    insert: (editor, pos) => {
      editor
        .chain()
        .focus()
        .insertContentAt(pos, { type: "paragraph" })
        .setTextSelection(pos + 1)
        .run();
    },
  },
  {
    title: "Heading 1",
    description: "Large section heading",
    icon: <Heading1 className="h-4 w-4" />,
    category: "basic",
    shortcut: "Ctrl+Alt+1",
    insert: (editor, pos) => {
      editor
        .chain()
        .focus()
        .insertContentAt(pos, { type: "heading", attrs: { level: 1 } })
        .setTextSelection(pos + 1)
        .run();
    },
  },
  {
    title: "Heading 2",
    description: "Medium section heading",
    icon: <Heading2 className="h-4 w-4" />,
    category: "basic",
    shortcut: "Ctrl+Alt+2",
    insert: (editor, pos) => {
      editor
        .chain()
        .focus()
        .insertContentAt(pos, { type: "heading", attrs: { level: 2 } })
        .setTextSelection(pos + 1)
        .run();
    },
  },
  {
    title: "Heading 3",
    description: "Small section heading",
    icon: <Heading3 className="h-4 w-4" />,
    category: "basic",
    shortcut: "Ctrl+Alt+3",
    insert: (editor, pos) => {
      editor
        .chain()
        .focus()
        .insertContentAt(pos, { type: "heading", attrs: { level: 3 } })
        .setTextSelection(pos + 1)
        .run();
    },
  },
  {
    title: "Quote",
    description: "Create a blockquote",
    icon: <Quote className="h-4 w-4" />,
    category: "basic",
    shortcut: "Ctrl+Shift+B",
    insert: (editor, pos) => {
      editor
        .chain()
        .focus()
        .insertContentAt(pos, { type: "blockquote", content: [{ type: "paragraph" }] })
        .setTextSelection(pos + 2)
        .run();
    },
  },
  {
    title: "Callout",
    description: "Highlighted info or warning block",
    icon: <MessageSquareQuote className="h-4 w-4" />,
    category: "basic",
    insert: (editor, pos) => {
      editor
        .chain()
        .focus()
        .insertContentAt(pos, {
          type: "callout",
          attrs: { type: "info" },
          content: [{ type: "paragraph" }],
        })
        .setTextSelection(pos + 2)
        .run();
    },
  },
  {
    title: "Toggle",
    description: "Collapsible content block",
    icon: <ChevronRight className="h-4 w-4" />,
    category: "basic",
    insert: (editor, pos) => {
      editor
        .chain()
        .focus()
        .insertContentAt(pos, {
          type: "toggle",
          content: [{ type: "paragraph" }],
        })
        .setTextSelection(pos + 2)
        .run();
    },
  },
  {
    title: "Table of Contents",
    description: "Auto-generated from headings",
    icon: <TableOfContents className="h-4 w-4" />,
    category: "basic",
    insert: (editor, pos) => {
      editor.chain().focus().insertContentAt(pos, { type: "tableOfContents" }).run();
    },
  },
  {
    title: "Divider",
    description: "Insert a horizontal divider",
    icon: <Minus className="h-4 w-4" />,
    category: "basic",
    shortcut: "---",
    insert: (editor, pos) => {
      editor
        .chain()
        .focus()
        .insertContentAt(pos, [{ type: "horizontalRule" }, { type: "paragraph" }])
        .run();
    },
  },
  // Lists
  {
    title: "Bullet List",
    description: "Create a simple bullet list",
    icon: <List className="h-4 w-4" />,
    category: "lists",
    shortcut: "Ctrl+Shift+8",
    insert: (editor, pos) => {
      editor
        .chain()
        .focus()
        .insertContentAt(pos, {
          type: "bulletList",
          content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
        })
        .setTextSelection(pos + 3)
        .run();
    },
  },
  {
    title: "Numbered List",
    description: "Create a numbered list",
    icon: <ListOrdered className="h-4 w-4" />,
    category: "lists",
    shortcut: "Ctrl+Shift+7",
    insert: (editor, pos) => {
      editor
        .chain()
        .focus()
        .insertContentAt(pos, {
          type: "orderedList",
          content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
        })
        .setTextSelection(pos + 3)
        .run();
    },
  },
  {
    title: "Task List",
    description: "Create a task list with checkboxes",
    icon: <ListTodo className="h-4 w-4" />,
    category: "lists",
    shortcut: "Ctrl+Shift+9",
    insert: (editor, pos) => {
      editor
        .chain()
        .focus()
        .insertContentAt(pos, {
          type: "taskList",
          content: [
            { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph" }] },
          ],
        })
        .setTextSelection(pos + 3)
        .run();
    },
  },
  // Media
  {
    title: "Image",
    description: "Upload or embed an image",
    // eslint-disable-next-line jsx-a11y/alt-text -- Lucide icon, not img element
    icon: <Image className="h-4 w-4" />,
    category: "media",
    insert: (editor, pos) => {
      // Insert an empty paragraph first, then open the image modal
      editor
        .chain()
        .focus()
        .insertContentAt(pos, { type: "paragraph" })
        .setTextSelection(pos + 1)
        .run();

      const { openImageModal } = useEditorStore.getState();
      openImageModal((url, alt) => {
        const { $from } = editor.state.selection;
        const isEmptyParagraph =
          $from.parent.type.name === "paragraph" && $from.parent.content.size === 0;

        if (isEmptyParagraph) {
          editor
            .chain()
            .focus()
            .insertContentAt({ from: $from.before($from.depth), to: $from.after($from.depth) }, [
              { type: "image", attrs: { src: url, alt } },
              { type: "paragraph" },
            ])
            .run();
        } else {
          editor
            .chain()
            .focus()
            .insertContent([{ type: "image", attrs: { src: url, alt } }, { type: "paragraph" }])
            .run();
        }
      });
    },
  },
  {
    title: "Table",
    description: "Insert a table",
    icon: <Table className="h-4 w-4" />,
    category: "media",
    // Table uses a size picker sub-view — insert is handled via subView state
    insert: () => {},
    _showSizePicker: true,
  },
  // Advanced
  {
    title: "Code Block",
    description: "Create a code block",
    icon: <Code className="h-4 w-4" />,
    category: "advanced",
    shortcut: "Ctrl+Alt+C",
    insert: (editor, pos) => {
      editor.chain().focus().insertContentAt(pos, { type: "codeBlock" }).run();
    },
  },
  {
    title: "Math Block",
    description: "Insert a block math equation",
    icon: <Sigma className="h-4 w-4" />,
    category: "advanced",
    insert: (editor, pos) => {
      editor
        .chain()
        .focus()
        .insertContentAt(pos, { type: "blockMath", attrs: { latex: "" } })
        .run();
    },
  },
  {
    title: "Inline Math",
    description: "Insert inline math expression",
    icon: <span className="flex h-4 w-4 items-center justify-center font-serif text-sm">x²</span>,
    category: "advanced",
    insert: (editor, pos) => {
      // Insert paragraph with inline math inside
      editor
        .chain()
        .focus()
        .insertContentAt(pos, {
          type: "paragraph",
          content: [{ type: "inlineMath", attrs: { latex: "" } }],
        })
        .run();
    },
  },
];

export function BlockInsertMenu({ editor, insertAfterPos, anchor, onClose }: BlockInsertMenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [subView, setSubView] = useState<"table-size" | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Filter items by query
  const filteredItems = query
    ? insertItems.filter(
        (item) =>
          item.title.toLowerCase().includes(query.toLowerCase()) ||
          item.description.toLowerCase().includes(query.toLowerCase())
      )
    : insertItems;

  // Reset selection when items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Focus input on mount
  useEffect(() => {
    // Small delay to avoid the mousedown event from the + button closing the menu
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 10);
    return () => clearTimeout(timer);
  }, []);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Use setTimeout to avoid the + button's mousedown closing the menu immediately
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  const handleTableSizeSelect = useCallback(
    (rows: number, cols: number) => {
      try {
        const node = editor.state.doc.nodeAt(insertAfterPos);
        if (!node) return;

        const isEmptyParagraph = node.type.name === "paragraph" && node.content.size === 0;

        if (isEmptyParagraph) {
          const tr = editor.state.tr;
          tr.delete(insertAfterPos, insertAfterPos + node.nodeSize);
          editor.view.dispatch(tr);
          editor
            .chain()
            .focus()
            .insertContentAt(insertAfterPos, { type: "paragraph" })
            .setTextSelection(insertAfterPos + 1)
            .run();
        } else {
          const insertPos = insertAfterPos + node.nodeSize;
          editor
            .chain()
            .focus()
            .insertContentAt(insertPos, { type: "paragraph" })
            .setTextSelection(insertPos + 1)
            .run();
        }
        editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
      } catch {
        // Position invalid
      }
      onClose();
    },
    [editor, insertAfterPos, onClose]
  );

  const selectItem = useCallback(
    (index: number) => {
      const item = filteredItems[index];
      if (!item) return;

      // Show table size picker sub-view instead of inserting directly
      if (item._showSizePicker) {
        setSubView("table-size");
        return;
      }

      try {
        const node = editor.state.doc.nodeAt(insertAfterPos);
        if (!node) return;

        // Notion behavior: if the hovered block is an empty paragraph,
        // replace it with the selected type (same line).
        // Otherwise, insert a new block below.
        const isEmptyParagraph = node.type.name === "paragraph" && node.content.size === 0;

        if (isEmptyParagraph) {
          // Delete the empty paragraph first, then insert at its position
          const tr = editor.state.tr;
          tr.delete(insertAfterPos, insertAfterPos + node.nodeSize);
          editor.view.dispatch(tr);
          item.insert(editor, insertAfterPos);
        } else {
          const insertPos = insertAfterPos + node.nodeSize;
          item.insert(editor, insertPos);
        }
      } catch {
        // Position invalid
      }

      onClose();
    },
    [editor, filteredItems, insertAfterPos, onClose]
  );

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          if (subView) {
            setSubView(null);
          } else {
            onClose();
          }
          break;
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % filteredItems.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length);
          break;
        case "Enter":
          e.preventDefault();
          selectItem(selectedIndex);
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, filteredItems.length, selectedIndex, selectItem, subView]);

  // Scroll selected item into view
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const items = container.querySelectorAll("[data-insert-item]");
    const selected = items[selectedIndex] as HTMLElement | undefined;
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  // Position: ensure it stays in viewport
  const adjustedPosition = {
    x: Math.max(8, Math.min(anchor.x, window.innerWidth - 280)),
    y: Math.min(anchor.y, window.innerHeight - 400),
  };

  // Group items by category
  const groupedItems: { category: string; items: { item: InsertItem; globalIndex: number }[] }[] =
    [];
  let currentCategory = "";
  filteredItems.forEach((item, globalIndex) => {
    if (item.category !== currentCategory) {
      currentCategory = item.category;
      groupedItems.push({ category: item.category, items: [] });
    }
    groupedItems[groupedItems.length - 1].items.push({ item, globalIndex });
  });

  return createPortal(
    <div
      ref={menuRef}
      className={cn(
        "fixed z-[100] w-[260px] rounded-lg border border-border bg-popover shadow-xl",
        "animate-in fade-in-0 zoom-in-95"
      )}
      style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
      role="menu"
      aria-label="Insert block"
    >
      {/* Table size picker sub-view */}
      {subView === "table-size" ? (
        <div className="p-1">
          <button
            type="button"
            onClick={() => setSubView(null)}
            className="mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent/50"
          >
            ← Back
          </button>
          <div className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Table Size
          </div>
          <TableSizePicker onSelect={handleTableSizeSelect} />
        </div>
      ) : (
        /* Scrollable command list */
        <div ref={scrollRef} className="max-h-[320px] overflow-y-auto p-1">
          {filteredItems.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">No results</div>
          )}

          {groupedItems.map((group, groupIndex) => (
            <div key={group.category}>
              {groupIndex > 0 && <div className="mx-1 my-1 h-px bg-border" />}
              <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {categoryLabels[group.category] ?? group.category}
              </div>
              {group.items.map(({ item, globalIndex }) => (
                <button
                  key={item.title}
                  data-insert-item
                  type="button"
                  onClick={() => selectItem(globalIndex)}
                  onMouseEnter={() => setSelectedIndex(globalIndex)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm",
                    globalIndex === selectedIndex
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50"
                  )}
                  role="menuitem"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                    {item.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </div>
                  {item.shortcut && (
                    <span className="shrink-0 text-[10px] text-muted-foreground/60">
                      {formatShortcut(item.shortcut)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Filter input at bottom (like Notion) — hidden in sub-views */}
      {!subView && (
        <div className="border-t border-border px-2 py-1.5">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type to filter..."
            className="w-full bg-transparent text-xs text-muted-foreground placeholder:text-muted-foreground/50 focus:outline-none"
          />
        </div>
      )}
    </div>,
    document.body
  );
}
