import { Extension } from "@tiptap/core";
import type { Editor, Range } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import { computePosition, flip, shift, offset } from "@floating-ui/dom";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import {
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
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
  GitBranch,
  Columns2,
  Columns3,
  Columns4,
  Bookmark,
  FileText,
  Globe,
} from "lucide-react";
import { cn, formatShortcut } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor-store";

import { Palette, Table2, LayoutGrid, GalleryHorizontalEnd } from "lucide-react";

interface CommandItem {
  title: string;
  description: string;
  icon: React.ReactNode;
  category: "basic" | "lists" | "media" | "database" | "layout" | "advanced" | "turninto" | "color";
  shortcut?: string;
  command: (props: { editor: Editor; range: Range }) => void;
}

const categoryLabels: Record<string, string> = {
  basic: "Basic Blocks",
  lists: "Lists",
  media: "Media",
  database: "Database",
  layout: "Layout",
  advanced: "Advanced",
  turninto: "Turn Into",
  color: "Color",
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
    title: "Heading 4",
    description: "Extra small heading",
    icon: <Heading4 className="h-4 w-4" />,
    category: "basic",
    shortcut: "Ctrl+Alt+4",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 4 }).run();
    },
  },
  {
    title: "Heading 5",
    description: "Minor heading",
    icon: <Heading5 className="h-4 w-4" />,
    category: "basic",
    shortcut: "Ctrl+Alt+5",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 5 }).run();
    },
  },
  {
    title: "Heading 6",
    description: "Smallest heading",
    icon: <Heading6 className="h-4 w-4" />,
    category: "basic",
    shortcut: "Ctrl+Alt+6",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 6 }).run();
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
  {
    title: "Link to Page",
    description: "Link to an existing page",
    icon: <FileText className="h-4 w-4" />,
    category: "basic",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      const { openPagePicker } = useEditorStore.getState();
      openPagePicker((attrs) => {
        editor.chain().focus().setPageLink(attrs).run();
      });
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
  {
    title: "Web Bookmark",
    description: "Save a link as a visual bookmark",
    icon: <Bookmark className="h-4 w-4" />,
    category: "media",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      const { openBookmarkModal } = useEditorStore.getState();
      openBookmarkModal((attrs) => {
        editor
          .chain()
          .focus()
          .setWebBookmark({
            url: attrs.url,
            title: attrs.title,
            description: attrs.description,
            faviconUrl: attrs.faviconUrl,
            imageUrl: attrs.imageUrl,
          })
          .run();
      });
    },
  },

  // Database views
  {
    title: "Table view",
    description: "Add a table view for a new or existing data source",
    icon: <Table2 className="h-4 w-4" />,
    category: "database",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertDatabaseBlock().run();
    },
  },
  {
    title: "Board view",
    description: "Add a Kanban board view grouped by status",
    icon: <LayoutGrid className="h-4 w-4" />,
    category: "database",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertDatabaseBlock(undefined, "board").run();
    },
  },
  {
    title: "Gallery view",
    description: "Add a gallery view with card layout",
    icon: <GalleryHorizontalEnd className="h-4 w-4" />,
    category: "database",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertDatabaseBlock(undefined, "gallery").run();
    },
  },
  {
    title: "List view",
    description: "Add a simple list view",
    icon: <List className="h-4 w-4" />,
    category: "database",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertDatabaseBlock(undefined, "list").run();
    },
  },

  // Layout
  {
    title: "2 Columns",
    description: "Split into two side-by-side columns",
    icon: <Columns2 className="h-4 w-4" />,
    category: "layout",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setColumns(2).run();
    },
  },
  {
    title: "3 Columns",
    description: "Split into three columns",
    icon: <Columns3 className="h-4 w-4" />,
    category: "layout",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setColumns(3).run();
    },
  },
  {
    title: "4 Columns",
    description: "Split into four columns",
    icon: <Columns4 className="h-4 w-4" />,
    category: "layout",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setColumns(4).run();
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
    title: "Mermaid Chart",
    description: "Insert a diagram or chart",
    icon: <GitBranch className="h-4 w-4" />,
    category: "advanced",
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "mermaidChart",
          attrs: { code: "" },
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

  // Turn Into (only shown when query matches "turn")
  {
    title: "Turn into Text",
    description: "Convert to plain text",
    icon: <Type className="h-4 w-4" />,
    category: "turninto",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setParagraph().run();
    },
  },
  {
    title: "Turn into Heading 1",
    description: "Convert to large heading",
    icon: <Heading1 className="h-4 w-4" />,
    category: "turninto",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run();
    },
  },
  {
    title: "Turn into Heading 2",
    description: "Convert to medium heading",
    icon: <Heading2 className="h-4 w-4" />,
    category: "turninto",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run();
    },
  },
  {
    title: "Turn into Heading 3",
    description: "Convert to small heading",
    icon: <Heading3 className="h-4 w-4" />,
    category: "turninto",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run();
    },
  },
  {
    title: "Turn into Heading 4",
    description: "Convert to extra small heading",
    icon: <Heading4 className="h-4 w-4" />,
    category: "turninto",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 4 }).run();
    },
  },
  {
    title: "Turn into Heading 5",
    description: "Convert to minor heading",
    icon: <Heading5 className="h-4 w-4" />,
    category: "turninto",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 5 }).run();
    },
  },
  {
    title: "Turn into Heading 6",
    description: "Convert to smallest heading",
    icon: <Heading6 className="h-4 w-4" />,
    category: "turninto",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 6 }).run();
    },
  },
  {
    title: "Turn into Quote",
    description: "Convert to blockquote",
    icon: <Quote className="h-4 w-4" />,
    category: "turninto",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run();
    },
  },
  {
    title: "Turn into Callout",
    description: "Convert to callout block",
    icon: <MessageSquareQuote className="h-4 w-4" />,
    category: "turninto",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setCallout({ type: "info" }).run();
    },
  },
  {
    title: "Turn into Toggle",
    description: "Convert to collapsible toggle",
    icon: <ChevronRight className="h-4 w-4" />,
    category: "turninto",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setToggle().run();
    },
  },

  // Color (only shown when query matches "color" or specific color names)
  {
    title: "Red background",
    description: "Apply red background to block",
    icon: <div className="h-4 w-4 rounded-sm border border-red-300 bg-red-200" />,
    category: "color",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      const nodeType = editor.state.selection.$from.parent.type.name;
      editor.chain().updateAttributes(nodeType, { backgroundColor: "#fee2e2" }).run();
    },
  },
  {
    title: "Blue background",
    description: "Apply blue background to block",
    icon: <div className="h-4 w-4 rounded-sm border border-blue-300 bg-blue-200" />,
    category: "color",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      const nodeType = editor.state.selection.$from.parent.type.name;
      editor.chain().updateAttributes(nodeType, { backgroundColor: "#dbeafe" }).run();
    },
  },
  {
    title: "Green background",
    description: "Apply green background to block",
    icon: <div className="h-4 w-4 rounded-sm border border-green-300 bg-green-200" />,
    category: "color",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      const nodeType = editor.state.selection.$from.parent.type.name;
      editor.chain().updateAttributes(nodeType, { backgroundColor: "#dcfce7" }).run();
    },
  },
  {
    title: "Yellow background",
    description: "Apply yellow background to block",
    icon: <div className="h-4 w-4 rounded-sm border border-yellow-300 bg-yellow-200" />,
    category: "color",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      const nodeType = editor.state.selection.$from.parent.type.name;
      editor.chain().updateAttributes(nodeType, { backgroundColor: "#fef3c7" }).run();
    },
  },
  {
    title: "Purple background",
    description: "Apply purple background to block",
    icon: <div className="h-4 w-4 rounded-sm border border-purple-300 bg-purple-200" />,
    category: "color",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      const nodeType = editor.state.selection.$from.parent.type.name;
      editor.chain().updateAttributes(nodeType, { backgroundColor: "#f3e8ff" }).run();
    },
  },
  {
    title: "Gray background",
    description: "Apply gray background to block",
    icon: <div className="h-4 w-4 rounded-sm border border-gray-300 bg-gray-200" />,
    category: "color",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      const nodeType = editor.state.selection.$from.parent.type.name;
      editor.chain().updateAttributes(nodeType, { backgroundColor: "#f3f4f6" }).run();
    },
  },
  {
    title: "No background",
    description: "Remove block background color",
    icon: <Palette className="h-4 w-4" />,
    category: "color",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      const nodeType = editor.state.selection.$from.parent.type.name;
      editor.chain().updateAttributes(nodeType, { backgroundColor: null }).run();
    },
  },
];

// ---------------------------------------------------------------------------
// Preview card for slash command menu
// ---------------------------------------------------------------------------

function getPreviewContent(item: CommandItem): React.ReactNode {
  const title = item.title.replace(/^Turn into\s+/i, "");

  switch (title) {
    case "Text":
      return (
        <div className="space-y-1.5 text-[13px] leading-relaxed text-popover-foreground/80">
          <p>Start writing with plain text. Use commands to add formatting and blocks.</p>
        </div>
      );

    case "Heading 1":
      return (
        <div className="space-y-1">
          <p className="text-[20px] font-bold leading-tight text-popover-foreground">
            Large section heading
          </p>
          <p className="text-[11px] text-muted-foreground">Used for major document sections</p>
        </div>
      );

    case "Heading 2":
      return (
        <div className="space-y-1">
          <p className="text-[17px] font-bold leading-tight text-popover-foreground">
            Medium section heading
          </p>
          <p className="text-[11px] text-muted-foreground">Used for sub-sections</p>
        </div>
      );

    case "Heading 3":
      return (
        <div className="space-y-1">
          <p className="text-[15px] font-semibold leading-tight text-popover-foreground">
            Small section heading
          </p>
          <p className="text-[11px] text-muted-foreground">Used for nested sections</p>
        </div>
      );

    case "Heading 4":
      return (
        <div className="space-y-1">
          <p className="text-[14px] font-semibold leading-tight text-popover-foreground">
            Extra small heading
          </p>
          <p className="text-[11px] text-muted-foreground">Minor section divider</p>
        </div>
      );

    case "Heading 5":
      return (
        <div className="space-y-1">
          <p className="text-[13px] font-semibold leading-tight text-popover-foreground">
            Minor heading
          </p>
          <p className="text-[11px] text-muted-foreground">Small section label</p>
        </div>
      );

    case "Heading 6":
      return (
        <div className="space-y-1">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-popover-foreground">
            Smallest heading
          </p>
          <p className="text-[11px] text-muted-foreground">Fine-grained section label</p>
        </div>
      );

    case "Quote":
      return (
        <div className="border-l-[3px] border-popover-foreground/20 pl-3">
          <p className="text-[13px] italic leading-relaxed text-muted-foreground">
            &ldquo;The only way to do great work is to love what you do.&rdquo;
          </p>
        </div>
      );

    case "Callout":
      return (
        <div className="rounded-md border border-blue-200/50 bg-blue-50/50 p-2 dark:border-blue-800/50 dark:bg-blue-950/30">
          <div className="flex items-start gap-2">
            <span className="text-sm">&#x2139;&#xfe0f;</span>
            <p className="text-[12px] leading-relaxed text-popover-foreground/80">
              Highlighted information or important note
            </p>
          </div>
        </div>
      );

    case "Toggle":
      return (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-[13px] font-medium text-popover-foreground">Toggle heading</p>
          </div>
          <div className="ml-5 rounded border border-dashed border-border/60 px-2 py-1">
            <p className="text-[11px] text-muted-foreground">Hidden content inside...</p>
          </div>
        </div>
      );

    case "Table of Contents":
      return (
        <div className="space-y-1 text-[12px]">
          <p className="font-medium text-popover-foreground">Table of Contents</p>
          <div className="space-y-0.5 pl-1 text-muted-foreground">
            <p>&#x2022; Introduction</p>
            <p className="pl-3">&#x2022; Getting Started</p>
            <p className="pl-6">&#x2022; Installation</p>
          </div>
        </div>
      );

    case "Divider":
      return (
        <div className="flex flex-col items-center gap-2 py-2">
          <p className="text-[11px] text-muted-foreground">Content above</p>
          <hr className="w-full border-border" />
          <p className="text-[11px] text-muted-foreground">Content below</p>
        </div>
      );

    case "Bullet List":
      return (
        <div className="space-y-1 pl-1 text-[12px] text-popover-foreground/80">
          <p>&#x2022; First bullet point</p>
          <p>&#x2022; Second bullet point</p>
          <p>&#x2022; Third bullet point</p>
        </div>
      );

    case "Numbered List":
      return (
        <div className="space-y-1 pl-1 text-[12px] text-popover-foreground/80">
          <p>1. First item</p>
          <p>2. Second item</p>
          <p>3. Third item</p>
        </div>
      );

    case "Task List":
      return (
        <div className="space-y-1 text-[12px] text-popover-foreground/80">
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-sm border border-muted-foreground/40" />
            <span>Todo item</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex h-3 w-3 items-center justify-center rounded-sm bg-primary text-[8px] text-primary-foreground">
              &#x2713;
            </div>
            <span className="line-through opacity-60">Completed item</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-sm border border-muted-foreground/40" />
            <span>Another todo</span>
          </div>
        </div>
      );

    case "Image":
      return (
        <div className="flex flex-col items-center gap-1.5 rounded-md border border-dashed border-border/70 p-3">
          {/* eslint-disable-next-line jsx-a11y/alt-text -- Lucide icon, not img */}
          <Image className="h-6 w-6 text-muted-foreground/50" />
          <p className="text-[11px] text-muted-foreground">Upload or embed an image</p>
        </div>
      );

    case "Table":
      return (
        <div className="overflow-hidden rounded border border-border/70 text-[11px]">
          <div className="flex bg-muted/50">
            <div className="flex-1 border-r border-border/50 px-2 py-1 font-medium">Header</div>
            <div className="flex-1 border-r border-border/50 px-2 py-1 font-medium">Header</div>
            <div className="flex-1 px-2 py-1 font-medium">Header</div>
          </div>
          <div className="flex border-t border-border/50">
            <div className="flex-1 border-r border-border/50 px-2 py-1 text-muted-foreground">
              Cell
            </div>
            <div className="flex-1 border-r border-border/50 px-2 py-1 text-muted-foreground">
              Cell
            </div>
            <div className="flex-1 px-2 py-1 text-muted-foreground">Cell</div>
          </div>
          <div className="flex border-t border-border/50">
            <div className="flex-1 border-r border-border/50 px-2 py-1 text-muted-foreground">
              Cell
            </div>
            <div className="flex-1 border-r border-border/50 px-2 py-1 text-muted-foreground">
              Cell
            </div>
            <div className="flex-1 px-2 py-1 text-muted-foreground">Cell</div>
          </div>
        </div>
      );

    case "2 Columns":
      return (
        <div className="flex gap-1.5">
          <div className="flex-1 rounded border border-border/60 bg-muted/30 px-2 py-3">
            <div className="h-1 w-3/4 rounded bg-muted-foreground/20" />
          </div>
          <div className="flex-1 rounded border border-border/60 bg-muted/30 px-2 py-3">
            <div className="h-1 w-3/4 rounded bg-muted-foreground/20" />
          </div>
        </div>
      );

    case "3 Columns":
      return (
        <div className="flex gap-1">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex-1 rounded border border-border/60 bg-muted/30 px-1.5 py-3">
              <div className="h-1 w-3/4 rounded bg-muted-foreground/20" />
            </div>
          ))}
        </div>
      );

    case "4 Columns":
      return (
        <div className="flex gap-0.5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex-1 rounded border border-border/60 bg-muted/30 px-1 py-3">
              <div className="h-1 w-3/4 rounded bg-muted-foreground/20" />
            </div>
          ))}
        </div>
      );

    case "Code Block":
      return (
        <div className="rounded-md bg-zinc-900 p-2.5 font-mono text-[11px] leading-relaxed text-zinc-300 dark:bg-zinc-800">
          <p>
            <span className="text-purple-400">const</span>{" "}
            <span className="text-blue-300">hello</span> <span className="text-zinc-500">=</span>{" "}
            <span className="text-green-400">&quot;world&quot;</span>;
          </p>
        </div>
      );

    case "Math Block":
      return (
        <div className="flex items-center justify-center rounded-md border border-border/50 bg-muted/30 p-3">
          <p className="font-serif text-[16px] italic text-popover-foreground">E = mc&sup2;</p>
        </div>
      );

    case "Mermaid Chart":
      return (
        <div className="rounded-md border border-border/50 bg-muted/30 p-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
          <p>graph LR</p>
          <p className="pl-2">A[&quot;Start&quot;] --&gt; B[&quot;End&quot;]</p>
        </div>
      );

    case "Inline Math":
      return (
        <div className="text-[13px] leading-relaxed text-popover-foreground/80">
          <p>
            The formula{" "}
            <span className="rounded bg-muted/50 px-1 font-serif italic">
              x&sup2; + y&sup2; = r&sup2;
            </span>{" "}
            appears inline with text.
          </p>
        </div>
      );

    case "Web Bookmark":
      return (
        <div className="overflow-hidden rounded-md border border-border/70">
          <div className="flex items-start gap-2 p-2">
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-[12px] font-medium text-popover-foreground">
                Netscape (web browser)
              </p>
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Netscape is the general name for a web browser...
              </p>
              <div className="flex items-center gap-1">
                <Globe className="h-2.5 w-2.5 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">en.wikipedia.org</span>
              </div>
            </div>
            <div className="h-10 w-14 shrink-0 rounded bg-muted" />
          </div>
        </div>
      );

    case "Link to Page":
      return (
        <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
          <span className="text-base">&#x1f4cb;</span>
          <span className="text-[13px] text-popover-foreground underline underline-offset-2">
            Tasks
          </span>
        </div>
      );

    case "Table view":
      return (
        <div className="overflow-hidden rounded border border-border/70 text-[11px]">
          <div className="flex bg-muted/50">
            <div className="w-[45%] border-r border-border/50 px-2 py-1 font-medium">Aa Name</div>
            <div className="flex-1 px-2 py-1 font-medium">&#x25cf; Status</div>
          </div>
          {[
            {
              name: "Mary Meeks",
              status: "Scheduled",
              color: "bg-amber-200 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200",
            },
            {
              name: "Mitch Cohn",
              status: "Engaged",
              color: "bg-green-200 text-green-800 dark:bg-green-900/50 dark:text-green-200",
            },
            {
              name: "Kim Saunders",
              status: "Engaged",
              color: "bg-green-200 text-green-800 dark:bg-green-900/50 dark:text-green-200",
            },
          ].map((row) => (
            <div key={row.name} className="flex border-t border-border/50">
              <div className="w-[45%] border-r border-border/50 px-2 py-1 text-muted-foreground">
                {row.name}
              </div>
              <div className="flex-1 px-2 py-1">
                <span
                  className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${row.color}`}
                >
                  {row.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      );

    case "Board view":
      return (
        <div className="flex gap-1.5">
          {[
            { label: "Todo", items: 2, color: "bg-zinc-200 dark:bg-zinc-700" },
            { label: "In Progress", items: 1, color: "bg-blue-200 dark:bg-blue-900/50" },
            { label: "Done", items: 2, color: "bg-green-200 dark:bg-green-900/50" },
          ].map((col) => (
            <div key={col.label} className="flex-1 space-y-1">
              <div className="flex items-center gap-1 px-0.5">
                <div className={`h-1.5 w-1.5 rounded-full ${col.color}`} />
                <span className="text-[10px] font-medium text-muted-foreground">{col.label}</span>
              </div>
              {Array.from({ length: col.items }).map((_, i) => (
                <div key={i} className="rounded border border-border/60 bg-background p-1.5">
                  <div className="h-1 w-4/5 rounded bg-muted-foreground/15" />
                  <div className="mt-1 h-1 w-2/5 rounded bg-muted-foreground/10" />
                </div>
              ))}
            </div>
          ))}
        </div>
      );

    case "Gallery view":
      return (
        <div className="grid grid-cols-2 gap-1.5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="overflow-hidden rounded border border-border/60">
              <div className="h-8 bg-muted/50" />
              <div className="p-1.5">
                <div className="h-1 w-3/4 rounded bg-muted-foreground/20" />
                <div className="mt-1 h-1 w-1/2 rounded bg-muted-foreground/10" />
              </div>
            </div>
          ))}
        </div>
      );

    case "List view":
      return (
        <div className="space-y-0.5 text-[11px]">
          {["Meeting notes", "Project plan", "Design spec", "Weekly review"].map((name) => (
            <div
              key={name}
              className="flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-muted/30"
            >
              <FileText className="h-3 w-3 text-muted-foreground/50" />
              <span className="text-popover-foreground/80">{name}</span>
            </div>
          ))}
        </div>
      );

    default:
      // Color backgrounds
      if (item.category === "color") {
        const colorMap: Record<string, string> = {
          "Red background": "#fee2e2",
          "Blue background": "#dbeafe",
          "Green background": "#dcfce7",
          "Yellow background": "#fef3c7",
          "Purple background": "#f3e8ff",
          "Gray background": "#f3f4f6",
        };
        const bg = colorMap[item.title];
        if (bg) {
          return (
            <div className="rounded-md p-2.5" style={{ backgroundColor: bg }}>
              <p className="text-[12px] text-zinc-700">
                Sample text with {item.title.toLowerCase()}
              </p>
            </div>
          );
        }
      }
      // Fallback: show description
      return (
        <p className="text-[13px] leading-relaxed text-muted-foreground">{item.description}</p>
      );
  }
}

function PreviewCard({ item }: { item: CommandItem }) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [flipToLeft, setFlipToLeft] = useState(false);

  useLayoutEffect(() => {
    if (!previewRef.current) return;
    const rect = previewRef.current.getBoundingClientRect();
    setFlipToLeft(rect.right > window.innerWidth - 8);
  }, [item]);

  return (
    <div
      ref={previewRef}
      className={cn(
        "absolute top-0 hidden w-[220px] rounded-xl border border-border/70 bg-popover p-3 shadow-xl md:block",
        flipToLeft ? "right-full mr-2" : "left-full ml-2"
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-5 w-5 items-center justify-center text-muted-foreground">
          {item.icon}
        </div>
        <span className="text-[12px] font-semibold text-muted-foreground/80">{item.title}</span>
      </div>
      <div className="mb-2.5 h-px bg-border" />
      <div className="pointer-events-none select-none">{getPreviewContent(item)}</div>
    </div>
  );
}

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
    <div className="relative">
      <div className="w-[420px] overflow-hidden rounded-xl border border-border/70 bg-popover shadow-xl">
        <div
          ref={scrollContainerRef}
          className="max-h-[360px] overflow-y-auto overflow-x-hidden p-1.5"
        >
          {groupedItems.map((group, groupIndex) => (
            <div key={`${group.category}-${groupIndex}`}>
              {/* Category separator */}
              {groupIndex > 0 && <div className="mx-1 my-1 h-px bg-border" />}

              {/* Category header */}
              <div className="px-2 pb-0.5 pt-1 text-[12px] font-semibold text-muted-foreground/80">
                {categoryLabels[group.category] ?? group.category}
              </div>

              <div className="mx-1 my-1 h-px bg-border" />

              {/* Items */}
              {group.items.map(({ item, globalIndex }) => (
                <button
                  key={item.title}
                  data-command-item
                  onClick={() => selectItem(globalIndex)}
                  onMouseEnter={() => setSelectedIndex(globalIndex)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-2 py-1 text-left text-base",
                    globalIndex === selectedIndex
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50"
                  )}
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center text-muted-foreground">
                    {item.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{item.title}</p>
                  </div>
                  {item.shortcut && (
                    <span className="shrink-0 text-xs text-muted-foreground/65">
                      {formatShortcut(item.shortcut)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-border px-3 py-2 text-sm text-muted-foreground/85">
          <span>Close menu</span>
          <span>esc</span>
        </div>
      </div>
      {items[selectedIndex] && (
        <PreviewCard key={items[selectedIndex].title} item={items[selectedIndex]} />
      )}
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
        decorationContent: "/",
        decorationTag: "span",
        decorationClass: "slash-command-query",
        decorationEmptyClass: "slash-command-query-empty",
        items: ({ query }: { query: string }) => {
          const q = query.toLowerCase();
          return commands.filter((item) => {
            // Hide "Turn Into" and "Color" categories unless query specifically matches
            if (item.category === "turninto" || item.category === "color") {
              if (!q) return false; // Don't show by default
              // Only show when query starts with relevant keywords
              return (
                item.title.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)
              );
            }
            // Normal filtering for other categories
            return (
              item.title.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)
            );
          });
        },
        render: () => {
          let component: ReactRenderer<CommandListRef> | null = null;
          let wrapper: HTMLDivElement | null = null;
          let getClientRect: (() => DOMRect | null) | null = null;

          const updatePosition = () => {
            if (!wrapper || !getClientRect) return;
            const rect = getClientRect();
            if (!rect) return;

            const virtualEl = {
              getBoundingClientRect: () => rect,
            };

            computePosition(virtualEl, wrapper, {
              placement: "bottom-start",
              middleware: [offset(8), flip(), shift({ padding: 8 })],
            }).then(({ x, y }) => {
              if (wrapper) {
                Object.assign(wrapper.style, {
                  left: `${x}px`,
                  top: `${y}px`,
                });
              }
            });
          };

          return {
            onStart: (props: { editor: Editor; clientRect?: (() => DOMRect | null) | null }) => {
              component = new ReactRenderer(CommandList, {
                props,
                editor: props.editor,
              });

              if (!props.clientRect) return;

              getClientRect = props.clientRect;

              wrapper = document.createElement("div");
              wrapper.style.position = "absolute";
              wrapper.style.zIndex = "9999";
              wrapper.appendChild(component.element);
              document.body.appendChild(wrapper);

              updatePosition();
            },

            onUpdate: (props: { clientRect?: (() => DOMRect | null) | null }) => {
              component?.updateProps(props);

              if (props.clientRect) {
                getClientRect = props.clientRect;
                updatePosition();
              }
            },

            onKeyDown: (props: { event: KeyboardEvent }) => {
              if (props.event.key === "Escape") {
                if (wrapper) wrapper.style.display = "none";
                return true;
              }

              return component?.ref?.onKeyDown(props) ?? false;
            },

            onExit: () => {
              if (wrapper) {
                wrapper.remove();
                wrapper = null;
              }
              component?.destroy();
            },
          };
        },
      }),
    ];
  },
});
