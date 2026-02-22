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
  Sparkles,
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  MessageSquareQuote,
  ChevronRight as ChevronRightIcon,
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
import { CellSelection } from "@tiptap/pm/tables";
import { LinkModal } from "./link-modal";
import { ColorPicker } from "./color-picker";
import { turnIntoOptions, isTurnIntoSeparator } from "@/lib/block-actions";

/** Map icon names to components for the Turn Into dropdown */
const turnIntoIconMap: Record<string, React.ReactNode> = {
  Type: <Type className="h-4 w-4" />,
  Heading1: <Heading1 className="h-4 w-4" />,
  Heading2: <Heading2 className="h-4 w-4" />,
  Heading3: <Heading3 className="h-4 w-4" />,
  List: <List className="h-4 w-4" />,
  ListOrdered: <ListOrdered className="h-4 w-4" />,
  ListTodo: <ListTodo className="h-4 w-4" />,
  Quote: <Quote className="h-4 w-4" />,
  Code: <Code className="h-4 w-4" />,
  MessageSquareQuote: <MessageSquareQuote className="h-4 w-4" />,
  ChevronRight: <ChevronRightIcon className="h-4 w-4" />,
};

interface BubbleMenuComponentProps {
  editor: Editor;
  disabled?: boolean;
}

/** Get the current selection's inline text and background color marks */
function getSelectionColors(editor: Editor): {
  textColor: string | null;
  backgroundColor: string | null;
} {
  const textColor = editor.getAttributes("textStyle").color || null;
  const highlightAttrs = editor.getAttributes("highlight");
  const backgroundColor = highlightAttrs.color || null;
  return { textColor, backgroundColor };
}

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

  const handleColorChange = useCallback(
    (colorValue: string, type: "text" | "background") => {
      if (type === "text") {
        if (colorValue) {
          editor.chain().focus().setColor(colorValue).run();
        } else {
          editor.chain().focus().unsetColor().run();
        }
      } else {
        if (colorValue) {
          editor.chain().focus().setHighlight({ color: colorValue }).run();
        } else {
          editor.chain().focus().unsetHighlight().run();
        }
      }
    },
    [editor]
  );

  const shouldShow = useCallback(() => {
    if (isDiffReviewActive(editor)) return false;
    // Don't show text formatting menu for table cell selections
    if (editor.state.selection instanceof CellSelection) return false;
    const { from, to } = editor.state.selection;
    const hasSelection = to - from > 0;
    const isImage = editor.isActive("image");
    const isInlineMath = editor.isActive("inlineMath");
    const isBlockMath = editor.isActive("blockMath");
    const isMermaidChart = editor.isActive("mermaidChart");
    return hasSelection && !isImage && !isInlineMath && !isBlockMath && !isMermaidChart;
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
        className="bubble-menu rounded-lg border border-border/60 bg-popover p-1 shadow-lg"
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
                if (isTurnIntoSeparator(option)) {
                  return <DropdownMenuSeparator key={`sep-${index}`} />;
                }
                return (
                  <DropdownMenuItem
                    key={option.label}
                    onClick={() => option.action(editor)}
                    className={cn(option.isActive(editor) && "bg-accent")}
                  >
                    {turnIntoIconMap[option.iconName] || <Type className="h-4 w-4" />}
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
          {/* Color dropdown (replaces standalone Highlight button) */}
          <ColorDropdown editor={editor} onColorChange={handleColorChange} />
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

/** Color dropdown button for the bubble menu — shows "A" with colored underline */
function ColorDropdown({
  editor,
  onColorChange,
}: {
  editor: Editor;
  onColorChange: (color: string, type: "text" | "background") => void;
}) {
  const { textColor, backgroundColor } = getSelectionColors(editor);
  const hasColor = !!textColor || !!backgroundColor;

  return (
    <DropdownMenu>
      <Tooltip content="Color" side="top">
        <DropdownMenuTrigger asChild>
          <motion.button
            type="button"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
            className={cn(
              "h-11 w-11 md:h-8 md:w-8",
              "inline-flex flex-col items-center justify-center rounded-md",
              "hover:bg-accent hover:text-accent-foreground",
              hasColor && "text-accent-foreground"
            )}
          >
            <span
              className="text-sm font-bold leading-none md:text-xs"
              style={textColor ? { color: textColor } : undefined}
            >
              A
            </span>
            <span
              className="mt-0.5 h-[3px] w-3.5 rounded-full md:h-[2px] md:w-3"
              style={{
                backgroundColor: textColor || backgroundColor || "currentColor",
                opacity: hasColor ? 1 : 0.4,
              }}
            />
          </motion.button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="start" className="p-0">
        <ColorPicker
          activeTextColor={textColor}
          activeBackgroundColor={backgroundColor}
          onTextColorChange={(color) => onColorChange(color, "text")}
          onBackgroundColorChange={(color) => onColorChange(color, "background")}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
