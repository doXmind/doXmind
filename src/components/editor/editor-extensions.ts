/**
 * Editor Extensions Configuration
 *
 * Centralized configuration for all TipTap editor extensions.
 */

import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Placeholder from "@tiptap/extension-placeholder";
import Highlight from "@tiptap/extension-highlight";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Underline from "@tiptap/extension-underline";
import Typography from "@tiptap/extension-typography";
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import { ResizableImage } from "@/extensions/resizable-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { CustomCodeBlock } from "@/extensions/code-block";
import { Columns, Column } from "@/extensions/columns";
import { TableOfContents } from "@/extensions/toc";
import { WebBookmark } from "@/extensions/web-bookmark";
import { DatabaseBlock } from "@/extensions/database";
import { LinkPaste } from "@/extensions/link-paste";
import { TrailingNode } from "@/extensions/trailing-node";
import { SlashCommands } from "./slash-commands";
import { SearchExtension } from "@/extensions/search";
import { BlockSelectionExtension } from "@/extensions/block-selection-extension";
import { BlockHandleExtension } from "@/extensions/block-handle-extension";
import { BlockColorExtension } from "@/extensions/block-color-extension";
import { AtomBlockLiftPlugin } from "@/extensions/atom-block-lift-plugin";
import { customBlockTipTapExtensions } from "@/extensions/registry";
import type { Extensions } from "@tiptap/react";

/**
 * Get all editor extensions with their configurations
 */
export function getEditorExtensions(): Extensions {
  const extensions: Extensions = [
    // Core editing
    StarterKit.configure({
      codeBlock: false, // We use CodeBlockLowlight instead
      heading: {
        levels: [1, 2, 3, 4, 5, 6],
      },
      // Disable extensions bundled by StarterKit v3 that we configure manually below
      link: false,
      underline: false,
      trailingNode: false,
    }),

    // Markdown serialization (schema-aware editor.getMarkdown() / editor.markdown.parse())
    Markdown,

    // Text enhancements
    Underline,
    TextStyle,
    Color,
    Highlight.configure({
      multicolor: true,
    }),
    Typography,
    TextAlign.configure({
      types: ["heading", "paragraph"],
      alignments: ["left", "center", "right"],
      defaultAlignment: "left",
    }),

    // Links
    Link.configure({
      openOnClick: false,
      HTMLAttributes: {
        class: "text-primary underline underline-offset-2 cursor-pointer",
      },
    }),

    // Images
    ResizableImage.configure({
      HTMLAttributes: {
        class: "rounded-lg max-w-full",
      },
      allowBase64: true,
    }),

    // Task lists
    TaskList,
    TaskItem.configure({
      nested: true,
    }),

    // Tables
    Table.configure({
      resizable: true,
      // Lower than TipTap's 25 but well below the old 200, which forced any
      // resize to balloon the table past the content column for short cells.
      cellMinWidth: 50,
    }),
    TableRow,
    TableCell,
    TableHeader,

    // Code blocks with syntax highlighting (custom Notion-style)
    CustomCodeBlock,

    // Custom Block Extensions registry — Self-contained (mermaid, callout, math,
    // toggle, page-link) and External-reference (pdf-block, excel-block) blocks.
    ...customBlockTipTapExtensions,

    // Auto-lift atom blocks (mermaid, math, image, hr, toc) out of list items
    AtomBlockLiftPlugin,

    // Multi-column layout (2–5 columns)
    Columns,
    Column,

    // Table of Contents (auto-generated from headings)
    TableOfContents,

    // Web Bookmark (visual URL card)
    WebBookmark,

    // Notion-style database block (deprecated; not migrated to registry per ADR-0004)
    DatabaseBlock,

    // Link paste auto-conversion
    LinkPaste,

    // Ensure document always ends with an editable paragraph
    TrailingNode,

    // Custom extensions
    SlashCommands,
    SearchExtension,

    // Block color support (text and background colors for blocks)
    BlockColorExtension,

    BlockSelectionExtension.configure({
      enabled: true,
      selectionMode: "desktop",
    }),

    BlockHandleExtension,

    Placeholder.configure({
      placeholder: "Type '/' for commands",
      showOnlyCurrent: true,
      includeChildren: true,
    }),
  ];

  return extensions;
}

/**
 * Default editor props for styling
 */
export const defaultEditorProps = {
  attributes: {
    class: "prose prose-sm sm:prose dark:prose-invert max-w-none focus:outline-none",
  },
};
