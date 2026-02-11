import { Extension } from "@tiptap/core";
import type { Editor, Range } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import tippy, { Instance } from "tippy.js";
import { forwardRef, useEffect, useImperativeHandle, useState, useCallback, useRef } from "react";
import {
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
  Type,
  MessageSquareQuote,
  ChevronRight,
  TableOfContents,
} from "lucide-react";
import { cn, formatShortcut } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor-store";

interface CommandItem {
  title: string;
  description: string;
  icon: React.ReactNode;
  category: "basic" | "lists" | "media" | "advanced";
  shortcut?: string;
  command: (props: { editor: Editor; range: Range }) => void;
}

const categoryLabels: Record<string, string> = {
  basic: "Basic Blocks",
  lists: "Lists",
  media: "Media",
  advanced: "Advanced",
};

const commands: CommandItem[] = [
  // Basic Blocks
  {
    title: "Text",
    description: "Plain text paragraph",
    icon: <Type className="h-4 w-4" />,
    category: "basic",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setParagraph().run();
    },
  },
  {
    title: "Heading 1",
    description: "Large section heading",
    icon: <Heading1 className="h-4 w-4" />,
    category: "basic",
    shortcut: "Ctrl+Alt+1",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run();
    },
  },
  {
    title: "Heading 2",
    description: "Medium section heading",
    icon: <Heading2 className="h-4 w-4" />,
    category: "basic",
    shortcut: "Ctrl+Alt+2",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run();
    },
  },
  {
    title: "Heading 3",
    description: "Small section heading",
    icon: <Heading3 className="h-4 w-4" />,
    category: "basic",
    shortcut: "Ctrl+Alt+3",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run();
    },
  },
  {
    title: "Quote",
    description: "Create a blockquote",
    icon: <Quote className="h-4 w-4" />,
    category: "basic",
    shortcut: "Ctrl+Shift+B",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run();
    },
  },
  {
    title: "Callout",
    description: "Highlighted info or warning block",
    icon: <MessageSquareQuote className="h-4 w-4" />,
    category: "basic",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setCallout({ type: "info" }).run();
    },
  },
  {
    title: "Toggle",
    description: "Collapsible content block",
    icon: <ChevronRight className="h-4 w-4" />,
    category: "basic",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setToggle().run();
    },
  },
  {
    title: "Table of Contents",
    description: "Auto-generated from headings",
    icon: <TableOfContents className="h-4 w-4" />,
    category: "basic",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setTableOfContents().run();
    },
  },
  {
    title: "Divider",
    description: "Insert a horizontal divider",
    icon: <Minus className="h-4 w-4" />,
    category: "basic",
    shortcut: "---",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run();
    },
  },

  // Lists
  {
    title: "Bullet List",
    description: "Create a simple bullet list",
    icon: <List className="h-4 w-4" />,
    category: "lists",
    shortcut: "Ctrl+Shift+8",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    title: "Numbered List",
    description: "Create a numbered list",
    icon: <ListOrdered className="h-4 w-4" />,
    category: "lists",
    shortcut: "Ctrl+Shift+7",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
  {
    title: "Task List",
    description: "Create a task list with checkboxes",
    icon: <ListTodo className="h-4 w-4" />,
    category: "lists",
    shortcut: "Ctrl+Shift+9",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run();
    },
  },

  // Media
  {
    title: "Image",
    description: "Upload or embed an image",
    // eslint-disable-next-line jsx-a11y/alt-text -- This is a Lucide icon, not an img element
    icon: <Image className="h-4 w-4" />,
    category: "media",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      const { openImageModal } = useEditorStore.getState();
      openImageModal((url, alt) => {
        const { $from } = editor.state.selection;
        const isEmptyParagraph =
          $from.parent.type.name === "paragraph" && $from.parent.content.size === 0;

        if (isEmptyParagraph) {
          // Replace the empty paragraph left by deleteRange
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
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run();
    },
  },

  // Advanced
  {
    title: "Code Block",
    description: "Create a code block",
    icon: <Code className="h-4 w-4" />,
    category: "advanced",
    shortcut: "Ctrl+Alt+C",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
    },
  },
  {
    title: "Math Block",
    description: "Insert a block math equation",
    icon: <Sigma className="h-4 w-4" />,
    category: "advanced",
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "blockMath",
          attrs: { latex: "" },
        })
        .run();
    },
  },
  {
    title: "Inline Math",
    description: "Insert inline math expression",
    icon: <span className="flex h-4 w-4 items-center justify-center font-serif text-sm">x²</span>,
    category: "advanced",
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "inlineMath",
          attrs: { latex: "" },
        })
        .run();
    },
  },
];

interface CommandListProps {
  items: CommandItem[];
  command: (item: CommandItem) => void;
}

interface CommandListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

const CommandList = forwardRef<CommandListRef, CommandListProps>(({ items, command }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const selectItem = useCallback(
    (index: number) => {
      const item = items[index];
      if (item) {
        command(item);
      }
    },
    [items, command]
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  // Scroll selected item into view
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const buttons = container.querySelectorAll("[data-command-item]");
    const selected = buttons[selectedIndex] as HTMLElement | undefined;
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") {
        setSelectedIndex((prev) => (prev - 1 + items.length) % items.length);
        return true;
      }

      if (event.key === "ArrowDown") {
        setSelectedIndex((prev) => (prev + 1) % items.length);
        return true;
      }

      if (event.key === "Enter") {
        selectItem(selectedIndex);
        return true;
      }

      return false;
    },
  }));

  if (items.length === 0) {
    return <div className="p-2 text-sm text-muted-foreground">No results</div>;
  }

  // Group items by category while preserving order
  const groupedItems: { category: string; items: { item: CommandItem; globalIndex: number }[] }[] =
    [];
  let currentCategory = "";

  items.forEach((item, globalIndex) => {
    if (item.category !== currentCategory) {
      currentCategory = item.category;
      groupedItems.push({ category: item.category, items: [] });
    }
    groupedItems[groupedItems.length - 1].items.push({ item, globalIndex });
  });

  return (
    <div
      ref={scrollContainerRef}
      className="max-h-[320px] overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-popover p-1 shadow-lg"
    >
      {groupedItems.map((group, groupIndex) => (
        <div key={group.category}>
          {/* Category separator */}
          {groupIndex > 0 && <div className="mx-1 my-1 h-px bg-border" />}

          {/* Category header */}
          <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            {categoryLabels[group.category] ?? group.category}
          </div>

          {/* Items */}
          {group.items.map(({ item, globalIndex }) => (
            <button
              key={item.title}
              data-command-item
              onClick={() => selectItem(globalIndex)}
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm",
                globalIndex === selectedIndex
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50"
              )}
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
  );
});

CommandList.displayName = "CommandList";

export const SlashCommands = Extension.create({
  name: "slashCommands",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        command: ({
          editor,
          range,
          props,
        }: {
          editor: Editor;
          range: Range;
          props: CommandItem;
        }) => {
          props.command({ editor, range });
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
        items: ({ query }: { query: string }) => {
          return commands.filter(
            (item) =>
              item.title.toLowerCase().includes(query.toLowerCase()) ||
              item.description.toLowerCase().includes(query.toLowerCase())
          );
        },
        render: () => {
          let component: ReactRenderer<CommandListRef> | null = null;
          let popup: Instance[] | null = null;

          return {
            onStart: (props: { editor: Editor; clientRect?: (() => DOMRect | null) | null }) => {
              component = new ReactRenderer(CommandList, {
                props,
                editor: props.editor,
              });

              if (!props.clientRect) {
                return;
              }

              const clientRect = props.clientRect;
              popup = tippy("body", {
                getReferenceClientRect: () => clientRect() ?? new DOMRect(),
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: "bottom-start",
              });
            },

            onUpdate: (props: { clientRect?: (() => DOMRect | null) | null }) => {
              component?.updateProps(props);

              if (!props.clientRect) {
                return;
              }

              const clientRect = props.clientRect;
              popup?.[0]?.setProps({
                getReferenceClientRect: () => clientRect() ?? new DOMRect(),
              });
            },

            onKeyDown: (props: { event: KeyboardEvent }) => {
              if (props.event.key === "Escape") {
                popup?.[0]?.hide();
                return true;
              }

              return component?.ref?.onKeyDown(props) ?? false;
            },

            onExit: () => {
              popup?.[0]?.destroy();
              component?.destroy();
            },
          };
        },
      }),
    ];
  },
});
