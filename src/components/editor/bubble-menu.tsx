"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { BubbleMenu, Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Link as LinkIcon,
  Highlighter,
  Sparkles,
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  ChevronDown,
} from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor-store";
import { isDiffReviewActive } from "@/extensions/diff-review";
import { LinkModal } from "./link-modal";

interface BubbleMenuComponentProps {
  editor: Editor;
  disabled?: boolean;
}

const turnIntoOptions = [
  {
    label: "Text",
    icon: <Type className="h-4 w-4" />,
    action: (editor: Editor) => editor.chain().focus().setParagraph().run(),
    isActive: (editor: Editor) =>
      editor.isActive("paragraph") &&
      !editor.isActive("bulletList") &&
      !editor.isActive("orderedList") &&
      !editor.isActive("taskList"),
  },
  {
    label: "Heading 1",
    icon: <Heading1 className="h-4 w-4" />,
    action: (editor: Editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    isActive: (editor: Editor) => editor.isActive("heading", { level: 1 }),
  },
  {
    label: "Heading 2",
    icon: <Heading2 className="h-4 w-4" />,
    action: (editor: Editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    isActive: (editor: Editor) => editor.isActive("heading", { level: 2 }),
  },
  {
    label: "Heading 3",
    icon: <Heading3 className="h-4 w-4" />,
    action: (editor: Editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    isActive: (editor: Editor) => editor.isActive("heading", { level: 3 }),
  },
  { separator: true as const },
  {
    label: "Bullet List",
    icon: <List className="h-4 w-4" />,
    action: (editor: Editor) => editor.chain().focus().toggleBulletList().run(),
    isActive: (editor: Editor) => editor.isActive("bulletList"),
  },
  {
    label: "Numbered List",
    icon: <ListOrdered className="h-4 w-4" />,
    action: (editor: Editor) => editor.chain().focus().toggleOrderedList().run(),
    isActive: (editor: Editor) => editor.isActive("orderedList"),
  },
  {
    label: "Task List",
    icon: <ListTodo className="h-4 w-4" />,
    action: (editor: Editor) => editor.chain().focus().toggleTaskList().run(),
    isActive: (editor: Editor) => editor.isActive("taskList"),
  },
  { separator: true as const },
  {
    label: "Quote",
    icon: <Quote className="h-4 w-4" />,
    action: (editor: Editor) => editor.chain().focus().toggleBlockquote().run(),
    isActive: (editor: Editor) => editor.isActive("blockquote"),
  },
  {
    label: "Code Block",
    icon: <Code className="h-4 w-4" />,
    action: (editor: Editor) => editor.chain().focus().toggleCodeBlock().run(),
    isActive: (editor: Editor) => editor.isActive("codeBlock"),
  },
];

function getCurrentBlockLabel(editor: Editor): string {
  if (editor.isActive("heading", { level: 1 })) return "H1";
  if (editor.isActive("heading", { level: 2 })) return "H2";
  if (editor.isActive("heading", { level: 3 })) return "H3";
  if (editor.isActive("bulletList")) return "List";
  if (editor.isActive("orderedList")) return "Num";
  if (editor.isActive("taskList")) return "Task";
  if (editor.isActive("blockquote")) return "Quote";
  if (editor.isActive("codeBlock")) return "Code";
  return "Aa";
}

export function BubbleMenuComponent({ editor }: BubbleMenuComponentProps) {
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const { openQuickEdit } = useEditorStore();

  const handleAIEdit = (event: React.MouseEvent) => {
    const button = event.currentTarget as HTMLElement;
    const rect = button.getBoundingClientRect();
    openQuickEdit({ x: rect.left, y: rect.bottom + 5 });
  };

  const handleLinkConfirm = (url: string) => {
    editor.chain().focus().setLink({ href: url }).run();
  };

  const shouldShow = useCallback(() => {
    if (isDiffReviewActive(editor)) return false;
    const { from, to } = editor.state.selection;
    const hasSelection = to - from > 0;
    const isInTable = editor.isActive("table");
    const isImage = editor.isActive("image");
    const isInlineMath = editor.isActive("inlineMath");
    const isBlockMath = editor.isActive("blockMath");
    return hasSelection && !isInTable && !isImage && !isInlineMath && !isBlockMath;
  }, [editor]);

  return (
    <>
      <LinkModal
        open={linkModalOpen}
        onClose={() => setLinkModalOpen(false)}
        onConfirm={handleLinkConfirm}
      />
      <BubbleMenu
        editor={editor}
        tippyOptions={{
          duration: 0,
          animation: false,
        }}
        shouldShow={shouldShow}
        className="bubble-menu rounded-lg border border-border bg-popover p-1 shadow-lg"
      >
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{
            type: "spring",
            stiffness: 500,
            damping: 30,
            mass: 0.8,
          }}
          className="flex items-center gap-0.5"
        >
          {/* Turn Into dropdown */}
          <DropdownMenu>
            <Tooltip content="Turn into" side="top">
              <DropdownMenuTrigger asChild>
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  className="inline-flex h-11 items-center gap-0.5 rounded-md px-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground md:h-8 md:px-1.5"
                >
                  <span className="text-xs">{getCurrentBlockLabel(editor)}</span>
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </motion.button>
              </DropdownMenuTrigger>
            </Tooltip>
            <DropdownMenuContent align="start" className="min-w-[160px]">
              {turnIntoOptions.map((option, index) => {
                if ("separator" in option) {
                  return <DropdownMenuSeparator key={`sep-${index}`} />;
                }
                return (
                  <DropdownMenuItem
                    key={option.label}
                    onClick={() => option.action(editor)}
                    className={cn(option.isActive(editor) && "bg-accent")}
                  >
                    {option.icon}
                    <span className="ml-2">{option.label}</span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="mx-0.5 h-5 w-px bg-border" />

          <BubbleButton
            icon={<Bold className="h-4 w-4" />}
            onClick={() => editor.chain().focus().toggleBold().run()}
            isActive={editor.isActive("bold")}
            tooltip="Bold (Ctrl+B)"
          />
          <BubbleButton
            icon={<Italic className="h-4 w-4" />}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            isActive={editor.isActive("italic")}
            tooltip="Italic (Ctrl+I)"
          />
          <BubbleButton
            icon={<Underline className="h-4 w-4" />}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            isActive={editor.isActive("underline")}
            tooltip="Underline (Ctrl+U)"
          />
          <BubbleButton
            icon={<Strikethrough className="h-4 w-4" />}
            onClick={() => editor.chain().focus().toggleStrike().run()}
            isActive={editor.isActive("strike")}
            tooltip="Strikethrough"
          />
          <BubbleButton
            icon={<Code className="h-4 w-4" />}
            onClick={() => editor.chain().focus().toggleCode().run()}
            isActive={editor.isActive("code")}
            tooltip="Inline Code (Ctrl+E)"
          />
          <BubbleButton
            icon={<Highlighter className="h-4 w-4" />}
            onClick={() => editor.chain().focus().toggleHighlight().run()}
            isActive={editor.isActive("highlight")}
            tooltip="Highlight"
          />
          <BubbleButton
            icon={<LinkIcon className="h-4 w-4" />}
            onClick={() => setLinkModalOpen(true)}
            isActive={editor.isActive("link")}
            tooltip="Add Link (Ctrl+K)"
          />

          <div className="mx-1 h-5 w-px bg-border" />

          <BubbleButton
            icon={<Sparkles className="h-4 w-4" />}
            onClick={handleAIEdit}
            className="text-primary"
            tooltip="AI Edit"
          />
        </motion.div>
      </BubbleMenu>
    </>
  );
}

interface BubbleButtonProps {
  icon: React.ReactNode;
  onClick: (event: React.MouseEvent) => void;
  isActive?: boolean;
  className?: string;
  tooltip?: string;
}

function BubbleButton({ icon, onClick, isActive, className, tooltip }: BubbleButtonProps) {
  const button = (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.95 }}
      transition={{ type: "spring", stiffness: 400, damping: 20 }}
      className={cn(
        "h-11 w-11 md:h-8 md:w-8",
        "inline-flex items-center justify-center rounded-md",
        "hover:bg-accent hover:text-accent-foreground",
        isActive && "bg-accent text-accent-foreground",
        className
      )}
    >
      <span className="[&>svg]:h-5 [&>svg]:w-5 md:[&>svg]:h-4 md:[&>svg]:w-4">{icon}</span>
    </motion.button>
  );

  if (tooltip) {
    return (
      <Tooltip content={tooltip} side="top">
        {button}
      </Tooltip>
    );
  }

  return button;
}
