"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Link as LinkIcon,
  Type,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  MessageSquareQuote,
  ChevronRight as ChevronRightIcon,
  ChevronDown,
  Wand2,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from "lucide-react";
import { AiLogoIcon } from "@/components/ui/ai-logo-icon";
import { Tooltip } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn, formatShortcut } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor-store";
import { isDiffReviewActive } from "@/extensions/diff-review";
import { useStreamingStore } from "@/stores/streaming-store";
import { NodeSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { LinkModal } from "./link-modal";
import { ColorPicker } from "./color-picker";
import { turnIntoOptions, isTurnIntoSeparator } from "@/lib/block-actions";
import { useChatContextStore } from "@/stores/chat-context-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useTranslations } from "next-intl";

/** Map icon names to components for the Turn Into dropdown */
const turnIntoIconMap: Record<string, React.ReactNode> = {
  Type: <Type className="h-4 w-4" />,
  Heading1: <Heading1 className="h-4 w-4" />,
  Heading2: <Heading2 className="h-4 w-4" />,
  Heading3: <Heading3 className="h-4 w-4" />,
  Heading4: <Heading4 className="h-4 w-4" />,
  Heading5: <Heading5 className="h-4 w-4" />,
  Heading6: <Heading6 className="h-4 w-4" />,
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
  isMobile?: boolean;
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
  if (editor.isActive("heading", { level: 4 })) return "H4";
  if (editor.isActive("heading", { level: 5 })) return "H5";
  if (editor.isActive("heading", { level: 6 })) return "H6";
  if (editor.isActive("bulletList")) return "List";
  if (editor.isActive("orderedList")) return "Num";
  if (editor.isActive("taskList")) return "Task";
  if (editor.isActive("blockquote")) return "Quote";
  if (editor.isActive("codeBlock")) return "Code";
  return "Aa";
}

/** Get the bounding rect of the current text selection */
function getSelectionRect(): DOMRect | null {
  const domSelection = window.getSelection();
  if (!domSelection || domSelection.rangeCount === 0) return null;
  const range = domSelection.getRangeAt(0);
  if (range.collapsed) return null;
  return range.getBoundingClientRect();
}

export function BubbleMenuComponent({ editor, isMobile }: BubbleMenuComponentProps) {
  const t = useTranslations("editor");
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const { openQuickEdit, selection } = useEditorStore();
  const { addChatContext } = useChatContextStore();
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const preventHideRef = useRef(false);
  const updateTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const checkShouldShow = useCallback(() => {
    if (isDiffReviewActive(editor)) return false;
    if (useStreamingStore.getState().isStreaming) return false;
    if (editor.state.selection instanceof CellSelection) return false;
    if (editor.state.selection instanceof NodeSelection) return false;
    const { from, to } = editor.state.selection;
    return to - from > 0;
  }, [editor]);

  const updateMenu = useCallback(() => {
    const shouldShow = checkShouldShow();
    const rect = getSelectionRect();
    if (!shouldShow) {
      setVisible(false);
      return;
    }
    if (!rect || rect.width === 0) {
      setVisible(false);
      return;
    }
    // Position above the selection, centered
    const x = rect.left + rect.width / 2;
    const y = rect.top - 8;
    setPosition({ x, y });
    setVisible(true);
  }, [checkShouldShow]);

  // Listen to editor selection changes, focus/blur, and mouseup
  useEffect(() => {
    const handleSelectionUpdate = () => {
      // Debounce to avoid rapid updates during drag selection
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
      updateTimerRef.current = setTimeout(updateMenu, 100);
    };

    const handleBlur = ({ event }: { event: FocusEvent }) => {
      if (preventHideRef.current) {
        preventHideRef.current = false;
        return;
      }
      // Don't hide if focus moved to the menu itself
      if (event?.relatedTarget && menuRef.current?.contains(event.relatedTarget as Node)) {
        return;
      }
      setVisible(false);
    };

    // Also listen for mouseup to catch selections that may not trigger selectionUpdate
    const handleMouseUp = () => {
      // Share the same debounce timer to avoid double-firing with selectionUpdate
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
      updateTimerRef.current = setTimeout(updateMenu, 100);
    };

    editor.on("selectionUpdate", handleSelectionUpdate);
    editor.on("blur", handleBlur);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate);
      editor.off("blur", handleBlur);
      document.removeEventListener("mouseup", handleMouseUp);
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
    };
  }, [editor, updateMenu]);

  const handleImproveWritingClick = (event: React.MouseEvent) => {
    const button = event.currentTarget as HTMLElement;
    const rect = button.getBoundingClientRect();
    openQuickEdit({ x: rect.left, y: rect.bottom + 5 });
  };

  const handleAskAI = () => {
    if (!selection) return;
    addChatContext({
      type: "selection",
      text: selection.text,
      from: selection.from,
      to: selection.to,
    });
    useLayoutStore.getState().setChatOpen(true);
    // Collapse selection to dismiss bubble menu — text already captured as context
    editor.commands.setTextSelection(selection.to);
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

  const menuContent = (
    <>
      <LinkModal
        open={linkModalOpen}
        onClose={() => setLinkModalOpen(false)}
        onConfirm={handleLinkConfirm}
      />
      {visible && (
        <div
          ref={menuRef}
          className="bubble-menu fixed z-50 rounded-lg border border-border/60 bg-popover p-1 shadow-lg"
          style={{
            left: position.x,
            top: position.y,
            transform: "translate(-50%, -100%)",
          }}
          onMouseDown={() => {
            preventHideRef.current = true;
          }}
        >
          <div className="flex flex-nowrap items-center gap-0.5">
            {/* Left side: AI actions with text labels (Notion-style) */}

            {/* Improve Writing - opens quick edit menu */}
            <button
              type="button"
              onClick={handleImproveWritingClick}
              className="inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded px-2 text-sm hover:bg-accent md:h-8"
            >
              <Wand2 className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              <span className="hidden text-sm font-medium md:inline">
                {t("bubbleMenu.inlineImprove")}
              </span>
            </button>

            {/* Ask AI button */}
            <button
              type="button"
              onClick={handleAskAI}
              className="inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded px-2 text-sm hover:bg-accent md:h-8"
            >
              <AiLogoIcon className="h-4 w-4" />
              <span className="hidden text-sm font-medium md:inline">
                {t("bubbleMenu.askAIInChat")}
              </span>
            </button>

            {/* Divider */}
            <div className="mx-1 h-5 w-px bg-border" />

            {/* Right side: Formatting tools */}
            {!isMobile && (
              <>
                <DropdownMenu>
                  <Tooltip content={t("bubbleMenu.turnInto")} side="top">
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-8 items-center gap-0.5 rounded-md px-1.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                      >
                        <span className="text-xs">{getCurrentBlockLabel(editor)}</span>
                        <ChevronDown className="h-3 w-3 opacity-60" />
                      </button>
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
              </>
            )}

            <BubbleButton
              icon={<Bold className="h-4 w-4" />}
              onClick={() => editor.chain().focus().toggleBold().run()}
              isActive={editor.isActive("bold")}
              tooltip={t("bubbleMenu.boldTooltip", { shortcut: formatShortcut("Ctrl+B") })}
            />
            <BubbleButton
              icon={<Italic className="h-4 w-4" />}
              onClick={() => editor.chain().focus().toggleItalic().run()}
              isActive={editor.isActive("italic")}
              tooltip={t("bubbleMenu.italicTooltip", { shortcut: formatShortcut("Ctrl+I") })}
            />
            <BubbleButton
              icon={<Underline className="h-4 w-4" />}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              isActive={editor.isActive("underline")}
              tooltip={t("bubbleMenu.underlineTooltip", { shortcut: formatShortcut("Ctrl+U") })}
            />

            {/* Strikethrough, Code, Color - desktop only */}
            {!isMobile && (
              <>
                <BubbleButton
                  icon={<Strikethrough className="h-4 w-4" />}
                  onClick={() => editor.chain().focus().toggleStrike().run()}
                  isActive={editor.isActive("strike")}
                  tooltip={t("bubbleMenu.strikethroughTooltip")}
                />
                <BubbleButton
                  icon={<Code className="h-4 w-4" />}
                  onClick={() => editor.chain().focus().toggleCode().run()}
                  isActive={editor.isActive("code")}
                  tooltip={t("bubbleMenu.codeTooltip", { shortcut: formatShortcut("Ctrl+E") })}
                />
                {/* Color dropdown (replaces standalone Highlight button) */}
                <ColorDropdown editor={editor} onColorChange={handleColorChange} />

                {/* Text alignment */}
                <div className="mx-0.5 h-5 w-px bg-border" />
                <BubbleButton
                  icon={<AlignLeft className="h-4 w-4" />}
                  onClick={() => editor.chain().focus().setTextAlign("left").run()}
                  isActive={editor.isActive({ textAlign: "left" })}
                  tooltip={t("bubbleMenu.alignLeft")}
                />
                <BubbleButton
                  icon={<AlignCenter className="h-4 w-4" />}
                  onClick={() => editor.chain().focus().setTextAlign("center").run()}
                  isActive={editor.isActive({ textAlign: "center" })}
                  tooltip={t("bubbleMenu.alignCenter")}
                />
                <BubbleButton
                  icon={<AlignRight className="h-4 w-4" />}
                  onClick={() => editor.chain().focus().setTextAlign("right").run()}
                  isActive={editor.isActive({ textAlign: "right" })}
                  tooltip={t("bubbleMenu.alignRight")}
                />
              </>
            )}

            <BubbleButton
              icon={<LinkIcon className="h-4 w-4" />}
              onClick={() => setLinkModalOpen(true)}
              isActive={editor.isActive("link")}
              tooltip={t("bubbleMenu.linkTooltip", { shortcut: formatShortcut("Ctrl+K") })}
            />
          </div>
        </div>
      )}
    </>
  );

  return createPortal(menuContent, document.body);
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
  const t = useTranslations("editor");
  const { textColor, backgroundColor } = getSelectionColors(editor);
  const hasColor = !!textColor || !!backgroundColor;

  return (
    <DropdownMenu>
      <Tooltip content={t("bubbleMenu.color")} side="top">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
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
          </button>
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
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-11 w-11 md:h-8 md:w-8",
        "inline-flex items-center justify-center rounded-md",
        "hover:bg-accent hover:text-accent-foreground",
        isActive && "bg-accent text-accent-foreground",
        className
      )}
    >
      <span className="[&>svg]:h-5 [&>svg]:w-5 md:[&>svg]:h-4 md:[&>svg]:w-4">{icon}</span>
    </button>
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
