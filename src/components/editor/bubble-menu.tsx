"use client";

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
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor-store";

interface BubbleMenuComponentProps {
  editor: Editor;
}

export function BubbleMenuComponent({ editor }: BubbleMenuComponentProps) {
  const { openQuickEdit } = useEditorStore();

  const handleAIEdit = (event: React.MouseEvent) => {
    // Use the clicked button's position to place the dropdown
    const button = event.currentTarget as HTMLElement;
    const rect = button.getBoundingClientRect();

    openQuickEdit({ x: rect.left, y: rect.bottom + 5 });
  };

  const addLink = () => {
    const url = window.prompt("Enter URL:");
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    }
  };

  return (
    <BubbleMenu
      editor={editor}
      tippyOptions={{ duration: 100 }}
      className="bubble-menu flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-lg"
    >
      <BubbleButton
        icon={<Bold className="h-4 w-4" />}
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive("bold")}
      />
      <BubbleButton
        icon={<Italic className="h-4 w-4" />}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive("italic")}
      />
      <BubbleButton
        icon={<Strikethrough className="h-4 w-4" />}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        isActive={editor.isActive("strike")}
      />
      <BubbleButton
        icon={<Code className="h-4 w-4" />}
        onClick={() => editor.chain().focus().toggleCode().run()}
        isActive={editor.isActive("code")}
      />
      <BubbleButton
        icon={<Highlighter className="h-4 w-4" />}
        onClick={() => editor.chain().focus().toggleHighlight().run()}
        isActive={editor.isActive("highlight")}
      />
      <BubbleButton
        icon={<LinkIcon className="h-4 w-4" />}
        onClick={addLink}
        isActive={editor.isActive("link")}
      />

      <div className="w-px h-5 bg-border mx-1" />

      <BubbleButton
        icon={<Sparkles className="h-4 w-4" />}
        onClick={handleAIEdit}
        className="text-primary"
        tooltip="AI Edit"
      />
    </BubbleMenu>
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
}: BubbleButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      className={cn(
        "h-7 w-7",
        isActive && "bg-accent text-accent-foreground",
        className
      )}
    >
      {icon}
    </Button>
  );
}
