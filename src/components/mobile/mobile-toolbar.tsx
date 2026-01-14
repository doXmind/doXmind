"use client";

import { useState } from "react";
import { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Minus,
  Link as LinkIcon,
  Image as ImageIcon,
  Table as TableIcon,
  Undo,
  Redo,
  Highlighter,
  ChevronDown,
  ChevronUp,
  Sigma,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { MOBILE_PANEL } from "@/lib/constants";

interface MobileToolbarProps {
  editor: Editor;
  onLinkClick?: () => void;
  onImageClick?: () => void;
}

interface ToolbarButtonProps {
  icon: React.ReactNode;
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  label: string;
}

function ToolbarButton({
  icon,
  onClick,
  isActive,
  disabled,
  label,
}: ToolbarButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-11 w-11 flex-shrink-0",
        "active:scale-95 transition-transform",
        isActive && "bg-accent text-accent-foreground"
      )}
      aria-label={label}
    >
      {icon}
    </Button>
  );
}

function ToolbarDivider() {
  return <div className="w-px h-6 bg-border mx-1 flex-shrink-0" />;
}

export function MobileToolbar({
  editor,
  onLinkClick,
  onImageClick,
}: MobileToolbarProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const addTable = () => {
    editor
      .chain()
      .focus()
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
      .run();
  };

  return (
    <div className="border-b border-border bg-card md:hidden">
      {/* Primary Row - Always Visible */}
      <div
        className="flex items-center px-2 gap-0.5"
        style={{ height: MOBILE_PANEL.TOOLBAR_COLLAPSED }}
      >
        {/* History */}
        <ToolbarButton
          icon={<Undo className="h-5 w-5" />}
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          label="Undo"
        />
        <ToolbarButton
          icon={<Redo className="h-5 w-5" />}
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          label="Redo"
        />

        <ToolbarDivider />

        {/* Basic Formatting */}
        <ToolbarButton
          icon={<Bold className="h-5 w-5" />}
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive("bold")}
          label="Bold"
        />
        <ToolbarButton
          icon={<Italic className="h-5 w-5" />}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive("italic")}
          label="Italic"
        />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Expand/Collapse Button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsExpanded(!isExpanded)}
          className="h-11 w-11"
          aria-label={isExpanded ? "Collapse toolbar" : "Expand toolbar"}
        >
          {isExpanded ? (
            <ChevronUp className="h-5 w-5" />
          ) : (
            <ChevronDown className="h-5 w-5" />
          )}
        </Button>
      </div>

      {/* Expandable Row - Horizontal Scrolling */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: MOBILE_PANEL.TOOLBAR_COLLAPSED, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-border/50"
          >
            <ScrollArea orientation="horizontal" className="h-full">
              <div
                className="flex items-center gap-0.5 px-2 min-w-max"
                style={{ height: MOBILE_PANEL.TOOLBAR_COLLAPSED }}
              >
                {/* Extended Formatting */}
                <ToolbarButton
                  icon={<Strikethrough className="h-5 w-5" />}
                  onClick={() => editor.chain().focus().toggleStrike().run()}
                  isActive={editor.isActive("strike")}
                  label="Strikethrough"
                />
                <ToolbarButton
                  icon={<Code className="h-5 w-5" />}
                  onClick={() => editor.chain().focus().toggleCode().run()}
                  isActive={editor.isActive("code")}
                  label="Inline Code"
                />
                <ToolbarButton
                  icon={<Highlighter className="h-5 w-5" />}
                  onClick={() => editor.chain().focus().toggleHighlight().run()}
                  isActive={editor.isActive("highlight")}
                  label="Highlight"
                />

                <ToolbarDivider />

                {/* Headings */}
                <ToolbarButton
                  icon={<Heading1 className="h-5 w-5" />}
                  onClick={() =>
                    editor.chain().focus().toggleHeading({ level: 1 }).run()
                  }
                  isActive={editor.isActive("heading", { level: 1 })}
                  label="Heading 1"
                />
                <ToolbarButton
                  icon={<Heading2 className="h-5 w-5" />}
                  onClick={() =>
                    editor.chain().focus().toggleHeading({ level: 2 }).run()
                  }
                  isActive={editor.isActive("heading", { level: 2 })}
                  label="Heading 2"
                />
                <ToolbarButton
                  icon={<Heading3 className="h-5 w-5" />}
                  onClick={() =>
                    editor.chain().focus().toggleHeading({ level: 3 }).run()
                  }
                  isActive={editor.isActive("heading", { level: 3 })}
                  label="Heading 3"
                />

                <ToolbarDivider />

                {/* Lists */}
                <ToolbarButton
                  icon={<List className="h-5 w-5" />}
                  onClick={() => editor.chain().focus().toggleBulletList().run()}
                  isActive={editor.isActive("bulletList")}
                  label="Bullet List"
                />
                <ToolbarButton
                  icon={<ListOrdered className="h-5 w-5" />}
                  onClick={() => editor.chain().focus().toggleOrderedList().run()}
                  isActive={editor.isActive("orderedList")}
                  label="Numbered List"
                />
                <ToolbarButton
                  icon={<ListTodo className="h-5 w-5" />}
                  onClick={() => editor.chain().focus().toggleTaskList().run()}
                  isActive={editor.isActive("taskList")}
                  label="Task List"
                />

                <ToolbarDivider />

                {/* Blocks */}
                <ToolbarButton
                  icon={<Quote className="h-5 w-5" />}
                  onClick={() => editor.chain().focus().toggleBlockquote().run()}
                  isActive={editor.isActive("blockquote")}
                  label="Blockquote"
                />
                <ToolbarButton
                  icon={<Code2 className="h-5 w-5" />}
                  onClick={() => editor.chain().focus().toggleCodeBlock().run()}
                  isActive={editor.isActive("codeBlock")}
                  label="Code Block"
                />
                <ToolbarButton
                  icon={<Minus className="h-5 w-5" />}
                  onClick={() => editor.chain().focus().setHorizontalRule().run()}
                  label="Horizontal Rule"
                />

                <ToolbarDivider />

                {/* Insert */}
                <ToolbarButton
                  icon={<LinkIcon className="h-5 w-5" />}
                  onClick={() => onLinkClick?.()}
                  isActive={editor.isActive("link")}
                  label="Add Link"
                />
                <ToolbarButton
                  icon={<ImageIcon className="h-5 w-5" />}
                  onClick={() => onImageClick?.()}
                  label="Add Image"
                />
                <ToolbarButton
                  icon={<TableIcon className="h-5 w-5" />}
                  onClick={addTable}
                  label="Insert Table"
                />
                <ToolbarButton
                  icon={<Sigma className="h-5 w-5" />}
                  onClick={() => editor.chain().focus().insertBlockMath().run()}
                  label="Math Equation"
                />
              </div>
            </ScrollArea>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
