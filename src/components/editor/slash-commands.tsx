import { Extension } from "@tiptap/core";
import type { Editor, Range } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import { computePosition, flip, shift, offset } from "@floating-ui/dom";
import {
  Fragment,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
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
  ChevronLeft,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor-store";

import { Palette, Table2, LayoutGrid, GalleryHorizontalEnd } from "lucide-react";

interface CommandSubItem {
  titleKey: string;
  icon: React.ReactNode;
  command: (props: { editor: Editor; range: Range }) => void;
}

interface CommandItem {
  title: string;
  description: string;
  titleKey: string;
  menuTitleKey?: string;
  descKey: string;
  icon: React.ReactNode;
  category: "basic" | "lists" | "media" | "database" | "layout" | "advanced" | "turninto" | "color";
  shortcut?: string;
  menuShortcut?: string;
  searchOnly?: boolean;
  hasSubItems?: boolean;
  subItems?: CommandSubItem[];
  searchKeywords?: string[];
  command: (props: { editor: Editor; range: Range }) => void;
}

/**
 * Feature flag: database blocks are still in internal beta. Flip to `true`
 * to expose them in the slash menu (and search results) again.
 */
const ENABLE_DATABASE_BLOCKS = false;

const categoryLabelKeys: Record<string, string> = {
  basic: "slashMenu.categories.basic",
  lists: "slashMenu.categories.lists",
  media: "slashMenu.categories.media",
  database: "slashMenu.categories.database",
  layout: "slashMenu.categories.layout",
  advanced: "slashMenu.categories.advanced",
  turninto: "slashMenu.categories.turninto",
  color: "slashMenu.categories.color",
};

const notionBasicOrder = new Map<string, number>([
  ["Text", 0],
  ["Heading 1", 1],
  ["Heading 2", 2],
  ["Heading 3", 3],
  ["Heading 4", 4],
  ["Heading 5", 5],
  ["Heading 6", 6],
  ["Bullet List", 7],
  ["Numbered List", 8],
  ["Task List", 9],
  ["Toggle", 10],
  ["Link to Page", 11],
  ["Callout", 12],
]);

const categoryOrder: Record<CommandItem["category"], number> = {
  basic: 0,
  lists: 0,
  media: 1,
  database: 2,
  layout: 3,
  advanced: 4,
  turninto: 5,
  color: 6,
};

function getMenuCategory(item: CommandItem): CommandItem["category"] {
  if (notionBasicOrder.has(item.title)) return "basic";
  if (item.category === "basic") return "advanced";
  return item.category;
}

function getMenuRank(item: CommandItem, originalIndex: number) {
  const basicRank = notionBasicOrder.get(item.title);
  if (basicRank !== undefined) return basicRank;
  return 100 + categoryOrder[getMenuCategory(item)] * 100 + originalIndex;
}

const commands: CommandItem[] = [
  // Basic Blocks
  {
    title: "Text",
    description: "Plain text paragraph",
    titleKey: "blockMenu.text",
    descKey: "blockMenu.textDesc",
    icon: <Type className="h-4 w-4" />,
    category: "basic",
    searchKeywords: ["文本", "纯文本", "段落"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setParagraph().run();
    },
  },
  {
    title: "Heading 1",
    description: "Large section heading",
    titleKey: "blockMenu.heading1",
    descKey: "blockMenu.heading1Desc",
    icon: <Heading1 className="h-4 w-4" />,
    category: "basic",
    shortcut: "Ctrl+Alt+1",
    menuShortcut: "#",
    searchKeywords: ["标题", "一级标题", "大标题"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run();
    },
  },
  {
    title: "Heading 2",
    description: "Medium section heading",
    titleKey: "blockMenu.heading2",
    descKey: "blockMenu.heading2Desc",
    icon: <Heading2 className="h-4 w-4" />,
    category: "basic",
    shortcut: "Ctrl+Alt+2",
    menuShortcut: "##",
    searchKeywords: ["标题", "二级标题", "中标题"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run();
    },
  },
  {
    title: "Heading 3",
    description: "Small section heading",
    titleKey: "blockMenu.heading3",
    descKey: "blockMenu.heading3Desc",
    icon: <Heading3 className="h-4 w-4" />,
    category: "basic",
    shortcut: "Ctrl+Alt+3",
    menuShortcut: "###",
    searchKeywords: ["标题", "三级标题", "小标题"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run();
    },
  },
  {
    title: "Heading 4",
    description: "Extra small heading",
    titleKey: "blockMenu.heading4",
    descKey: "blockMenu.heading4Desc",
    icon: <Heading4 className="h-4 w-4" />,
    category: "basic",
    shortcut: "Ctrl+Alt+4",
    menuShortcut: "####",
    searchKeywords: ["标题", "四级标题"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 4 }).run();
    },
  },
  {
    title: "Heading 5",
    description: "Minor heading",
    titleKey: "blockMenu.heading5",
    descKey: "blockMenu.heading5Desc",
    icon: <Heading5 className="h-4 w-4" />,
    category: "basic",
    shortcut: "Ctrl+Alt+5",
    menuShortcut: "#####",
    searchKeywords: ["标题", "五级标题"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 5 }).run();
    },
  },
  {
    title: "Heading 6",
    description: "Smallest heading",
    titleKey: "blockMenu.heading6",
    descKey: "blockMenu.heading6Desc",
    icon: <Heading6 className="h-4 w-4" />,
    category: "basic",
    shortcut: "Ctrl+Alt+6",
    menuShortcut: "######",
    searchKeywords: ["标题", "六级标题"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 6 }).run();
    },
  },
  {
    title: "Quote",
    description: "Create a blockquote",
    titleKey: "blockMenu.quote",
    descKey: "blockMenu.quoteDesc",
    icon: <Quote className="h-4 w-4" />,
    category: "basic",
    shortcut: "Ctrl+Shift+B",
    menuShortcut: '"',
    searchKeywords: ["引用", "引用块"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).clearNodes().toggleBlockquote().run();
    },
  },
  {
    title: "Callout",
    description: "Highlighted info or warning block",
    titleKey: "blockMenu.callout",
    descKey: "blockMenu.calloutDesc",
    icon: <MessageSquareQuote className="h-4 w-4" />,
    category: "basic",
    searchKeywords: ["提示框", "高亮", "警告"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).clearNodes().toggleCallout({ type: "info" }).run();
    },
  },
  {
    title: "Toggle",
    description: "Collapsible content block",
    titleKey: "blockMenu.toggle",
    descKey: "blockMenu.toggleDesc",
    icon: <ChevronRight className="h-4 w-4" />,
    category: "basic",
    menuShortcut: ">",
    searchKeywords: ["折叠", "可折叠"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setToggle().run();
    },
  },
  {
    title: "Table of Contents",
    description: "Auto-generated from headings",
    titleKey: "blockMenu.toc",
    descKey: "blockMenu.tocDesc",
    icon: <TableOfContents className="h-4 w-4" />,
    category: "basic",
    searchKeywords: ["目录", "大纲"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setTableOfContents().run();
    },
  },
  {
    title: "Divider",
    description: "Insert a horizontal divider",
    titleKey: "blockMenu.divider",
    descKey: "blockMenu.dividerDesc",
    icon: <Minus className="h-4 w-4" />,
    category: "basic",
    shortcut: "---",
    searchKeywords: ["分割线", "水平线"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run();
    },
  },
  {
    title: "Link to Page",
    description: "Link to an existing page",
    titleKey: "blockMenu.linkToPage",
    menuTitleKey: "blockMenu.page",
    descKey: "blockMenu.linkToPageDesc",
    icon: <FileText className="h-4 w-4" />,
    category: "basic",
    searchKeywords: ["页面链接", "链接到页面"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      const { openPagePicker } = useEditorStore.getState();
      const coords = editor.view.coordsAtPos(editor.state.selection.from);
      const anchor = {
        x: coords.left,
        y: coords.top,
        width: 0,
        height: coords.bottom - coords.top,
      };
      openPagePicker((attrs) => {
        editor.chain().focus().setPageLink(attrs).run();
      }, anchor);
    },
  },

  // Lists
  {
    title: "Bullet List",
    description: "Create a simple bullet list",
    titleKey: "blockMenu.bulletList",
    descKey: "blockMenu.bulletListDesc",
    icon: <List className="h-4 w-4" />,
    category: "lists",
    shortcut: "Ctrl+Shift+8",
    menuShortcut: "-",
    searchKeywords: ["无序列表", "列表"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    title: "Numbered List",
    description: "Create a numbered list",
    titleKey: "blockMenu.numberedList",
    descKey: "blockMenu.numberedListDesc",
    icon: <ListOrdered className="h-4 w-4" />,
    category: "lists",
    shortcut: "Ctrl+Shift+7",
    menuShortcut: "1.",
    searchKeywords: ["有序列表", "编号列表"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
  {
    title: "Task List",
    description: "Create a task list with checkboxes",
    titleKey: "blockMenu.taskList",
    descKey: "blockMenu.taskListDesc",
    icon: <ListTodo className="h-4 w-4" />,
    category: "lists",
    shortcut: "Ctrl+Shift+9",
    menuShortcut: "[]",
    searchKeywords: ["任务列表", "待办", "复选框"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run();
    },
  },

  // Media
  {
    title: "Image",
    description: "Upload or embed an image",
    titleKey: "blockMenu.image",
    descKey: "blockMenu.imageDesc",
    // eslint-disable-next-line jsx-a11y/alt-text -- This is a Lucide icon, not an img element
    icon: <Image className="h-4 w-4" />,
    category: "media",
    searchKeywords: ["图片", "图像", "上传"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      const { $from } = editor.state.selection;
      const isEmptyParagraph =
        $from.parent.type.name === "paragraph" && $from.parent.content.size === 0;

      if (isEmptyParagraph) {
        editor
          .chain()
          .focus()
          .insertContentAt({ from: $from.before($from.depth), to: $from.after($from.depth) }, [
            { type: "image" },
            { type: "paragraph" },
          ])
          .run();
      } else {
        editor
          .chain()
          .focus()
          .insertContent([{ type: "image" }, { type: "paragraph" }])
          .run();
      }
    },
  },
  {
    title: "Table",
    description: "Insert a table",
    titleKey: "blockMenu.table",
    descKey: "blockMenu.tableDesc",
    icon: <Table className="h-4 w-4" />,
    category: "media",
    searchKeywords: ["表格"],
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
    titleKey: "blockMenu.webBookmark",
    descKey: "blockMenu.webBookmarkDesc",
    icon: <Bookmark className="h-4 w-4" />,
    category: "media",
    searchKeywords: ["网页书签", "书签", "链接"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setWebBookmark({ url: "" }).run();
    },
  },

  // Database - parent entry with sub-items
  {
    title: "Database",
    description: "Add a database with table, board, gallery or list view",
    titleKey: "blockMenu.database",
    descKey: "blockMenu.databaseDesc",
    icon: <Table2 className="h-4 w-4" />,
    category: "database",
    searchKeywords: ["数据库"],
    hasSubItems: true,
    subItems: [
      {
        titleKey: "blockMenu.tableView",
        icon: <Table2 className="h-4 w-4" />,
        command: ({ editor, range }) => {
          editor.chain().focus().deleteRange(range).insertDatabaseBlock().run();
        },
      },
      {
        titleKey: "blockMenu.boardView",
        icon: <LayoutGrid className="h-4 w-4" />,
        command: ({ editor, range }) => {
          editor.chain().focus().deleteRange(range).insertDatabaseBlock(undefined, "board").run();
        },
      },
      {
        titleKey: "blockMenu.galleryView",
        icon: <GalleryHorizontalEnd className="h-4 w-4" />,
        command: ({ editor, range }) => {
          editor.chain().focus().deleteRange(range).insertDatabaseBlock(undefined, "gallery").run();
        },
      },
      {
        titleKey: "blockMenu.listView",
        icon: <List className="h-4 w-4" />,
        command: ({ editor, range }) => {
          editor.chain().focus().deleteRange(range).insertDatabaseBlock(undefined, "list").run();
        },
      },
    ],
    command: () => {},
  },
  // Individual database views (search-only, for direct access via search)
  {
    title: "Table view",
    description: "Add a table view for a new or existing data source",
    titleKey: "blockMenu.tableView",
    descKey: "blockMenu.tableViewDesc",
    icon: <Table2 className="h-4 w-4" />,
    category: "database",
    searchOnly: true,
    searchKeywords: ["表格视图", "数据库表格"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertDatabaseBlock().run();
    },
  },
  {
    title: "Board view",
    description: "Add a Kanban board view grouped by status",
    titleKey: "blockMenu.boardView",
    descKey: "blockMenu.boardViewDesc",
    icon: <LayoutGrid className="h-4 w-4" />,
    category: "database",
    searchOnly: true,
    searchKeywords: ["看板视图", "看板"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertDatabaseBlock(undefined, "board").run();
    },
  },
  {
    title: "Gallery view",
    description: "Add a gallery view with card layout",
    titleKey: "blockMenu.galleryView",
    descKey: "blockMenu.galleryViewDesc",
    icon: <GalleryHorizontalEnd className="h-4 w-4" />,
    category: "database",
    searchOnly: true,
    searchKeywords: ["画廊视图", "画廊"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertDatabaseBlock(undefined, "gallery").run();
    },
  },
  {
    title: "List view",
    description: "Add a simple list view",
    titleKey: "blockMenu.listView",
    descKey: "blockMenu.listViewDesc",
    icon: <List className="h-4 w-4" />,
    category: "database",
    searchOnly: true,
    searchKeywords: ["列表视图"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertDatabaseBlock(undefined, "list").run();
    },
  },

  // Layout - parent entry with sub-items
  {
    title: "Columns",
    description: "Split content into side-by-side columns",
    titleKey: "blockMenu.columns",
    descKey: "blockMenu.columnsDesc",
    icon: <Columns2 className="h-4 w-4" />,
    category: "layout",
    searchKeywords: ["分栏", "列"],
    hasSubItems: true,
    subItems: [
      {
        titleKey: "blockMenu.twoColumns",
        icon: <Columns2 className="h-4 w-4" />,
        command: ({ editor, range }) => {
          editor.chain().focus().deleteRange(range).setColumns(2).run();
        },
      },
      {
        titleKey: "blockMenu.threeColumns",
        icon: <Columns3 className="h-4 w-4" />,
        command: ({ editor, range }) => {
          editor.chain().focus().deleteRange(range).setColumns(3).run();
        },
      },
      {
        titleKey: "blockMenu.fourColumns",
        icon: <Columns4 className="h-4 w-4" />,
        command: ({ editor, range }) => {
          editor.chain().focus().deleteRange(range).setColumns(4).run();
        },
      },
    ],
    command: () => {},
  },
  // Individual column options (search-only)
  {
    title: "2 Columns",
    description: "Split into two side-by-side columns",
    titleKey: "blockMenu.twoColumns",
    descKey: "blockMenu.twoColumnsDesc",
    icon: <Columns2 className="h-4 w-4" />,
    category: "layout",
    searchOnly: true,
    searchKeywords: ["两栏", "两列"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setColumns(2).run();
    },
  },
  {
    title: "3 Columns",
    description: "Split into three columns",
    titleKey: "blockMenu.threeColumns",
    descKey: "blockMenu.threeColumnsDesc",
    icon: <Columns3 className="h-4 w-4" />,
    category: "layout",
    searchOnly: true,
    searchKeywords: ["三栏", "三列"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setColumns(3).run();
    },
  },
  {
    title: "4 Columns",
    description: "Split into four columns",
    titleKey: "blockMenu.fourColumns",
    descKey: "blockMenu.fourColumnsDesc",
    icon: <Columns4 className="h-4 w-4" />,
    category: "layout",
    searchOnly: true,
    searchKeywords: ["四栏", "四列"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setColumns(4).run();
    },
  },

  // Advanced
  {
    title: "Code Block",
    description: "Create a code block",
    titleKey: "blockMenu.codeBlock",
    descKey: "blockMenu.codeBlockDesc",
    icon: <Code className="h-4 w-4" />,
    category: "advanced",
    shortcut: "Ctrl+Alt+C",
    searchKeywords: ["代码块", "代码"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
    },
  },
  {
    title: "Math Block",
    description: "Insert a block math equation",
    titleKey: "blockMenu.mathBlock",
    descKey: "blockMenu.mathBlockDesc",
    icon: <Sigma className="h-4 w-4" />,
    category: "advanced",
    searchKeywords: ["数学公式", "公式", "方程"],
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
    titleKey: "blockMenu.mermaidChart",
    descKey: "blockMenu.mermaidChartDesc",
    icon: <GitBranch className="h-4 w-4" />,
    category: "advanced",
    searchKeywords: ["图表", "流程图", "Mermaid"],
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
    titleKey: "blockMenu.inlineMath",
    descKey: "blockMenu.inlineMathDesc",
    icon: <span className="flex h-4 w-4 items-center justify-center font-serif text-sm">x²</span>,
    category: "advanced",
    searchKeywords: ["行内公式", "内联公式"],
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

  // Turn Into (only shown when query matches)
  {
    title: "Turn into Text",
    description: "Convert to plain text",
    titleKey: "slashMenu.turnIntoText",
    descKey: "slashMenu.turnIntoTextDesc",
    icon: <Type className="h-4 w-4" />,
    category: "turninto",
    searchKeywords: ["转换为文本"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setParagraph().run();
    },
  },
  {
    title: "Turn into Heading 1",
    description: "Convert to large heading",
    titleKey: "slashMenu.turnIntoH1",
    descKey: "slashMenu.turnIntoH1Desc",
    icon: <Heading1 className="h-4 w-4" />,
    category: "turninto",
    searchKeywords: ["转换为标题", "转换为一级标题"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run();
    },
  },
  {
    title: "Turn into Heading 2",
    description: "Convert to medium heading",
    titleKey: "slashMenu.turnIntoH2",
    descKey: "slashMenu.turnIntoH2Desc",
    icon: <Heading2 className="h-4 w-4" />,
    category: "turninto",
    searchKeywords: ["转换为标题", "转换为二级标题"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run();
    },
  },
  {
    title: "Turn into Heading 3",
    description: "Convert to small heading",
    titleKey: "slashMenu.turnIntoH3",
    descKey: "slashMenu.turnIntoH3Desc",
    icon: <Heading3 className="h-4 w-4" />,
    category: "turninto",
    searchKeywords: ["转换为标题", "转换为三级标题"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run();
    },
  },
  {
    title: "Turn into Heading 4",
    description: "Convert to extra small heading",
    titleKey: "slashMenu.turnIntoH4",
    descKey: "slashMenu.turnIntoH4Desc",
    icon: <Heading4 className="h-4 w-4" />,
    category: "turninto",
    searchKeywords: ["转换为标题", "转换为四级标题"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 4 }).run();
    },
  },
  {
    title: "Turn into Heading 5",
    description: "Convert to minor heading",
    titleKey: "slashMenu.turnIntoH5",
    descKey: "slashMenu.turnIntoH5Desc",
    icon: <Heading5 className="h-4 w-4" />,
    category: "turninto",
    searchKeywords: ["转换为标题", "转换为五级标题"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 5 }).run();
    },
  },
  {
    title: "Turn into Heading 6",
    description: "Convert to smallest heading",
    titleKey: "slashMenu.turnIntoH6",
    descKey: "slashMenu.turnIntoH6Desc",
    icon: <Heading6 className="h-4 w-4" />,
    category: "turninto",
    searchKeywords: ["转换为标题", "转换为六级标题"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 6 }).run();
    },
  },
  {
    title: "Turn into Quote",
    description: "Convert to blockquote",
    titleKey: "slashMenu.turnIntoQuote",
    descKey: "slashMenu.turnIntoQuoteDesc",
    icon: <Quote className="h-4 w-4" />,
    category: "turninto",
    searchKeywords: ["转换为引用"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).clearNodes().toggleBlockquote().run();
    },
  },
  {
    title: "Turn into Callout",
    description: "Convert to callout block",
    titleKey: "slashMenu.turnIntoCallout",
    descKey: "slashMenu.turnIntoCalloutDesc",
    icon: <MessageSquareQuote className="h-4 w-4" />,
    category: "turninto",
    searchKeywords: ["转换为提示框"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).clearNodes().toggleCallout({ type: "info" }).run();
    },
  },
  {
    title: "Turn into Toggle",
    description: "Convert to collapsible toggle",
    titleKey: "slashMenu.turnIntoToggle",
    descKey: "slashMenu.turnIntoToggleDesc",
    icon: <ChevronRight className="h-4 w-4" />,
    category: "turninto",
    searchKeywords: ["转换为折叠"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setToggle().run();
    },
  },

  // Color (only shown when query matches)
  {
    title: "Red background",
    description: "Apply red background to block",
    titleKey: "slashMenu.redBg",
    descKey: "slashMenu.redBgDesc",
    icon: <div className="h-4 w-4 rounded-sm border border-red-300 bg-red-200" />,
    category: "color",
    searchKeywords: ["红色背景", "红色"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      const nodeType = editor.state.selection.$from.parent.type.name;
      editor.chain().updateAttributes(nodeType, { backgroundColor: "#fee2e2" }).run();
    },
  },
  {
    title: "Blue background",
    description: "Apply blue background to block",
    titleKey: "slashMenu.blueBg",
    descKey: "slashMenu.blueBgDesc",
    icon: <div className="h-4 w-4 rounded-sm border border-blue-300 bg-blue-200" />,
    category: "color",
    searchKeywords: ["蓝色背景", "蓝色"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      const nodeType = editor.state.selection.$from.parent.type.name;
      editor.chain().updateAttributes(nodeType, { backgroundColor: "#dbeafe" }).run();
    },
  },
  {
    title: "Green background",
    description: "Apply green background to block",
    titleKey: "slashMenu.greenBg",
    descKey: "slashMenu.greenBgDesc",
    icon: <div className="h-4 w-4 rounded-sm border border-green-300 bg-green-200" />,
    category: "color",
    searchKeywords: ["绿色背景", "绿色"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      const nodeType = editor.state.selection.$from.parent.type.name;
      editor.chain().updateAttributes(nodeType, { backgroundColor: "#dcfce7" }).run();
    },
  },
  {
    title: "Yellow background",
    description: "Apply yellow background to block",
    titleKey: "slashMenu.yellowBg",
    descKey: "slashMenu.yellowBgDesc",
    icon: <div className="h-4 w-4 rounded-sm border border-yellow-300 bg-yellow-200" />,
    category: "color",
    searchKeywords: ["黄色背景", "黄色"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      const nodeType = editor.state.selection.$from.parent.type.name;
      editor.chain().updateAttributes(nodeType, { backgroundColor: "#fef3c7" }).run();
    },
  },
  {
    title: "Purple background",
    description: "Apply purple background to block",
    titleKey: "slashMenu.purpleBg",
    descKey: "slashMenu.purpleBgDesc",
    icon: <div className="h-4 w-4 rounded-sm border border-purple-300 bg-purple-200" />,
    category: "color",
    searchKeywords: ["紫色背景", "紫色"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      const nodeType = editor.state.selection.$from.parent.type.name;
      editor.chain().updateAttributes(nodeType, { backgroundColor: "#f3e8ff" }).run();
    },
  },
  {
    title: "Gray background",
    description: "Apply gray background to block",
    titleKey: "slashMenu.grayBg",
    descKey: "slashMenu.grayBgDesc",
    icon: <div className="h-4 w-4 rounded-sm border border-gray-300 bg-gray-200" />,
    category: "color",
    searchKeywords: ["灰色背景", "灰色"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      const nodeType = editor.state.selection.$from.parent.type.name;
      editor.chain().updateAttributes(nodeType, { backgroundColor: "#f3f4f6" }).run();
    },
  },
  {
    title: "No background",
    description: "Remove block background color",
    titleKey: "slashMenu.noBg",
    descKey: "slashMenu.noBgDesc",
    icon: <Palette className="h-4 w-4" />,
    category: "color",
    searchKeywords: ["无背景", "移除背景"],
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
        <div className="px-3 pt-3 text-[9px] leading-[1.6] text-[#37352f]">
          <div>
            The Milky Way is the galaxy that includes the Solar System, with the name describing its
            appearance from Earth.
          </div>
          <div className="mt-1.5">
            A faint band of light formed from stars that cannot be individually distinguished by the
            naked eye.
          </div>
        </div>
      );

    case "Heading 1":
      return (
        <div className="px-3 pt-3 text-[#37352f]">
          <div className="text-[16px] font-bold leading-[1.2]">Galaxies</div>
          <div className="mt-2 text-[9px] leading-[1.55]">
            A galaxy is a gravitationally bound system of stars, stellar remnants, and interstellar
            gas.
          </div>
        </div>
      );

    case "Heading 2":
      return (
        <div className="px-3 pt-3 text-[#37352f]">
          <div className="text-[13px] font-bold leading-[1.2]">Types of galaxies</div>
          <div className="mt-2 text-[9px] leading-[1.55]">
            Galaxies are classified by visual morphology as elliptical, spiral, or irregular.
          </div>
        </div>
      );

    case "Heading 3":
      return (
        <div className="px-3 pt-3 text-[#37352f]">
          <div className="text-[11px] font-bold leading-[1.2]">Spiral galaxies</div>
          <div className="mt-2 text-[9px] leading-[1.55]">
            The most common type, characterized by their flat rotating disks of stars and
            interstellar gas.
          </div>
        </div>
      );

    case "Heading 4":
      return (
        <div className="px-3 pt-3 text-[#37352f]">
          <div className="text-[10px] font-bold leading-[1.2]">Barred spirals</div>
          <div className="mt-1.5 text-[9px] leading-[1.55]">
            A subtype of spiral galaxy with a central bar-shaped structure of stars.
          </div>
        </div>
      );

    case "Heading 5":
      return (
        <div className="px-3 pt-3 text-[#37352f]">
          <div className="text-[9px] font-bold leading-[1.2]">Local Group</div>
          <div className="mt-1.5 text-[9px] leading-[1.55]">
            The galaxy group that includes the Milky Way and the Andromeda Galaxy.
          </div>
        </div>
      );

    case "Heading 6":
      return (
        <div className="px-3 pt-3 text-[#37352f]">
          <div className="text-[8px] font-bold uppercase leading-[1.2] tracking-wide">
            Sub-section
          </div>
          <div className="mt-1.5 text-[9px] leading-[1.55]">
            Used for the smallest level in the heading hierarchy.
          </div>
        </div>
      );

    case "Quote":
      return (
        <div className="px-3 pt-3 text-[#37352f]">
          <div className="border-l-[3px] border-[#37352f] pl-2 text-[10px] italic leading-[1.5]">
            We are made of star-stuff. We are a way for the cosmos to know itself.
          </div>
          <div className="mt-2 text-[8px] text-[#9b9a97]">— Carl Sagan, Cosmos</div>
        </div>
      );

    case "Callout":
      return (
        <div className="px-3 pt-3 text-[9px] leading-[1.55] text-[#37352f]">
          <div className="flex gap-1.5 rounded-sm bg-[#f1f1ef] px-2 py-1.5">
            <div className="mt-[1px] flex h-3 w-3 shrink-0 items-center justify-center rounded-[3px] bg-[#37352f]">
              <span className="text-[7px] font-bold leading-none text-white">i</span>
            </div>
            <div className="min-w-0">
              A <span className="font-bold">galaxy</span> is a gravitationally bo
              <br />
              dust, and dark matter. The wor
              <br />
              literally &ldquo;milky&rdquo;, a reference to t
            </div>
          </div>
          <div className="mt-2">
            The space between galaxies is filled w
            <br />
            average density of less than one atom
          </div>
        </div>
      );

    case "Toggle":
      return (
        <div className="px-3 pt-3 text-[9px] leading-[1.6] text-[#37352f]">
          <div className="flex items-center gap-1 font-medium">
            <ChevronRight className="h-2.5 w-2.5 shrink-0" />
            <span>What is a galaxy?</span>
          </div>
          <div className="ml-3.5 mt-1.5">
            A galaxy is a gravitationally bound system of stars, stellar remnants, gas, and dust.
          </div>
        </div>
      );

    case "Table of Contents":
      return (
        <div className="px-3 pt-3 text-[9px] leading-[1.7] text-[#37352f]">
          <div className="font-semibold">Introduction</div>
          <div className="pl-3 text-[#5e5d59]">Background</div>
          <div className="pl-3 text-[#5e5d59]">Methodology</div>
          <div className="pl-6 text-[#9b9a97]">Sample selection</div>
          <div className="pl-6 text-[#9b9a97]">Data analysis</div>
          <div className="font-semibold">Findings</div>
        </div>
      );

    case "Page":
    case "Link to Page":
      return (
        <div className="px-3 pt-3 text-[9px] leading-[1.6] text-[#37352f]">
          <div>Refer to the project overview in</div>
          <div className="mt-1.5 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 underline decoration-[#cccac4] underline-offset-[3px]">
            <FileText className="h-3 w-3 shrink-0 text-[#9b9a97]" />
            <span className="font-medium">Q3 Roadmap</span>
          </div>
          <div className="mt-1.5">for the full timeline and milestones.</div>
        </div>
      );

    case "Bullet List":
      return (
        <div className="px-3 pt-3 text-[9px] leading-[1.6] text-[#37352f]">
          <div className="font-medium">Galaxy classification</div>
          <div className="mt-1 space-y-0.5">
            {["Spiral galaxies", "Elliptical galaxies", "Irregular galaxies", "Dwarf galaxies"].map(
              (text) => (
                <div key={text} className="flex gap-1.5">
                  <span className="leading-none">•</span>
                  <span>{text}</span>
                </div>
              )
            )}
          </div>
        </div>
      );

    case "Numbered List":
      return (
        <div className="px-3 pt-3 text-[9px] leading-[1.6] text-[#37352f]">
          <div className="font-medium">How to observe the night sky</div>
          <div className="mt-1 space-y-0.5">
            {[
              "Find a dark location",
              "Allow your eyes to adapt",
              "Use a star chart",
              "Look up",
            ].map((text, index) => (
              <div key={text} className="flex gap-1.5">
                <span className="text-[#5e5d59]">{index + 1}.</span>
                <span>{text}</span>
              </div>
            ))}
          </div>
        </div>
      );

    case "Task List":
      return (
        <div className="px-3 pt-3 text-[9px] leading-[1.6] text-[#37352f]">
          <div className="space-y-1">
            {[
              { text: "Read introduction chapter", done: true },
              { text: "Take notes on key concepts", done: true },
              { text: "Write summary essay", done: false },
              { text: "Submit by Friday afternoon", done: false },
            ].map(({ text, done }) => (
              <div key={text} className="flex items-start gap-1.5">
                {done ? (
                  <div className="mt-[2px] flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-[2px] bg-[#37352f] text-[7px] font-bold leading-none text-white">
                    ✓
                  </div>
                ) : (
                  <div className="mt-[2px] h-2.5 w-2.5 shrink-0 rounded-[2px] border border-[#9b9a97]" />
                )}
                <span className={done ? "text-[#9b9a97] line-through" : undefined}>{text}</span>
              </div>
            ))}
          </div>
        </div>
      );

    case "Divider":
      return (
        <div className="px-3 pt-3 text-[9px] leading-[1.6] text-[#37352f]">
          <div>The Milky Way is the galaxy that includes our Solar System.</div>
          <div className="my-2 h-px w-full bg-[#e6e5e1]" />
          <div>Andromeda is the nearest large galaxy at 2.5 million light-years away.</div>
        </div>
      );

    case "Image":
      return (
        <div className="px-3 pt-3">
          <div className="relative flex h-[72px] w-full items-center justify-center overflow-hidden rounded border border-[#e6e5e1] bg-[#f7f7f5]">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/80 ring-1 ring-[#e6e5e1]">
              {/* eslint-disable-next-line jsx-a11y/alt-text */}
              <Image className="h-3.5 w-3.5 text-[#9b9a97]" />
            </div>
          </div>
          <div className="mt-1.5 text-[8px] italic text-[#9b9a97]">
            A view of the Milky Way galaxy
          </div>
        </div>
      );

    case "Table":
      return (
        <div className="px-3 pt-3 text-[7px] leading-tight text-[#37352f]">
          <div className="overflow-hidden rounded border border-[#e6e5e1]">
            <div className="grid grid-cols-3">
              {[
                ["Galaxy", "Type", "Distance"],
                ["Andromeda", "Spiral", "2.5 Mly"],
                ["Triangulum", "Spiral", "2.7 Mly"],
                ["Whirlpool", "Spiral", "23 Mly"],
              ].map((row, rowIdx) => (
                <Fragment key={rowIdx}>
                  {row.map((cell, colIdx) => (
                    <div
                      key={`${rowIdx}-${colIdx}`}
                      className={cn(
                        "px-1.5 py-1",
                        rowIdx < 3 && "border-b border-[#e6e5e1]",
                        colIdx < 2 && "border-r border-[#e6e5e1]",
                        rowIdx === 0 && "bg-[#f7f7f5] font-semibold"
                      )}
                    >
                      {cell}
                    </div>
                  ))}
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      );

    case "2 Columns":
      return (
        <div className="px-3 pt-3">
          <div className="flex gap-2">
            {[1, 2].map((idx) => (
              <div key={idx} className="flex-1 space-y-1">
                <div className="h-1.5 w-full rounded-sm bg-[#e6e5e1]" />
                <div className="h-1.5 w-5/6 rounded-sm bg-[#e6e5e1]" />
                <div className="h-1.5 w-3/4 rounded-sm bg-[#e6e5e1]" />
                <div className="h-1.5 w-2/3 rounded-sm bg-[#e6e5e1]" />
                <div className="h-1.5 w-4/5 rounded-sm bg-[#e6e5e1]" />
              </div>
            ))}
          </div>
        </div>
      );

    case "3 Columns":
      return (
        <div className="px-3 pt-3">
          <div className="flex gap-1.5">
            {[1, 2, 3].map((idx) => (
              <div key={idx} className="flex-1 space-y-1">
                <div className="h-1.5 w-full rounded-sm bg-[#e6e5e1]" />
                <div className="h-1.5 w-5/6 rounded-sm bg-[#e6e5e1]" />
                <div className="h-1.5 w-3/4 rounded-sm bg-[#e6e5e1]" />
                <div className="h-1.5 w-2/3 rounded-sm bg-[#e6e5e1]" />
                <div className="h-1.5 w-4/5 rounded-sm bg-[#e6e5e1]" />
              </div>
            ))}
          </div>
        </div>
      );

    case "4 Columns":
      return (
        <div className="px-3 pt-3">
          <div className="flex gap-1">
            {[1, 2, 3, 4].map((idx) => (
              <div key={idx} className="flex-1 space-y-1">
                <div className="h-1.5 w-full rounded-sm bg-[#e6e5e1]" />
                <div className="h-1.5 w-5/6 rounded-sm bg-[#e6e5e1]" />
                <div className="h-1.5 w-3/4 rounded-sm bg-[#e6e5e1]" />
                <div className="h-1.5 w-2/3 rounded-sm bg-[#e6e5e1]" />
              </div>
            ))}
          </div>
        </div>
      );

    case "Code Block":
      return (
        <div className="px-3 pt-3">
          <div className="rounded bg-[#1e1e1e] p-2 font-mono text-[7.5px] leading-[1.6] text-[#d4d4d4]">
            <div>
              <span className="text-white">function</span> <span className="text-white">greet</span>
              (<span className="text-[#9b9a97]">name</span>) {"{"}
            </div>
            <div className="pl-3">
              <span className="text-white">return</span>{" "}
              <span className="text-[#9b9a97]">{"`Hello, ${name}!`"}</span>;
            </div>
            <div>{"}"}</div>
            <div className="mt-1">
              <span className="text-white">greet</span>(
              <span className="text-[#9b9a97]">&quot;world&quot;</span>);
            </div>
          </div>
        </div>
      );

    case "Math Block":
      return (
        <div className="px-3 pt-3 text-[9px] leading-[1.55] text-[#37352f]">
          <div>Einstein&apos;s mass-energy equivalence:</div>
          <div className="my-2 flex justify-center font-serif text-[20px] italic leading-none">
            E = mc<sup className="text-[12px]">2</sup>
          </div>
          <div className="text-[#5e5d59]">where c is the speed of light in vacuum.</div>
        </div>
      );

    case "Mermaid Chart":
      return (
        <div className="flex h-full items-center justify-center px-3 py-2 text-[7.5px] text-[#37352f]">
          <div className="flex flex-col items-center gap-0.5">
            <div className="rounded border border-[#37352f] bg-white px-2 py-0.5 leading-tight">
              Idea
            </div>
            <div className="h-2 w-px bg-[#37352f]" />
            <div className="flex gap-2">
              <div className="rounded border border-[#37352f] bg-white px-1.5 py-0.5 leading-tight">
                Build
              </div>
              <div className="rounded border border-[#37352f] bg-white px-1.5 py-0.5 leading-tight">
                Test
              </div>
            </div>
            <div className="h-2 w-px bg-[#37352f]" />
            <div className="rounded border border-[#37352f] bg-[#f1f1ef] px-2 py-0.5 font-semibold leading-tight">
              Ship
            </div>
          </div>
        </div>
      );

    case "Inline Math":
      return (
        <div className="px-3 pt-3 text-[9px] leading-[1.7] text-[#37352f]">
          <div>
            The Pythagorean theorem states that{" "}
            <span className="rounded-sm bg-[#f1f1ef] px-1 font-serif italic">
              a<sup>2</sup> + b<sup>2</sup> = c<sup>2</sup>
            </span>{" "}
            for any right triangle.
          </div>
          <div className="mt-1.5 text-[#5e5d59]">
            where a and b are the legs and c is the hypotenuse.
          </div>
        </div>
      );

    case "Web Bookmark":
      return (
        <div className="px-3 pt-3">
          <div className="flex h-[68px] overflow-hidden rounded border border-[#e6e5e1]">
            <div className="min-w-0 flex-1 px-2 py-1.5">
              <div className="truncate text-[8px] font-semibold leading-tight text-[#37352f]">
                Milky Way - Wikipedia
              </div>
              <div className="mt-1 line-clamp-2 text-[7px] leading-[1.4] text-[#5e5d59]">
                The Milky Way is the galaxy that includes the Solar System, with the name describing
                its appearance.
              </div>
              <div className="mt-1 flex items-center gap-1 text-[7px] text-[#9b9a97]">
                <div className="h-2 w-2 rounded-sm bg-[#9b9a97]" />
                <span className="truncate">en.wikipedia.org</span>
              </div>
            </div>
            <div className="w-14 shrink-0 border-l border-[#e6e5e1] bg-[#f7f7f5]" />
          </div>
        </div>
      );

    case "Table view":
      return (
        <div className="px-3 pt-3 text-[7px] leading-tight text-[#37352f]">
          <div className="overflow-hidden rounded border border-[#e6e5e1]">
            <div className="grid grid-cols-[1fr_60px]">
              <div className="border-b border-r border-[#e6e5e1] bg-[#f7f7f5] px-1.5 py-1 font-semibold">
                Aa Name
              </div>
              <div className="border-b border-[#e6e5e1] bg-[#f7f7f5] px-1.5 py-1 font-semibold">
                Status
              </div>
              <div className="border-b border-r border-[#e6e5e1] px-1.5 py-1">Mary Meeks</div>
              <div className="border-b border-[#e6e5e1] px-1.5 py-1">
                <span className="rounded-sm bg-[#ecece8] px-1 text-[6px] text-[#5e5d59]">
                  Scheduled
                </span>
              </div>
              <div className="border-b border-r border-[#e6e5e1] px-1.5 py-1">Mitch Cohn</div>
              <div className="border-b border-[#e6e5e1] px-1.5 py-1">
                <span className="rounded-sm bg-[#e0e0dc] px-1 text-[6px] text-[#37352f]">
                  Engaged
                </span>
              </div>
              <div className="border-r border-[#e6e5e1] px-1.5 py-1">Anna Kim</div>
              <div className="px-1.5 py-1">
                <span className="rounded-sm bg-[#f1f1ef] px-1 text-[6px] text-[#9b9a97]">
                  Pending
                </span>
              </div>
            </div>
          </div>
        </div>
      );

    case "Board view":
      return (
        <div className="px-3 pt-3">
          <div className="flex gap-1.5 text-[7px] leading-tight">
            {[
              { label: "Todo", color: "#e6e5e1" },
              { label: "Doing", color: "#cccac4" },
              { label: "Done", color: "#9b9a97" },
            ].map(({ label, color }) => (
              <div key={label} className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-1 text-[#5e5d59]">
                  <div className="h-1.5 w-1.5 rounded-sm" style={{ backgroundColor: color }} />
                  <span className="truncate font-semibold">{label}</span>
                </div>
                <div className="rounded border border-[#e6e5e1] bg-white p-1 shadow-sm">
                  <div className="h-1 w-3/4 rounded-sm bg-[#37352f]/30" />
                </div>
                <div className="rounded border border-[#e6e5e1] bg-white p-1 shadow-sm">
                  <div className="h-1 w-2/3 rounded-sm bg-[#37352f]/30" />
                </div>
              </div>
            ))}
          </div>
        </div>
      );

    case "Gallery view":
      return (
        <div className="px-3 pt-3">
          <div className="grid grid-cols-2 gap-1.5">
            {[
              "from-[#f1f1ef] to-[#cccac4]",
              "from-[#e6e5e1] to-[#9b9a97]",
              "from-[#ecece8] to-[#b8b6b1]",
              "from-[#f7f7f5] to-[#d4d2cd]",
            ].map((gradient, idx) => (
              <div key={idx} className="overflow-hidden rounded border border-[#e6e5e1] bg-white">
                <div className={cn("h-7 bg-gradient-to-br", gradient)} />
                <div className="space-y-0.5 p-1">
                  <div className="h-1 w-4/5 rounded-sm bg-[#37352f]/40" />
                  <div className="h-1 w-1/2 rounded-sm bg-[#37352f]/25" />
                </div>
              </div>
            ))}
          </div>
        </div>
      );

    case "List view":
      return (
        <div className="px-3 pt-3 text-[8px] leading-tight text-[#37352f]">
          <div className="overflow-hidden rounded border border-[#e6e5e1]">
            {[
              "Competitive Strategy",
              "Value Capture",
              "Cal Newport with Ezra Klein",
              "How to Grow as Slack",
              "Crafting The First Mile",
            ].map((name, idx, arr) => (
              <div
                key={name}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1.5",
                  idx < arr.length - 1 && "border-b border-[#ecece8]"
                )}
              >
                <FileText className="h-2.5 w-2.5 shrink-0 text-[#9b9a97]" />
                <span className="truncate font-medium">{name}</span>
              </div>
            ))}
          </div>
        </div>
      );

    default:
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
            <div className="px-3 pt-3 text-[9px] leading-[1.6] text-[#37352f]">
              <div className="rounded-sm px-2 py-1.5" style={{ backgroundColor: bg }}>
                The Milky Way is the galaxy that
                <br />
                includes our Solar System.
              </div>
              <div className="mt-2">Use highlights to draw the eye to key ideas.</div>
            </div>
          );
        }
      }
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-[#9b9a97]">
          <div className="flex h-9 w-9 items-center justify-center rounded border border-[#e6e5e1] [&_svg]:h-5 [&_svg]:w-5">
            {item.icon}
          </div>
          <div className="text-[9px] font-medium text-[#5e5d59]">{title}</div>
        </div>
      );
  }
}

function getPreviewCaption(item: CommandItem, translatedTitle: string) {
  const title = item.title.replace(/^Turn into\s+/i, "");

  switch (title) {
    case "Text":
      return "Just start writing with plain text";
    case "Heading 1":
      return "Big section heading";
    case "Heading 2":
      return "Medium section heading";
    case "Heading 3":
      return "Small section heading";
    case "Heading 4":
      return "Smaller section heading";
    case "Heading 5":
      return "Minor heading";
    case "Heading 6":
      return "Smallest heading";
    case "Quote":
      return "Capture a quote";
    case "Callout":
      return "Make writing stand out";
    case "Toggle":
      return "Hide content under a toggle";
    case "Table of Contents":
      return "Show an outline of your headings";
    case "Page":
    case "Link to Page":
      return "Link to an existing page";
    case "Bullet List":
      return "Create a simple bulleted list";
    case "Numbered List":
      return "Create a list with numbering";
    case "Task List":
      return "Track tasks with a to-do list";
    case "Divider":
      return "Visually separate blocks";
    case "Image":
      return "Upload or embed an image";
    case "Table":
      return "Add a simple table";
    case "Web Bookmark":
      return "Save a link as a visual bookmark";
    case "Code Block":
      return "Capture a code snippet";
    case "Math Block":
      return "Insert a block math equation";
    case "Mermaid Chart":
      return "Insert a diagram or chart";
    case "Inline Math":
      return "Insert inline math expression";
    case "Table view":
      return "Create a table database view";
    case "Board view":
      return "Create a Kanban board view";
    case "Gallery view":
      return "Create a gallery database view";
    case "List view":
      return "Create a list database view";
    case "2 Columns":
      return "Side-by-side two columns";
    case "3 Columns":
      return "Side-by-side three columns";
    case "4 Columns":
      return "Side-by-side four columns";
    default:
      if (item.category === "color") {
        return "Highlight a block with color";
      }
      return translatedTitle;
  }
}

function PreviewCard({ item, translatedTitle }: { item: CommandItem; translatedTitle: string }) {
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
        "absolute top-[27px] hidden w-[220px] rounded-md border border-[#e9e9e7] bg-white p-2 shadow-[0_8px_24px_rgba(15,15,15,0.08)] dark:border-[#3f3f3f] dark:bg-[#252525] dark:shadow-[0_8px_24px_rgba(0,0,0,0.24)] md:block",
        flipToLeft ? "right-full mr-2" : "left-full ml-2"
      )}
    >
      <div className="h-[140px] overflow-hidden rounded bg-white text-[#37352f] dark:border dark:border-[#e9e9e7]">
        {getPreviewContent(item)}
      </div>
      <div className="mt-2 text-[13px] font-semibold leading-[1.15] text-[#37352f] dark:text-[#f1f1ef]">
        {getPreviewCaption(item, translatedTitle)}
      </div>
    </div>
  );
}

interface CommandListProps {
  items: CommandItem[];
  command: (item: CommandItem) => void;
  query?: string;
}

interface CommandListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

const CommandList = forwardRef<CommandListRef, CommandListProps>(
  ({ items, command, query = "" }, ref) => {
    const t = useTranslations("editor");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [subView, setSubView] = useState<CommandItem | null>(null);
    const [subSelectedIndex, setSubSelectedIndex] = useState(0);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const isSearching = query.trim().length > 0;
    const visibleItems = useMemo(
      () =>
        items
          .map((item, originalIndex) => ({ item, originalIndex }))
          .sort(
            (a, b) =>
              getMenuRank(a.item, a.originalIndex) - getMenuRank(b.item, b.originalIndex) ||
              a.originalIndex - b.originalIndex
          ),
      [items]
    );

    const selectItem = useCallback(
      (index: number) => {
        const item = visibleItems[index]?.item;
        if (item) {
          if (item.hasSubItems && item.subItems) {
            setSubView(item);
            setSubSelectedIndex(0);
          } else {
            command(item);
          }
        }
      },
      [visibleItems, command]
    );

    const selectSubItem = useCallback(
      (subItem: CommandSubItem) => {
        if (!subView) return;
        const syntheticItem: CommandItem = {
          ...subView,
          command: subItem.command,
        };
        command(syntheticItem);
      },
      [subView, command]
    );

    useEffect(() => {
      setSelectedIndex(0);
      setSubView(null);
    }, [items]);

    // Scroll selected item into view
    useEffect(() => {
      const container = scrollContainerRef.current;
      if (!container) return;

      const buttons = container.querySelectorAll("[data-command-item]");
      const idx = subView ? subSelectedIndex : selectedIndex;
      const selected = buttons[idx] as HTMLElement | undefined;
      if (selected) {
        selected.scrollIntoView({ block: "nearest" });
      }
    }, [selectedIndex, subSelectedIndex, subView]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        // Sub-view keyboard navigation
        if (subView && subView.subItems) {
          if (event.key === "ArrowUp") {
            setSubSelectedIndex(
              (prev) => (prev - 1 + subView.subItems!.length) % subView.subItems!.length
            );
            return true;
          }
          if (event.key === "ArrowDown") {
            setSubSelectedIndex((prev) => (prev + 1) % subView.subItems!.length);
            return true;
          }
          if (event.key === "Enter") {
            selectSubItem(subView.subItems[subSelectedIndex]);
            return true;
          }
          if (event.key === "Backspace" || event.key === "ArrowLeft") {
            setSubView(null);
            return true;
          }
          return false;
        }

        // Main view keyboard navigation
        if (visibleItems.length === 0) return false;

        if (event.key === "ArrowUp") {
          setSelectedIndex((prev) => (prev - 1 + visibleItems.length) % visibleItems.length);
          return true;
        }

        if (event.key === "ArrowDown") {
          setSelectedIndex((prev) => (prev + 1) % visibleItems.length);
          return true;
        }

        if (event.key === "Enter") {
          selectItem(selectedIndex);
          return true;
        }

        return false;
      },
    }));

    if (visibleItems.length === 0) {
      return <div className="p-2 text-sm text-muted-foreground">{t("blockMenu.noResults")}</div>;
    }

    // Sub-view rendering
    if (subView && subView.subItems) {
      return (
        <div className="relative">
          <div
            data-slash-menu-panel
            className="w-[326px] overflow-hidden rounded-[14px] border border-[#e9e9e7] bg-white shadow-[0_12px_32px_rgba(15,15,15,0.1)] dark:border-[#3f3f3f] dark:bg-[#252525] dark:shadow-[0_12px_32px_rgba(0,0,0,0.34)]"
          >
            <div ref={scrollContainerRef} className="p-1.5">
              <button
                onClick={() => setSubView(null)}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] font-medium text-[#5e5d59] hover:bg-[#f1f1ef] dark:text-[#b8b8b8] dark:hover:bg-[#3a3a3a]"
              >
                <ChevronLeft className="h-3 w-3" />
                {t("blockMenu.back")}
              </button>
              {subView.subItems.map((sub, idx) => (
                <button
                  key={sub.titleKey}
                  data-command-item
                  onClick={() => selectSubItem(sub)}
                  onMouseEnter={() => setSubSelectedIndex(idx)}
                  className={cn(
                    "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[15px] text-[#37352f] dark:text-[#f1f1ef]",
                    idx === subSelectedIndex
                      ? "bg-[#e9e9e7] dark:bg-[#3d3d3d]"
                      : "hover:bg-[#f1f1ef] dark:hover:bg-[#333]"
                  )}
                >
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center text-[#5e5d59] dark:text-[#dedede]">
                    {sub.icon}
                  </div>
                  <p className="font-medium">{t(sub.titleKey)}</p>
                </button>
              ))}
            </div>
            <div className="flex h-[42px] items-center justify-between border-t border-[#e9e9e7] px-3 text-[15px] font-semibold text-[#37352f] dark:border-[#3a3a3a] dark:text-[#f1f1ef]">
              <span>{t("slashMenu.closeMenu")}</span>
              <span className="font-medium text-[#9b9a97] dark:text-[#8d8d8d]">esc</span>
            </div>
          </div>
        </div>
      );
    }

    // Group items by category while preserving order
    const groupedItems: {
      category: string;
      items: { item: CommandItem; displayIndex: number }[];
    }[] = [];
    let currentCategory = "";

    visibleItems.forEach(({ item }, displayIndex) => {
      const menuCategory = isSearching ? "filtered" : getMenuCategory(item);
      if (menuCategory !== currentCategory) {
        currentCategory = menuCategory;
        groupedItems.push({ category: menuCategory, items: [] });
      }
      groupedItems[groupedItems.length - 1].items.push({ item, displayIndex });
    });

    return (
      <div className="relative">
        <div
          data-slash-menu-panel
          className="w-[326px] overflow-hidden rounded-[14px] border border-[#e9e9e7] bg-white shadow-[0_12px_32px_rgba(15,15,15,0.1)] dark:border-[#3f3f3f] dark:bg-[#252525] dark:shadow-[0_12px_32px_rgba(0,0,0,0.34)]"
        >
          <div
            ref={scrollContainerRef}
            className="max-h-[408px] overflow-y-auto overflow-x-hidden px-1 py-4"
          >
            {groupedItems.map((group, groupIndex) => (
              <div key={`${group.category}-${groupIndex}`}>
                {/* Category separator */}
                {groupIndex > 0 && (
                  <div className="mx-0 my-3 h-px bg-[#e9e9e7] dark:bg-[#3a3a3a]" />
                )}

                {/* Category header */}
                <div className="px-3 pb-4 text-[13px] font-semibold leading-none text-[#5e5d59] dark:text-[#b8b8b8]">
                  {group.category === "filtered"
                    ? t("slashMenu.filteredResults")
                    : t(categoryLabelKeys[group.category] ?? group.category)}
                </div>

                {/* Items */}
                {group.items.map(({ item, displayIndex }) => (
                  <button
                    key={item.titleKey}
                    data-command-item
                    onClick={() => selectItem(displayIndex)}
                    onMouseEnter={() => setSelectedIndex(displayIndex)}
                    className={cn(
                      "flex h-8 w-full items-center gap-2 rounded-md px-3 text-left text-[15px] leading-tight text-[#37352f] dark:text-[#f1f1ef]",
                      displayIndex === selectedIndex
                        ? "bg-[#e9e9e7] dark:bg-[#3d3d3d]"
                        : "hover:bg-[#f1f1ef] dark:hover:bg-[#333]"
                    )}
                  >
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center text-[#5e5d59] dark:text-[#dedede] [&_svg]:h-[18px] [&_svg]:w-[18px]">
                      {item.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">
                        {t(item.menuTitleKey ?? item.titleKey)}
                        {isSearching && item.category === "database" && item.searchOnly && (
                          <span className="font-medium text-[#9b9a97] dark:text-[#8d8d8d]">
                            {" "}
                            · Database
                          </span>
                        )}
                        {isSearching && item.category === "turninto" && (
                          <span className="font-medium text-[#9b9a97] dark:text-[#8d8d8d]">
                            {" "}
                            · Turn into
                          </span>
                        )}
                      </p>
                    </div>
                    {item.hasSubItems && (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#9b9a97] dark:text-[#8d8d8d]" />
                    )}
                    {item.menuShortcut && !item.hasSubItems && (
                      <span className="shrink-0 text-[14px] font-semibold text-[#9b9a97] dark:text-[#8d8d8d]">
                        {item.menuShortcut}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="flex h-[42px] items-center justify-between border-t border-[#e9e9e7] px-3 text-[15px] font-semibold text-[#37352f] dark:border-[#3a3a3a] dark:text-[#f1f1ef]">
            <span>{t("slashMenu.closeMenu")}</span>
            <span className="font-medium text-[#9b9a97] dark:text-[#8d8d8d]">esc</span>
          </div>
        </div>
        {visibleItems[selectedIndex]?.item && (
          <PreviewCard
            key={visibleItems[selectedIndex].item.titleKey}
            item={visibleItems[selectedIndex].item}
            translatedTitle={t(
              visibleItems[selectedIndex].item.menuTitleKey ??
                visibleItems[selectedIndex].item.titleKey
            )}
          />
        )}
      </div>
    );
  }
);

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

          const matchesQuery = (item: CommandItem) => {
            if (!q) return true;
            if (item.title.toLowerCase().includes(q) || item.description.toLowerCase().includes(q))
              return true;
            if (item.searchKeywords?.some((kw) => kw.toLowerCase().includes(q))) return true;
            return false;
          };

          return commands.filter((item) => {
            // Internal-only blocks: never surfaced (not even via search) until
            // the corresponding feature flag is enabled.
            if (!ENABLE_DATABASE_BLOCKS && item.category === "database") return false;
            // Hidden categories: only show when query specifically matches
            if (item.category === "turninto" || item.category === "color" || item.searchOnly) {
              if (!q) return false;
              return matchesQuery(item);
            }
            // Normal items
            return matchesQuery(item);
          });
        },
        render: () => {
          let component: ReactRenderer<CommandListRef> | null = null;
          let wrapper: HTMLDivElement | null = null;
          let getClientRect: (() => DOMRect | null) | null = null;
          let scrollHandler: (() => void) | null = null;
          let positionToken = 0;
          let rafHandle = 0;

          const updatePosition = () => {
            if (!wrapper || !getClientRect) return;
            const rect = getClientRect();
            if (!rect) return;

            const virtualEl = {
              getBoundingClientRect: () => rect,
            };

            const token = ++positionToken;

            computePosition(virtualEl, wrapper, {
              strategy: "fixed",
              placement: "bottom-start",
              middleware: [offset(8), flip(), shift({ padding: 8 })],
            }).then(({ x, y }) => {
              if (!wrapper || token !== positionToken) return;
              Object.assign(wrapper.style, {
                left: `${x}px`,
                top: `${y}px`,
                visibility: "visible",
              });
            });
          };

          const schedulePosition = () => {
            if (rafHandle) cancelAnimationFrame(rafHandle);
            rafHandle = requestAnimationFrame(() => {
              rafHandle = 0;
              updatePosition();
            });
          };

          return {
            onStart: (props: {
              editor: Editor;
              range: Range;
              clientRect?: (() => DOMRect | null) | null;
            }) => {
              component = new ReactRenderer(CommandList, {
                props,
                editor: props.editor,
              });

              if (!props.clientRect) return;
              getClientRect = props.clientRect;

              wrapper = document.createElement("div");
              wrapper.style.position = "fixed";
              wrapper.style.top = "0";
              wrapper.style.left = "0";
              wrapper.style.zIndex = "9999";
              wrapper.style.visibility = "hidden";
              wrapper.appendChild(component.element);
              document.body.appendChild(wrapper);

              updatePosition();
              schedulePosition();

              scrollHandler = () => updatePosition();
              window.addEventListener("scroll", scrollHandler, true);
              window.addEventListener("resize", scrollHandler);
            },

            onUpdate: (props: {
              editor: Editor;
              range: Range;
              clientRect?: (() => DOMRect | null) | null;
            }) => {
              component?.updateProps(props);

              if (props.clientRect) {
                getClientRect = props.clientRect;
              }
              schedulePosition();
            },

            onKeyDown: (props: { event: KeyboardEvent }) => {
              if (props.event.key === "Escape") {
                if (wrapper) wrapper.style.display = "none";
                return true;
              }

              return component?.ref?.onKeyDown(props) ?? false;
            },

            onExit: () => {
              if (rafHandle) {
                cancelAnimationFrame(rafHandle);
                rafHandle = 0;
              }
              if (scrollHandler) {
                window.removeEventListener("scroll", scrollHandler, true);
                window.removeEventListener("resize", scrollHandler);
                scrollHandler = null;
              }
              if (wrapper) {
                wrapper.remove();
                wrapper = null;
              }
              component?.destroy();
              getClientRect = null;
              positionToken++;
            },
          };
        },
      }),
    ];
  },
});
