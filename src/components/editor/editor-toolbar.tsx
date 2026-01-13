"use client";

import { useState } from "react";
import { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
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
  Sparkles,
  ChevronDown,
  Search,
  FileSearch,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor-store";
import { LinkModal } from "./link-modal";
import { ImageModal } from "./image-modal";

interface EditorToolbarProps {
  editor: Editor;
  onSearchClick?: () => void;
  onReviewClick?: () => void;
  isReviewLoading?: boolean;
  isReviewActive?: boolean;
}

export function EditorToolbar({
  editor,
  onSearchClick,
  onReviewClick,
  isReviewLoading,
  isReviewActive,
}: EditorToolbarProps) {
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [imageModalOpen, setImageModalOpen] = useState(false);

  const {
    autocompleteEnabled,
    setAutocompleteEnabled,
    autocompleteTriggerMode,
    setAutocompleteTriggerMode,
  } = useEditorStore();

  const handleLinkConfirm = (url: string) => {
    editor.chain().focus().setLink({ href: url }).run();
  };

  const handleImageConfirm = (url: string, alt?: string) => {
    editor.chain().focus().setImage({ src: url, alt }).run();
  };

  const addTable = () => {
    editor
      .chain()
      .focus()
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
      .run();
  };

  return (
    <div className="border-b border-border px-4 py-2 flex items-center gap-1 flex-wrap bg-card">
      {/* History */}
      <ToolbarGroup>
        <ToolbarButton
          icon={<Undo className="h-4 w-4" />}
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          tooltip="Undo (Ctrl+Z)"
        />
        <ToolbarButton
          icon={<Redo className="h-4 w-4" />}
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          tooltip="Redo (Ctrl+Y)"
        />
      </ToolbarGroup>

      <ToolbarDivider />

      {/* Text Formatting */}
      <ToolbarGroup>
        <ToolbarButton
          icon={<Bold className="h-4 w-4" />}
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive("bold")}
          tooltip="Bold (Ctrl+B)"
        />
        <ToolbarButton
          icon={<Italic className="h-4 w-4" />}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive("italic")}
          tooltip="Italic (Ctrl+I)"
        />
        <ToolbarButton
          icon={<Strikethrough className="h-4 w-4" />}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          isActive={editor.isActive("strike")}
          tooltip="Strikethrough (Ctrl+Shift+S)"
        />
        <ToolbarButton
          icon={<Code className="h-4 w-4" />}
          onClick={() => editor.chain().focus().toggleCode().run()}
          isActive={editor.isActive("code")}
          tooltip="Inline Code (Ctrl+E)"
        />
        <ToolbarButton
          icon={<Highlighter className="h-4 w-4" />}
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          isActive={editor.isActive("highlight")}
          tooltip="Highlight (Ctrl+Shift+H)"
        />
      </ToolbarGroup>

      <ToolbarDivider />

      {/* Headings */}
      <ToolbarGroup>
        <ToolbarButton
          icon={<Heading1 className="h-4 w-4" />}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
          isActive={editor.isActive("heading", { level: 1 })}
          tooltip="Heading 1 (Ctrl+Alt+1)"
        />
        <ToolbarButton
          icon={<Heading2 className="h-4 w-4" />}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
          isActive={editor.isActive("heading", { level: 2 })}
          tooltip="Heading 2 (Ctrl+Alt+2)"
        />
        <ToolbarButton
          icon={<Heading3 className="h-4 w-4" />}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 3 }).run()
          }
          isActive={editor.isActive("heading", { level: 3 })}
          tooltip="Heading 3 (Ctrl+Alt+3)"
        />
      </ToolbarGroup>

      <ToolbarDivider />

      {/* Lists */}
      <ToolbarGroup>
        <ToolbarButton
          icon={<List className="h-4 w-4" />}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive("bulletList")}
          tooltip="Bullet List (Ctrl+Shift+8)"
        />
        <ToolbarButton
          icon={<ListOrdered className="h-4 w-4" />}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive("orderedList")}
          tooltip="Numbered List (Ctrl+Shift+7)"
        />
        <ToolbarButton
          icon={<ListTodo className="h-4 w-4" />}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          isActive={editor.isActive("taskList")}
          tooltip="Task List (Ctrl+Shift+9)"
        />
      </ToolbarGroup>

      <ToolbarDivider />

      {/* Blocks */}
      <ToolbarGroup>
        <ToolbarButton
          icon={<Quote className="h-4 w-4" />}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          isActive={editor.isActive("blockquote")}
          tooltip="Blockquote (Ctrl+Shift+B)"
        />
        <ToolbarButton
          icon={<Minus className="h-4 w-4" />}
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          tooltip="Horizontal Rule"
        />
      </ToolbarGroup>

      <ToolbarDivider />

      {/* Insert */}
      <ToolbarGroup>
        <ToolbarButton
          icon={<LinkIcon className="h-4 w-4" />}
          onClick={() => setLinkModalOpen(true)}
          isActive={editor.isActive("link")}
          tooltip="Add Link (Ctrl+K)"
        />
        <ToolbarButton
          icon={<ImageIcon className="h-4 w-4" />}
          onClick={() => setImageModalOpen(true)}
          tooltip="Add Image"
        />
        <ToolbarButton
          icon={<TableIcon className="h-4 w-4" />}
          onClick={addTable}
          tooltip="Insert Table"
        />
      </ToolbarGroup>

      <ToolbarDivider />

      {/* Search */}
      <ToolbarGroup>
        <ToolbarButton
          icon={<Search className="h-4 w-4" />}
          onClick={() => onSearchClick?.()}
          tooltip="Search (Ctrl+F)"
        />
      </ToolbarGroup>

      <ToolbarDivider />

      {/* AI Writing Review */}
      <ToolbarGroup>
        <Tooltip content="AI Writing Review" side="bottom">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onReviewClick?.()}
            disabled={isReviewLoading}
            className={cn(
              "h-8 gap-1.5 px-2",
              isReviewActive && "bg-primary/10 text-primary"
            )}
          >
            {isReviewLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileSearch className="h-4 w-4" />
            )}
            <span className="text-xs hidden sm:inline">Review</span>
          </Button>
        </Tooltip>
      </ToolbarGroup>

      {/* Modals */}
      <LinkModal
        open={linkModalOpen}
        onClose={() => setLinkModalOpen(false)}
        onConfirm={handleLinkConfirm}
      />
      <ImageModal
        open={imageModalOpen}
        onClose={() => setImageModalOpen(false)}
        onConfirm={handleImageConfirm}
      />

      {/* Spacer to push AI autocomplete to the right */}
      <div className="flex-1" />

      {/* AI Autocomplete Toggle */}
      <ToolbarGroup>
        <DropdownMenu>
          <Tooltip content={autocompleteEnabled ? `AI Autocomplete: ${autocompleteTriggerMode === "auto" ? "Auto" : "Manual (Alt+/)"}` : "AI Autocomplete: Off"} side="bottom">
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-8 gap-1 px-2",
                  autocompleteEnabled && "text-primary"
                )}
              >
                <Sparkles className="h-4 w-4" />
                <span className="text-xs hidden sm:inline">
                  {autocompleteEnabled
                    ? autocompleteTriggerMode === "auto"
                      ? "Auto"
                      : "Manual"
                    : "Off"}
                </span>
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => {
                setAutocompleteEnabled(true);
                setAutocompleteTriggerMode("auto");
              }}
              className={cn(
                autocompleteEnabled && autocompleteTriggerMode === "auto" && "bg-accent"
              )}
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Auto
              <span className="ml-auto text-xs text-muted-foreground">
                Auto-trigger
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setAutocompleteEnabled(true);
                setAutocompleteTriggerMode("manual");
              }}
              className={cn(
                autocompleteEnabled && autocompleteTriggerMode === "manual" && "bg-accent"
              )}
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Manual
              <span className="ml-auto text-xs text-muted-foreground">
                Alt+/
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setAutocompleteEnabled(false)}
              className={cn(!autocompleteEnabled && "bg-accent")}
            >
              <Sparkles className="h-4 w-4 mr-2 opacity-50" />
              Off
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ToolbarGroup>
    </div>
  );
}

function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

function ToolbarDivider() {
  return <div className="w-px h-6 bg-border mx-2" />;
}

interface ToolbarButtonProps {
  icon: React.ReactNode;
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  tooltip: string;
}

function ToolbarButton({
  icon,
  onClick,
  isActive,
  disabled,
  tooltip,
}: ToolbarButtonProps) {
  return (
    <Tooltip content={tooltip} side="bottom">
      <Button
        variant="ghost"
        size="icon"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "h-8 w-8",
          isActive && "bg-accent text-accent-foreground"
        )}
      >
        {icon}
      </Button>
    </Tooltip>
  );
}
