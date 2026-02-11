/**
 * Editor Extensions Configuration
 *
 * Centralized configuration for all TipTap editor extensions.
 */

import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Highlight from "@tiptap/extension-highlight";
import Underline from "@tiptap/extension-underline";
import Typography from "@tiptap/extension-typography";
import Link from "@tiptap/extension-link";
import { ResizableImage } from "@/extensions/resizable-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { CustomCodeBlock } from "@/extensions/code-block";
import { InlineMath, BlockMath } from "@/extensions/math";
import { Callout } from "@/extensions/callout";
import { Toggle } from "@/extensions/toggle";
import { TableOfContents } from "@/extensions/toc";
import { LinkPaste } from "@/extensions/link-paste";
import { TrailingNode } from "@/extensions/trailing-node";
import { SlashCommands } from "./slash-commands";
import { AutocompleteExtension } from "@/extensions/autocomplete-extension";
import { AutocompleteKeymap } from "@/extensions/autocomplete-keymap";
import { SearchExtension } from "@/extensions/search";
import { SpellcheckExtension } from "@/extensions/spellcheck-extension";
import { DiffReviewExtension } from "@/extensions/diff-review";
import { TextReviewExtension } from "@/extensions/text-review-extension";
import { BlockSelectionExtension } from "@/extensions/block-selection-extension";
import type { Extensions } from "@tiptap/react";

export interface EditorExtensionsOptions {
  /** Whether block selection is enabled (for mobile) */
  enableBlockSelection?: boolean;
  /** Whether running on mobile device */
  isMobile?: boolean;
}

/**
 * Get all editor extensions with their configurations
 */
export function getEditorExtensions(options: EditorExtensionsOptions = {}): Extensions {
  const { enableBlockSelection = false, isMobile = false } = options;

  const extensions: Extensions = [
    // Core editing
    StarterKit.configure({
      codeBlock: false, // We use CodeBlockLowlight instead
      heading: {
        levels: [1, 2, 3, 4],
      },
    }),

    // Text enhancements
    Underline,
    Highlight.configure({
      multicolor: true,
    }),
    Typography,

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
    }),
    TableRow,
    TableCell,
    TableHeader,

    // Code blocks with syntax highlighting (custom Notion-style)
    CustomCodeBlock,

    // Math support (LaTeX/KaTeX)
    InlineMath,
    BlockMath,

    // Callout blocks (info, warning, error, tip)
    Callout,

    // Toggle/collapsible blocks
    Toggle,

    // Table of Contents (auto-generated from headings)
    TableOfContents,

    // Link paste auto-conversion
    LinkPaste,

    // Ensure document always ends with an editable paragraph
    TrailingNode,

    // Custom extensions
    SlashCommands,
    AutocompleteExtension,
    SearchExtension,
    SpellcheckExtension,
    DiffReviewExtension,
    TextReviewExtension,

    // Mobile block selection (long-press to select)
    BlockSelectionExtension.configure({
      enabled: enableBlockSelection,
    }),

    // AutocompleteKeymap MUST be last to ensure Tab handler has highest priority
    // TipTap processes keyboard shortcuts in reverse order (last extension first)
    AutocompleteKeymap,
  ];

  // Only add Placeholder extension on desktop (mobile uses custom empty state UI)
  if (!isMobile) {
    extensions.push(
      Placeholder.configure({
        placeholder: "Start writing, or press '/' for commands...",
      })
    );
  }

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
