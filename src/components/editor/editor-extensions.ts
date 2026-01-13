/**
 * Editor Extensions Configuration
 *
 * Centralized configuration for all TipTap editor extensions.
 */

import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Highlight from "@tiptap/extension-highlight";
import Typography from "@tiptap/extension-typography";
import Link from "@tiptap/extension-link";
import { ResizableImage } from "@/extensions/resizable-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import { SlashCommands } from "./slash-commands";
import { AutocompleteExtension } from "@/extensions/autocomplete-extension";
import { AutocompleteKeymap } from "@/extensions/autocomplete-keymap";
import { SearchExtension } from "@/extensions/search-extension";
import { SpellcheckExtension } from "@/extensions/spellcheck-extension";
import { DiffReviewExtension } from "@/extensions/diff-review-extension";
import { TextReviewExtension } from "@/extensions/text-review-extension";
import type { Extensions } from "@tiptap/react";

// Initialize lowlight for code highlighting
const lowlight = createLowlight(common);

/**
 * Get all editor extensions with their configurations
 */
export function getEditorExtensions(): Extensions {
  return [
    // Core editing
    StarterKit.configure({
      codeBlock: false, // We use CodeBlockLowlight instead
      heading: {
        levels: [1, 2, 3, 4],
      },
    }),

    // Text enhancements
    Placeholder.configure({
      placeholder: "Start writing, or press '/' for commands...",
    }),
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

    // Code blocks with syntax highlighting
    CodeBlockLowlight.configure({
      lowlight,
    }),

    // Custom extensions
    SlashCommands,
    AutocompleteExtension,
    AutocompleteKeymap,
    SearchExtension,
    SpellcheckExtension,
    DiffReviewExtension,
    TextReviewExtension,
  ];
}

/**
 * Default editor props for styling
 */
export const defaultEditorProps = {
  attributes: {
    class: "prose prose-sm sm:prose dark:prose-invert max-w-none focus:outline-none",
  },
};
