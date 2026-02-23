"use client";

/**
 * Mobile Formatting Toolbar
 *
 * Notion-style toolbar that appears above the virtual keyboard when editing.
 * Provides quick access to text formatting, block insertion, and undo/redo.
 */

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Link as LinkIcon,
  Undo2,
  Redo2,
  Indent,
  Outdent,
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Code,
  MessageSquareQuote,
  ChevronRight,
  ChevronDown,
  Sparkles,
  KeyboardOff,
} from "lucide-react";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useKeyboardState } from "@/hooks/use-mobile-gestures";
import { haptics } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { MOBILE_SPRINGS, Z_INDEX } from "@/lib/constants";
import { ColorPicker } from "@/components/editor/color-picker";
import { LinkModal } from "@/components/editor/link-modal";
import { turnIntoOptions, isTurnIntoSeparator, type TurnIntoOption } from "@/lib/block-actions";

/** Icon map for turn-into options */
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
  ChevronRight: <ChevronRight className="h-4 w-4" />,
};

/** Get current block type label for the Aa button */
function getCurrentBlockLabel(editor: {
  isActive: (name: string, attrs?: Record<string, unknown>) => boolean;
}): string {
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

/** Individual toolbar button */
function ToolbarButton({
  icon,
  isActive,
  isDisabled,
  onPress,
  label,
  className,
  children,
}: {
  icon?: React.ReactNode;
  isActive?: boolean;
  isDisabled?: boolean;
  onPress: () => void;
  label: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => {
        if (isDisabled) return;
        haptics.light();
        onPress();
      }}
      aria-label={label}
      disabled={isDisabled}
      className={cn(
        "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg",
        "transition-colors active:scale-95",
        isActive && "bg-accent text-primary",
        isDisabled && "opacity-30",
        !isActive && !isDisabled && "text-foreground active:bg-accent",
        className
      )}
    >
      {children || icon}
    </button>
  );
}

/** Vertical divider between button groups */
function Divider() {
  return <div className="mx-0.5 h-5 w-px shrink-0 bg-border/60" />;
}

export function MobileFormattingToolbar() {
  const { editor } = useEditorRefStore();
  const { setMobileBlockInsertOpen } = useLayoutStore();
  const { isVisible: isKeyboardVisible, keyboardHeight } = useKeyboardState();

  // Force re-render on editor changes to update active states
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const handler = () => forceUpdate((c) => c + 1);
    editor.on("transaction", handler);
    return () => {
      editor.off("transaction", handler);
    };
  }, [editor]);

  // Local UI state
  const [showTurnInto, setShowTurnInto] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);

  // Close popovers when keyboard hides
  useEffect(() => {
    if (!isKeyboardVisible) {
      setShowTurnInto(false);
      setShowColorPicker(false);
    }
  }, [isKeyboardVisible]);

  // Check if we're in a list context for indent/outdent
  // Note: no useMemo — component re-renders on every transaction via forceUpdate
  const isInList = editor
    ? editor.isActive("bulletList") || editor.isActive("orderedList") || editor.isActive("taskList")
    : false;

  // Get color state
  const colorState = editor
    ? {
        textColor: editor.getAttributes("textStyle").color || null,
        backgroundColor: editor.getAttributes("highlight").color || null,
      }
    : { textColor: null, backgroundColor: null };

  const handleColorChange = useCallback(
    (colorValue: string, type: "text" | "background") => {
      if (!editor) return;
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
      setShowColorPicker(false);
    },
    [editor]
  );

  const handleLinkConfirm = useCallback(
    (url: string) => {
      if (!editor) return;
      editor.chain().focus().setLink({ href: url }).run();
    },
    [editor]
  );

  const handleBlockInsert = useCallback(() => {
    setMobileBlockInsertOpen(true);
  }, [setMobileBlockInsertOpen]);

  // Dismiss keyboard (Notion-style)
  const handleDismissKeyboard = useCallback(() => {
    if (!editor) return;
    editor.commands.blur();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }, [editor]);

  // AI Edit: bridge selected text to bottom bar quick actions
  const handleAIEdit = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, " ");
    if (selectedText) {
      useLayoutStore.getState().setPendingSelectionForAI(selectedText);
      // Dismiss keyboard to reveal bottom bar with quick actions
      editor.commands.blur();
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    }
  }, [editor]);

  // Check if there's a text selection (for showing AI Edit button)
  const hasTextSelection = editor
    ? editor.state.selection.to - editor.state.selection.from > 0
    : false;

  if (!editor) return null;

  const shouldShow = isKeyboardVisible;

  return (
    <>
      {/* Link modal */}
      <LinkModal
        open={showLinkModal}
        onClose={() => setShowLinkModal(false)}
        onConfirm={handleLinkConfirm}
      />

      <AnimatePresence>
        {shouldShow && (
          <motion.div
            initial={{ y: 44, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 44, opacity: 0 }}
            transition={{ type: "spring", ...MOBILE_SPRINGS.SNAPPY }}
            className="fixed left-0 right-0 md:hidden"
            style={{
              bottom: keyboardHeight,
              zIndex: Z_INDEX.BUBBLE_MENU,
            }}
          >
            <div
              className={cn(
                "bg-background/95 backdrop-blur-xl",
                "border-t border-border/50",
                "shadow-[0_-2px_10px_rgba(0,0,0,0.08)]"
              )}
            >
              {/* Turn Into popover */}
              <AnimatePresence>
                {showTurnInto && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ type: "spring", ...MOBILE_SPRINGS.SNAPPY }}
                    className="overflow-hidden border-b border-border/30"
                  >
                    <div className="max-h-[240px] overflow-y-auto p-1.5">
                      {turnIntoOptions.map((entry, index) => {
                        if (isTurnIntoSeparator(entry)) {
                          return (
                            <div key={`sep-${index}`} className="mx-1 my-1 h-px bg-border/40" />
                          );
                        }
                        const option = entry as TurnIntoOption;
                        const active = option.isActive(editor);
                        return (
                          <button
                            key={option.label}
                            type="button"
                            onPointerDown={(e) => e.preventDefault()}
                            onClick={() => {
                              haptics.light();
                              option.action(editor);
                              setShowTurnInto(false);
                            }}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left",
                              "transition-colors active:bg-accent",
                              active && "bg-accent text-primary"
                            )}
                          >
                            <span className="flex h-5 w-5 items-center justify-center">
                              {turnIntoIconMap[option.iconName] || <Type className="h-4 w-4" />}
                            </span>
                            <span className="text-sm font-medium">{option.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Color picker popover */}
              <AnimatePresence>
                {showColorPicker && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ type: "spring", ...MOBILE_SPRINGS.SNAPPY }}
                    className="overflow-hidden border-b border-border/30"
                  >
                    <div onPointerDown={(e) => e.preventDefault()}>
                      <ColorPicker
                        activeTextColor={colorState.textColor}
                        activeBackgroundColor={colorState.backgroundColor}
                        onTextColorChange={(color) => handleColorChange(color, "text")}
                        onBackgroundColorChange={(color) => handleColorChange(color, "background")}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Main toolbar buttons */}
              <div className="flex items-center">
                {/* Scrollable formatting buttons with right fade to hint more items */}
                <div
                  className="hide-scrollbar flex flex-1 items-center gap-0.5 overflow-x-auto px-1.5 py-1.5"
                  style={{
                    maskImage: "linear-gradient(to right, black calc(100% - 24px), transparent)",
                    WebkitMaskImage:
                      "linear-gradient(to right, black calc(100% - 24px), transparent)",
                  }}
                >
                  {/* Block insert */}
                  <ToolbarButton
                    icon={<Plus className="h-5 w-5" />}
                    onPress={handleBlockInsert}
                    label="Insert block"
                  />

                  <Divider />

                  {/* Turn into */}
                  <ToolbarButton
                    onPress={() => {
                      setShowColorPicker(false);
                      setShowTurnInto(!showTurnInto);
                    }}
                    isActive={showTurnInto}
                    label="Turn into"
                    className="w-auto min-w-[40px] gap-0.5 px-1.5"
                  >
                    <span className="text-xs font-semibold">{getCurrentBlockLabel(editor)}</span>
                    <ChevronDown className="h-3 w-3 opacity-60" />
                  </ToolbarButton>

                  {/* Text formatting */}
                  <ToolbarButton
                    icon={<Bold className="h-4.5 w-4.5" />}
                    isActive={editor.isActive("bold")}
                    onPress={() => editor.chain().focus().toggleBold().run()}
                    label="Bold"
                  />
                  <ToolbarButton
                    icon={<Italic className="h-4.5 w-4.5" />}
                    isActive={editor.isActive("italic")}
                    onPress={() => editor.chain().focus().toggleItalic().run()}
                    label="Italic"
                  />
                  <ToolbarButton
                    icon={<Underline className="h-4.5 w-4.5" />}
                    isActive={editor.isActive("underline")}
                    onPress={() => editor.chain().focus().toggleUnderline().run()}
                    label="Underline"
                  />
                  <ToolbarButton
                    icon={<Strikethrough className="h-4.5 w-4.5" />}
                    isActive={editor.isActive("strike")}
                    onPress={() => editor.chain().focus().toggleStrike().run()}
                    label="Strikethrough"
                  />

                  <Divider />

                  {/* Link */}
                  <ToolbarButton
                    icon={<LinkIcon className="h-4.5 w-4.5" />}
                    isActive={editor.isActive("link")}
                    onPress={() => setShowLinkModal(true)}
                    label="Link"
                  />

                  {/* Color */}
                  <ToolbarButton
                    onPress={() => {
                      setShowTurnInto(false);
                      setShowColorPicker(!showColorPicker);
                    }}
                    isActive={showColorPicker}
                    label="Color"
                  >
                    <div className="flex flex-col items-center">
                      <span
                        className="text-sm font-bold leading-none"
                        style={colorState.textColor ? { color: colorState.textColor } : undefined}
                      >
                        A
                      </span>
                      <span
                        className="mt-0.5 h-[3px] w-3.5 rounded-full"
                        style={{
                          backgroundColor:
                            colorState.textColor || colorState.backgroundColor || "currentColor",
                          opacity: colorState.textColor || colorState.backgroundColor ? 1 : 0.4,
                        }}
                      />
                    </div>
                  </ToolbarButton>

                  <Divider />

                  {/* Indent / Outdent */}
                  <ToolbarButton
                    icon={<Outdent className="h-4.5 w-4.5" />}
                    isDisabled={!isInList}
                    onPress={() => editor.chain().focus().liftListItem("listItem").run()}
                    label="Outdent"
                  />
                  <ToolbarButton
                    icon={<Indent className="h-4.5 w-4.5" />}
                    isDisabled={!isInList}
                    onPress={() => editor.chain().focus().sinkListItem("listItem").run()}
                    label="Indent"
                  />

                  <Divider />

                  {/* Undo / Redo */}
                  <ToolbarButton
                    icon={<Undo2 className="h-4.5 w-4.5" />}
                    isDisabled={!editor.can().undo()}
                    onPress={() => editor.chain().focus().undo().run()}
                    label="Undo"
                  />
                  <ToolbarButton
                    icon={<Redo2 className="h-4.5 w-4.5" />}
                    isDisabled={!editor.can().redo()}
                    onPress={() => editor.chain().focus().redo().run()}
                    label="Redo"
                  />

                  {/* AI Edit - shown when text is selected */}
                  {hasTextSelection && (
                    <>
                      <Divider />
                      <ToolbarButton
                        icon={<Sparkles className="h-4.5 w-4.5" />}
                        onPress={handleAIEdit}
                        label="AI Edit"
                        className="text-primary"
                      />
                    </>
                  )}
                </div>

                {/* Fixed keyboard dismiss button - pinned right */}
                <div className="flex-shrink-0 border-l border-border/30 py-1.5 pl-0.5 pr-1.5">
                  <ToolbarButton
                    icon={<KeyboardOff className="h-4.5 w-4.5" />}
                    onPress={handleDismissKeyboard}
                    label="Dismiss keyboard"
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
