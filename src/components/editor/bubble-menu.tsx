"use client";

import { useState, useCallback } from "react";
import { BubbleMenu, Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Link as LinkIcon,
  Highlighter,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor-store";
import { LinkModal } from "./link-modal";

interface BubbleMenuComponentProps {
  editor: Editor;
}

export function BubbleMenuComponent({ editor }: BubbleMenuComponentProps) {
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const { openQuickEdit } = useEditorStore();

  const handleAIEdit = (event: React.MouseEvent) => {
    // Use the clicked button's position to place the dropdown
    const button = event.currentTarget as HTMLElement;
    const rect = button.getBoundingClientRect();

    openQuickEdit({ x: rect.left, y: rect.bottom + 5 });
  };

  const handleLinkConfirm = (url: string) => {
    editor.chain().focus().setLink({ href: url }).run();
  };

  // Only show when text is selected (not just cursor on a link)
  // Don't show when in table, image, or math nodes - they have their own handling
  const shouldShow = useCallback(() => {
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
      tippyOptions={{ duration: 100 }}
      shouldShow={shouldShow}
      className="bubble-menu flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-lg"
    >
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

      <div className="w-px h-5 bg-border mx-1" />

      <BubbleButton
        icon={<Sparkles className="h-4 w-4" />}
        onClick={handleAIEdit}
        className="text-primary"
        tooltip="AI Edit"
      />
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

function BubbleButton({
  icon,
  onClick,
  isActive,
  className,
  tooltip,
}: BubbleButtonProps) {
  const button = (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      className={cn(
        // Mobile: larger touch targets (44px), Desktop: compact (32px)
        "h-11 w-11 md:h-8 md:w-8",
        "active:scale-95 transition-transform",
        isActive && "bg-accent text-accent-foreground",
        className
      )}
    >
      {/* Mobile: larger icons, Desktop: smaller */}
      <span className="[&>svg]:h-5 [&>svg]:w-5 md:[&>svg]:h-4 md:[&>svg]:w-4">
        {icon}
      </span>
    </Button>
  );

  if (tooltip) {
    return <Tooltip content={tooltip} side="top">{button}</Tooltip>;
  }

  return button;
}
