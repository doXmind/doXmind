/**
 * Shared Block Action Configurations
 *
 * Shared "Turn Into" options and block color options used by:
 * - Block Action Menu (block-action-menu.tsx)
 * - Bubble Menu (bubble-menu.tsx)
 * - Editor Context Menu (editor-context-menu.tsx)
 * - Slash Commands (slash-commands.tsx)
 */

import type { Editor } from "@tiptap/core";

export interface TurnIntoOption {
  label: string;
  /** Lucide icon name for lazy rendering — components should render icons themselves */
  iconName: string;
  action: (editor: Editor) => void;
  isActive: (editor: Editor) => boolean;
}

export interface TurnIntoSeparator {
  separator: true;
}

export type TurnIntoEntry = TurnIntoOption | TurnIntoSeparator;

export function isTurnIntoSeparator(entry: TurnIntoEntry): entry is TurnIntoSeparator {
  return "separator" in entry;
}

/**
 * Check if the cursor is inside any list node.
 */
function isInList(editor: Editor): boolean {
  return (
    editor.isActive("bulletList") || editor.isActive("orderedList") || editor.isActive("taskList")
  );
}

/**
 * Turn Into options — shared across all menus
 *
 * Every action uses clearNodes() before applying the target type so that
 * conversions work correctly from ANY source context (lists, code blocks,
 * blockquotes, callouts, toggles, etc.).
 */
export const turnIntoOptions: TurnIntoEntry[] = [
  {
    label: "Text",
    iconName: "Type",
    action: (editor: Editor) => {
      // clearNodes strips all block formatting (lists, headings, etc.) → paragraph
      editor.chain().focus().clearNodes().run();
    },
    isActive: (editor: Editor) =>
      editor.isActive("paragraph") &&
      !editor.isActive("bulletList") &&
      !editor.isActive("orderedList") &&
      !editor.isActive("taskList"),
  },
  {
    label: "Heading 1",
    iconName: "Heading1",
    action: (editor: Editor) => {
      if (editor.isActive("heading", { level: 1 })) {
        editor.chain().focus().clearNodes().run();
      } else {
        editor.chain().focus().clearNodes().setHeading({ level: 1 }).run();
      }
    },
    isActive: (editor: Editor) => editor.isActive("heading", { level: 1 }),
  },
  {
    label: "Heading 2",
    iconName: "Heading2",
    action: (editor: Editor) => {
      if (editor.isActive("heading", { level: 2 })) {
        editor.chain().focus().clearNodes().run();
      } else {
        editor.chain().focus().clearNodes().setHeading({ level: 2 }).run();
      }
    },
    isActive: (editor: Editor) => editor.isActive("heading", { level: 2 }),
  },
  {
    label: "Heading 3",
    iconName: "Heading3",
    action: (editor: Editor) => {
      if (editor.isActive("heading", { level: 3 })) {
        editor.chain().focus().clearNodes().run();
      } else {
        editor.chain().focus().clearNodes().setHeading({ level: 3 }).run();
      }
    },
    isActive: (editor: Editor) => editor.isActive("heading", { level: 3 }),
  },
  { separator: true },
  {
    label: "Bullet List",
    iconName: "List",
    action: (editor: Editor) => {
      if (editor.isActive("bulletList")) {
        editor.chain().focus().clearNodes().run();
      } else if (isInList(editor)) {
        // From another list type: clear first to avoid listItem/taskItem conflicts
        editor.chain().focus().clearNodes().toggleBulletList().run();
      } else {
        editor.chain().focus().toggleBulletList().run();
      }
    },
    isActive: (editor: Editor) => editor.isActive("bulletList"),
  },
  {
    label: "Numbered List",
    iconName: "ListOrdered",
    action: (editor: Editor) => {
      if (editor.isActive("orderedList")) {
        editor.chain().focus().clearNodes().run();
      } else if (isInList(editor)) {
        editor.chain().focus().clearNodes().toggleOrderedList().run();
      } else {
        editor.chain().focus().toggleOrderedList().run();
      }
    },
    isActive: (editor: Editor) => editor.isActive("orderedList"),
  },
  {
    label: "Task List",
    iconName: "ListTodo",
    action: (editor: Editor) => {
      if (editor.isActive("taskList")) {
        editor.chain().focus().clearNodes().run();
      } else if (isInList(editor)) {
        editor.chain().focus().clearNodes().toggleTaskList().run();
      } else {
        editor.chain().focus().toggleTaskList().run();
      }
    },
    isActive: (editor: Editor) => editor.isActive("taskList"),
  },
  { separator: true },
  {
    label: "Quote",
    iconName: "Quote",
    action: (editor: Editor) => {
      if (editor.isActive("blockquote")) {
        editor.chain().focus().clearNodes().run();
      } else if (isInList(editor)) {
        editor.chain().focus().clearNodes().toggleBlockquote().run();
      } else {
        editor.chain().focus().toggleBlockquote().run();
      }
    },
    isActive: (editor: Editor) => editor.isActive("blockquote"),
  },
  {
    label: "Code Block",
    iconName: "Code",
    action: (editor: Editor) => {
      if (editor.isActive("codeBlock")) {
        editor.chain().focus().clearNodes().run();
      } else if (isInList(editor)) {
        editor.chain().focus().clearNodes().toggleCodeBlock().run();
      } else {
        editor.chain().focus().toggleCodeBlock().run();
      }
    },
    isActive: (editor: Editor) => editor.isActive("codeBlock"),
  },
  {
    label: "Callout",
    iconName: "MessageSquareQuote",
    action: (editor: Editor) => {
      if (editor.isActive("callout")) {
        editor.chain().focus().clearNodes().run();
      } else {
        editor.chain().focus().clearNodes().setCallout({ type: "info" }).run();
      }
    },
    isActive: (editor: Editor) => editor.isActive("callout"),
  },
  {
    label: "Toggle",
    iconName: "ChevronRight",
    action: (editor: Editor) => {
      if (editor.isActive("toggle")) {
        editor.chain().focus().clearNodes().run();
      } else {
        editor.chain().focus().clearNodes().setToggle().run();
      }
    },
    isActive: (editor: Editor) => editor.isActive("toggle"),
  },
];

export interface BlockColorOption {
  label: string;
  value: string; // CSS color value, empty string = default
  preview: string; // Tailwind bg class for the color preview dot
}

export const textColorOptions: BlockColorOption[] = [
  { label: "Default", value: "", preview: "bg-foreground" },
  { label: "Gray", value: "#64748b", preview: "bg-slate-500" },
  { label: "Brown", value: "#92400e", preview: "bg-amber-800" },
  { label: "Red", value: "#ef4444", preview: "bg-red-500" },
  { label: "Pink", value: "#ec4899", preview: "bg-pink-500" },
  { label: "Orange", value: "#f97316", preview: "bg-orange-500" },
  { label: "Yellow", value: "#eab308", preview: "bg-yellow-500" },
  { label: "Green", value: "#22c55e", preview: "bg-green-500" },
  { label: "Teal", value: "#14b8a6", preview: "bg-teal-500" },
  { label: "Blue", value: "#3b82f6", preview: "bg-blue-500" },
  { label: "Indigo", value: "#6366f1", preview: "bg-indigo-500" },
  { label: "Purple", value: "#a855f7", preview: "bg-purple-500" },
];

export const bgColorOptions: BlockColorOption[] = [
  { label: "Default", value: "", preview: "bg-background" },
  { label: "Gray", value: "#f1f5f9", preview: "bg-slate-100" },
  { label: "Brown", value: "#fef3c7", preview: "bg-amber-100" },
  { label: "Red", value: "#fee2e2", preview: "bg-red-100" },
  { label: "Pink", value: "#fce7f3", preview: "bg-pink-100" },
  { label: "Orange", value: "#ffedd5", preview: "bg-orange-100" },
  { label: "Yellow", value: "#fef9c3", preview: "bg-yellow-100" },
  { label: "Green", value: "#dcfce7", preview: "bg-green-100" },
  { label: "Teal", value: "#ccfbf1", preview: "bg-teal-100" },
  { label: "Blue", value: "#dbeafe", preview: "bg-blue-100" },
  { label: "Indigo", value: "#e0e7ff", preview: "bg-indigo-100" },
  { label: "Purple", value: "#f3e8ff", preview: "bg-purple-100" },
];
