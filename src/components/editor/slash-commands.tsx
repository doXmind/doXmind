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
  ChevronLeft,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn, formatShortcut } from "@/lib/utils";
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
  descKey: string;
  icon: React.ReactNode;
  category: "basic" | "lists" | "media" | "database" | "layout" | "advanced" | "turninto" | "color";
  shortcut?: string;
  searchOnly?: boolean;
  hasSubItems?: boolean;
  subItems?: CommandSubItem[];
  searchKeywords?: string[];
  command: (props: { editor: Editor; range: Range }) => void;
}

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
    searchOnly: true,
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
    searchOnly: true,
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
    searchOnly: true,
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
    searchKeywords: ["引用", "引用块"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run();
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
      editor.chain().focus().deleteRange(range).setCallout({ type: "info" }).run();
    },
  },
  {
    title: "Toggle",
    description: "Collapsible content block",
    titleKey: "blockMenu.toggle",
    descKey: "blockMenu.toggleDesc",
    icon: <ChevronRight className="h-4 w-4" />,
    category: "basic",
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
    descKey: "blockMenu.linkToPageDesc",
    icon: <FileText className="h-4 w-4" />,
    category: "basic",
    searchKeywords: ["页面链接", "链接到页面"],
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
    titleKey: "blockMenu.bulletList",
    descKey: "blockMenu.bulletListDesc",
    icon: <List className="h-4 w-4" />,
    category: "lists",
    shortcut: "Ctrl+Shift+8",
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
      editor.chain().focus().deleteRange(range).toggleBlockquote().run();
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
      editor.chain().focus().deleteRange(range).setCallout({ type: "info" }).run();
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
        <div className="text-ui-base space-y-1.5 leading-relaxed text-popover-foreground/80">
          <p>Start writing with plain text. Use commands to add formatting and blocks.</p>
        </div>
      );

    case "Heading 1":
      return (
        <div className="space-y-1">
          <p className="text-ui-xl font-bold leading-tight text-popover-foreground">
            Large section heading
          </p>
          <p className="text-ui-xs text-muted-foreground">Used for major document sections</p>
        </div>
      );

    case "Heading 2":
      return (
        <div className="space-y-1">
          <p className="text-ui-lg font-bold leading-tight text-popover-foreground">
            Medium section heading
          </p>
          <p className="text-ui-xs text-muted-foreground">Used for sub-sections</p>
        </div>
      );

    case "Heading 3":
      return (
        <div className="space-y-1">
          <p className="text-ui-md font-semibold leading-tight text-popover-foreground">
            Small section heading
          </p>
          <p className="text-ui-xs text-muted-foreground">Used for nested sections</p>
        </div>
      );

    case "Heading 4":
      return (
        <div className="space-y-1">
          <p className="text-ui-base font-semibold leading-tight text-popover-foreground">
            Extra small heading
          </p>
          <p className="text-ui-xs text-muted-foreground">Minor section divider</p>
        </div>
      );

    case "Heading 5":
      return (
        <div className="space-y-1">
          <p className="text-ui-base font-semibold leading-tight text-popover-foreground">
            Minor heading
          </p>
          <p className="text-ui-xs text-muted-foreground">Small section label</p>
        </div>
      );

    case "Heading 6":
      return (
        <div className="space-y-1">
          <p className="text-ui-sm font-semibold uppercase tracking-wide text-popover-foreground">
            Smallest heading
          </p>
          <p className="text-ui-xs text-muted-foreground">Fine-grained section label</p>
        </div>
      );

    case "Quote":
      return (
        <div className="border-l-[3px] border-popover-foreground/20 pl-3">
          <p className="text-ui-base italic leading-relaxed text-muted-foreground">
            &ldquo;The only way to do great work is to love what you do.&rdquo;
          </p>
        </div>
      );

    case "Callout":
      return (
        <div className="rounded-md border border-blue-200/50 bg-blue-50/50 p-2 dark:border-blue-800/50 dark:bg-blue-950/30">
          <div className="flex items-start gap-2">
            <span className="text-sm">&#x2139;&#xfe0f;</span>
            <p className="text-ui-sm leading-relaxed text-popover-foreground/80">
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
            <p className="text-ui-base font-medium text-popover-foreground">Toggle heading</p>
          </div>
          <div className="ml-5 rounded border border-dashed border-border/60 px-2 py-1">
            <p className="text-ui-xs text-muted-foreground">Hidden content inside...</p>
          </div>
        </div>
      );

    case "Table of Contents":
      return (
        <div className="text-ui-sm space-y-1">
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
          <p className="text-ui-xs text-muted-foreground">Content above</p>
          <hr className="w-full border-border" />
          <p className="text-ui-xs text-muted-foreground">Content below</p>
        </div>
      );

    case "Bullet List":
      return (
        <div className="text-ui-sm space-y-1 pl-1 text-popover-foreground/80">
          <p>&#x2022; First bullet point</p>
          <p>&#x2022; Second bullet point</p>
          <p>&#x2022; Third bullet point</p>
        </div>
      );

    case "Numbered List":
      return (
        <div className="text-ui-sm space-y-1 pl-1 text-popover-foreground/80">
          <p>1. First item</p>
          <p>2. Second item</p>
          <p>3. Third item</p>
        </div>
      );

    case "Task List":
      return (
        <div className="text-ui-sm space-y-1 text-popover-foreground/80">
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
          <p className="text-ui-xs text-muted-foreground">Upload or embed an image</p>
        </div>
      );

    case "Table":
      return (
        <div className="text-ui-xs overflow-hidden rounded border border-border/70">
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
        <div className="text-ui-xs rounded-md bg-zinc-900 p-2.5 font-mono leading-relaxed text-zinc-300 dark:bg-zinc-800">
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
          <p className="text-ui-md font-serif italic text-popover-foreground">E = mc&sup2;</p>
        </div>
      );

    case "Mermaid Chart":
      return (
        <div className="text-ui-xs rounded-md border border-border/50 bg-muted/30 p-2.5 font-mono leading-relaxed text-muted-foreground">
          <p>graph LR</p>
          <p className="pl-2">A[&quot;Start&quot;] --&gt; B[&quot;End&quot;]</p>
        </div>
      );

    case "Inline Math":
      return (
        <div className="text-ui-base leading-relaxed text-popover-foreground/80">
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
              <p className="text-ui-sm font-medium text-popover-foreground">
                Netscape (web browser)
              </p>
              <p className="text-ui-xs leading-relaxed text-muted-foreground">
                Netscape is the general name for a web browser...
              </p>
              <div className="flex items-center gap-1">
                <Globe className="h-2.5 w-2.5 text-muted-foreground" />
                <span className="text-ui-xs text-muted-foreground">en.wikipedia.org</span>
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
          <span className="text-ui-base text-popover-foreground underline underline-offset-2">
            Tasks
          </span>
        </div>
      );

    case "Table view":
      return (
        <div className="text-ui-xs overflow-hidden rounded border border-border/70">
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
                  className={`text-ui-xs inline-block rounded px-1.5 py-0.5 font-medium ${row.color}`}
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
                <span className="text-ui-xs font-medium text-muted-foreground">{col.label}</span>
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
        <div className="text-ui-xs space-y-0.5">
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
              <p className="text-ui-sm text-zinc-700">
                Sample text with {item.title.toLowerCase()}
              </p>
            </div>
          );
        }
      }
      // Fallback: show description
      return (
        <p className="text-ui-base leading-relaxed text-muted-foreground">{item.description}</p>
      );
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
        "absolute top-0 hidden w-[220px] rounded-xl border border-border/70 bg-popover p-3 shadow-xl md:block",
        flipToLeft ? "right-full mr-2" : "left-full ml-2"
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-5 w-5 items-center justify-center text-muted-foreground">
          {item.icon}
        </div>
        <span className="text-ui-sm font-semibold text-muted-foreground/80">{translatedTitle}</span>
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
  const t = useTranslations("editor");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [subView, setSubView] = useState<CommandItem | null>(null);
  const [subSelectedIndex, setSubSelectedIndex] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const selectItem = useCallback(
    (index: number) => {
      const item = items[index];
      if (item) {
        if (item.hasSubItems && item.subItems) {
          setSubView(item);
          setSubSelectedIndex(0);
        } else {
          command(item);
        }
      }
    },
    [items, command]
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
    return <div className="p-2 text-sm text-muted-foreground">{t("blockMenu.noResults")}</div>;
  }

  // Sub-view rendering
  if (subView && subView.subItems) {
    return (
      <div className="relative">
        <div className="w-[420px] overflow-hidden rounded-xl border border-border/70 bg-popover shadow-xl">
          <div ref={scrollContainerRef} className="p-1.5">
            <button
              onClick={() => setSubView(null)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent/50"
            >
              <ChevronLeft className="h-3 w-3" />
              {t("blockMenu.back")}
            </button>
            <div className="mx-1 my-1 h-px bg-border" />
            {subView.subItems.map((sub, idx) => (
              <button
                key={sub.titleKey}
                data-command-item
                onClick={() => selectSubItem(sub)}
                onMouseEnter={() => setSubSelectedIndex(idx)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-2 py-1 text-left text-base",
                  idx === subSelectedIndex
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50"
                )}
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center text-muted-foreground">
                  {sub.icon}
                </div>
                <p className="font-medium">{t(sub.titleKey)}</p>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-sm text-muted-foreground/85">
            <span>{t("slashMenu.closeMenu")}</span>
            <span>esc</span>
          </div>
        </div>
      </div>
    );
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
              <div className="text-ui-sm px-2 pb-0.5 pt-1 font-semibold text-muted-foreground/80">
                {t(categoryLabelKeys[group.category] ?? group.category)}
              </div>

              <div className="mx-1 my-1 h-px bg-border" />

              {/* Items */}
              {group.items.map(({ item, globalIndex }) => (
                <button
                  key={item.titleKey}
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
                    <p className="font-medium">{t(item.titleKey)}</p>
                  </div>
                  {item.hasSubItems && (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                  )}
                  {item.shortcut && !item.hasSubItems && (
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
          <span>{t("slashMenu.closeMenu")}</span>
          <span>esc</span>
        </div>
      </div>
      {items[selectedIndex] && (
        <PreviewCard
          key={items[selectedIndex].titleKey}
          item={items[selectedIndex]}
          translatedTitle={t(items[selectedIndex].titleKey)}
        />
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

          const matchesQuery = (item: CommandItem) => {
            if (!q) return true;
            if (item.title.toLowerCase().includes(q) || item.description.toLowerCase().includes(q))
              return true;
            if (item.searchKeywords?.some((kw) => kw.toLowerCase().includes(q))) return true;
            return false;
          };

          return commands.filter((item) => {
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
