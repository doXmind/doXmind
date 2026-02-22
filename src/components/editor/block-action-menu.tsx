"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import {
  Trash2,
  Copy,
  ArrowUp,
  ArrowDown,
  Clipboard,
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
  Palette,
  ArrowRightLeft,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { turnIntoOptions, isTurnIntoSeparator } from "@/lib/block-actions";
import { useLayoutStore } from "@/stores/layout-store";
import { useChatContextStore } from "@/stores/chat-context-store";
import { ColorPicker } from "./color-picker";
import {
  moveBlockUp,
  moveBlockDown,
  duplicateBlock,
  deleteBlock,
  copyBlockToClipboard,
  getBlockAtPos,
} from "@/lib/block-operations";

interface BlockActionMenuProps {
  editor: Editor;
  blockPos: number;
  position: { x: number; y: number };
  onClose: () => void;
}

/** Map icon names to components */
const iconMap: Record<string, React.ReactNode> = {
  Type: <Type className="h-3.5 w-3.5" />,
  Heading1: <Heading1 className="h-3.5 w-3.5" />,
  Heading2: <Heading2 className="h-3.5 w-3.5" />,
  Heading3: <Heading3 className="h-3.5 w-3.5" />,
  List: <List className="h-3.5 w-3.5" />,
  ListOrdered: <ListOrdered className="h-3.5 w-3.5" />,
  ListTodo: <ListTodo className="h-3.5 w-3.5" />,
  Quote: <Quote className="h-3.5 w-3.5" />,
  Code: <Code className="h-3.5 w-3.5" />,
  MessageSquareQuote: <MessageSquareQuote className="h-3.5 w-3.5" />,
  ChevronRight: <ChevronRight className="h-3.5 w-3.5" />,
};

type SubmenuType = "turnInto" | "color" | null;

/** Block types that support "Turn Into" conversion */
const TURN_INTO_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "taskList",
  "listItem",
  "taskItem",
  "callout",
  "toggle",
]);

/** Block types that support text/background color */
const COLOR_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "taskList",
  "listItem",
  "taskItem",
  "callout",
  "toggle",
]);

export function BlockActionMenu({ editor, blockPos, position, onClose }: BlockActionMenuProps) {
  const [focusIndex, setFocusIndex] = useState(0);
  const [activeSubmenu, setActiveSubmenu] = useState<SubmenuType>(null);
  const [submenuFocusIndex, setSubmenuFocusIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const block = getBlockAtPos(editor, blockPos);
  const blockType = block?.node.type.name ?? "";
  const showTurnInto = TURN_INTO_TYPES.has(blockType);
  const showColor = COLOR_TYPES.has(blockType);

  // Move editor selection into the target block on mount so that
  // editor.isActive() checks (used by Turn Into options) reference
  // the correct block type instead of wherever the cursor happened to be.
  useEffect(() => {
    if (block) {
      try {
        const $pos = editor.state.doc.resolve(block.from + 1);
        const sel = TextSelection.near($pos);
        editor.view.dispatch(editor.state.tr.setSelection(sel));
      } catch {
        // Position may be invalid for some block types; ignore silently
      }
    }
    // Only run on mount when the menu opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleScroll = (e: Event) => {
      // Ignore scroll events from within the menu itself (e.g. scrolling
      // the "Turn Into" submenu list)
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      onClose();
    };

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (activeSubmenu) {
          setActiveSubmenu(null);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, activeSubmenu]);

  const handleDelete = useCallback(() => {
    if (block) {
      deleteBlock(editor, block.from, block.to);
    }
    onClose();
  }, [editor, block, onClose]);

  const handleDuplicate = useCallback(() => {
    if (block) {
      duplicateBlock(editor, block.from, block.to);
    }
    onClose();
  }, [editor, block, onClose]);

  const handleMoveUp = useCallback(() => {
    if (block) {
      moveBlockUp(editor, block.from, block.to);
    }
    onClose();
  }, [editor, block, onClose]);

  const handleMoveDown = useCallback(() => {
    if (block) {
      moveBlockDown(editor, block.from, block.to);
    }
    onClose();
  }, [editor, block, onClose]);

  const handleCopy = useCallback(async () => {
    if (block) {
      await copyBlockToClipboard(editor, block.from, block.to);
    }
    onClose();
  }, [editor, block, onClose]);

  const handleTurnInto = useCallback(
    (action: (editor: Editor) => void) => {
      // Place cursor inside the block at the nearest valid text position.
      // For compound blocks (listItem > paragraph), block.from + 1 lands
      // between the wrapper and the inner paragraph — NOT a valid text
      // position. TextSelection.near() finds the correct spot.
      if (block) {
        try {
          const $pos = editor.state.doc.resolve(block.from + 1);
          const selection = TextSelection.near($pos);
          editor.view.dispatch(editor.state.tr.setSelection(selection));
          editor.view.focus();
        } catch {
          editor
            .chain()
            .focus()
            .setTextSelection(block.from + 1)
            .run();
        }
      }
      action(editor);
      onClose();
    },
    [editor, block, onClose]
  );

  const handleColorChange = useCallback(
    (colorValue: string, type: "text" | "background") => {
      if (!block) return;

      // For list items, apply color to the parent list node
      let targetNodeType = block.node.type.name;
      let targetPos = block.from;
      if (targetNodeType === "listItem" || targetNodeType === "taskItem") {
        try {
          const $pos = editor.state.doc.resolve(block.from);
          if ($pos.depth >= 1) {
            targetNodeType = $pos.node($pos.depth).type.name;
            targetPos = $pos.before($pos.depth);
          }
        } catch {
          // Fall back to original
        }
      }

      // Focus into the block so updateAttributes works
      editor
        .chain()
        .focus()
        .setTextSelection(targetPos + 1)
        .run();

      if (type === "text") {
        editor
          .chain()
          .updateAttributes(targetNodeType, { textColor: colorValue || null })
          .run();
      } else {
        editor
          .chain()
          .updateAttributes(targetNodeType, { backgroundColor: colorValue || null })
          .run();
      }
      onClose();
    },
    [editor, block, onClose]
  );

  const handleAskAI = useCallback(() => {
    if (block) {
      const text = editor.state.doc.textBetween(block.from, block.to, "\n");
      if (text.trim()) {
        useChatContextStore.getState().addChatContext({
          type: "selection",
          text,
          from: block.from,
          to: block.to,
        });
      }
      useLayoutStore.getState().setChatOpen(true);
    }
    onClose();
  }, [editor, block, onClose]);

  // Build dynamic menu item IDs based on block type
  type MenuItemId =
    | "delete"
    | "duplicate"
    | "turnInto"
    | "copy"
    | "moveUp"
    | "moveDown"
    | "color"
    | "askAI";
  const menuItems: MenuItemId[] = [
    "delete",
    "duplicate",
    ...(showTurnInto ? ["turnInto" as const] : []),
    "copy",
    "moveUp",
    "moveDown",
    ...(showColor ? ["color" as const] : []),
    "askAI",
  ];
  const menuItemCount = menuItems.length;

  // Get the current item ID at focusIndex
  const currentItemId = menuItems[focusIndex] ?? "delete";

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeSubmenu) {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setActiveSubmenu(null);
          return;
        }
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          if (activeSubmenu) {
            setSubmenuFocusIndex((prev) => prev + 1);
          } else {
            setFocusIndex((prev) => (prev + 1) % menuItemCount);
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          if (activeSubmenu) {
            setSubmenuFocusIndex((prev) => Math.max(0, prev - 1));
          } else {
            setFocusIndex((prev) => (prev - 1 + menuItemCount) % menuItemCount);
          }
          break;
        case "ArrowRight":
          e.preventDefault();
          if (currentItemId === "turnInto") setActiveSubmenu("turnInto");
          if (currentItemId === "color") setActiveSubmenu("color");
          break;
        case "Enter":
          e.preventDefault();
          if (!activeSubmenu) {
            switch (currentItemId) {
              case "delete":
                handleDelete();
                break;
              case "duplicate":
                handleDuplicate();
                break;
              case "turnInto":
                setActiveSubmenu("turnInto");
                break;
              case "copy":
                handleCopy();
                break;
              case "moveUp":
                handleMoveUp();
                break;
              case "moveDown":
                handleMoveDown();
                break;
              case "color":
                setActiveSubmenu("color");
                break;
              case "askAI":
                handleAskAI();
                break;
            }
          }
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    activeSubmenu,
    focusIndex,
    currentItemId,
    menuItemCount,
    handleDelete,
    handleDuplicate,
    handleCopy,
    handleMoveUp,
    handleMoveDown,
    handleAskAI,
  ]);

  // Position adjustment to stay in viewport
  const adjustedPosition = {
    x: Math.max(8, Math.min(position.x, window.innerWidth - 220)),
    y: Math.min(position.y, window.innerHeight - 320),
  };

  const turnIntoItems = turnIntoOptions.filter((o) => !isTurnIntoSeparator(o));

  return createPortal(
    <div
      ref={menuRef}
      className={cn(
        "fixed z-[100] min-w-[200px] rounded-lg border border-border bg-popover p-1.5 shadow-xl",
        "animate-in fade-in-0 zoom-in-95"
      )}
      style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
      role="menu"
      aria-label="Block actions"
    >
      {/* Delete */}
      <MenuButton
        icon={<Trash2 className="h-3.5 w-3.5" />}
        label="Delete"
        focused={currentItemId === "delete" && !activeSubmenu}
        onClick={handleDelete}
        onMouseEnter={() => {
          setFocusIndex(menuItems.indexOf("delete"));
          setActiveSubmenu(null);
        }}
        shortcut="Del"
      />

      {/* Duplicate */}
      <MenuButton
        icon={<Copy className="h-3.5 w-3.5" />}
        label="Duplicate"
        focused={currentItemId === "duplicate" && !activeSubmenu}
        onClick={handleDuplicate}
        onMouseEnter={() => {
          setFocusIndex(menuItems.indexOf("duplicate"));
          setActiveSubmenu(null);
        }}
        shortcut="Ctrl+D"
      />

      {/* Turn Into → submenu (only for text-like blocks) */}
      {showTurnInto && (
        <div
          className="relative"
          onMouseEnter={() => {
            setFocusIndex(menuItems.indexOf("turnInto"));
            setActiveSubmenu("turnInto");
            setSubmenuFocusIndex(0);
          }}
          onMouseLeave={() => setActiveSubmenu(null)}
        >
          <div
            className={cn(
              "flex cursor-default items-center gap-2 rounded-sm px-3 py-1.5 text-sm",
              currentItemId === "turnInto" || activeSubmenu === "turnInto"
                ? "bg-accent text-accent-foreground"
                : "text-foreground"
            )}
            role="menuitem"
            aria-haspopup="true"
          >
            <span className="text-muted-foreground">
              <ArrowRightLeft className="h-3.5 w-3.5" />
            </span>
            <span className="flex-1">Turn Into</span>
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          </div>

          {activeSubmenu === "turnInto" && (
            <div
              className={cn(
                "absolute left-full top-0 z-[101] max-h-[320px] min-w-[180px] overflow-y-auto rounded-lg border border-border bg-popover p-1.5 shadow-xl",
                "animate-in fade-in-0 slide-in-from-left-1"
              )}
              role="menu"
            >
              {turnIntoItems.map((option, idx) => {
                if (isTurnIntoSeparator(option)) return null;
                return (
                  <button
                    key={option.label}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-sm",
                      "transition-colors duration-75",
                      idx === submenuFocusIndex
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground hover:bg-accent/50",
                      option.isActive(editor) && "font-medium"
                    )}
                    onClick={() => handleTurnInto(option.action)}
                    onMouseEnter={() => setSubmenuFocusIndex(idx)}
                    role="menuitem"
                  >
                    <span className="text-muted-foreground">
                      {iconMap[option.iconName] || <Type className="h-3.5 w-3.5" />}
                    </span>
                    <span className="flex-1 text-left">{option.label}</span>
                    {option.isActive(editor) && <span className="text-xs text-primary">●</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Copy Block */}
      <MenuButton
        icon={<Clipboard className="h-3.5 w-3.5" />}
        label="Copy"
        focused={currentItemId === "copy" && !activeSubmenu}
        onClick={handleCopy}
        onMouseEnter={() => {
          setFocusIndex(menuItems.indexOf("copy"));
          setActiveSubmenu(null);
        }}
      />

      <div className="my-1.5 h-px bg-border" />

      {/* Move Up */}
      <MenuButton
        icon={<ArrowUp className="h-3.5 w-3.5" />}
        label="Move Up"
        focused={currentItemId === "moveUp" && !activeSubmenu}
        onClick={handleMoveUp}
        onMouseEnter={() => {
          setFocusIndex(menuItems.indexOf("moveUp"));
          setActiveSubmenu(null);
        }}
        shortcut="Ctrl+Shift+↑"
      />

      {/* Move Down */}
      <MenuButton
        icon={<ArrowDown className="h-3.5 w-3.5" />}
        label="Move Down"
        focused={currentItemId === "moveDown" && !activeSubmenu}
        onClick={handleMoveDown}
        onMouseEnter={() => {
          setFocusIndex(menuItems.indexOf("moveDown"));
          setActiveSubmenu(null);
        }}
        shortcut="Ctrl+Shift+↓"
      />

      {/* Color → submenu (only for text-like blocks) */}
      {showColor && (
        <>
          <div className="my-1.5 h-px bg-border" />
          <div
            className="relative"
            onMouseEnter={() => {
              setFocusIndex(menuItems.indexOf("color"));
              setActiveSubmenu("color");
              setSubmenuFocusIndex(0);
            }}
            onMouseLeave={() => setActiveSubmenu(null)}
          >
            <div
              className={cn(
                "flex cursor-default items-center gap-2 rounded-sm px-3 py-1.5 text-sm",
                currentItemId === "color" || activeSubmenu === "color"
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground"
              )}
              role="menuitem"
              aria-haspopup="true"
            >
              <span className="text-muted-foreground">
                <Palette className="h-3.5 w-3.5" />
              </span>
              <span className="flex-1">Color</span>
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            </div>

            {activeSubmenu === "color" && (
              <div
                className={cn(
                  "absolute left-full top-0 z-[101] min-w-[240px] rounded-lg border border-border bg-popover shadow-xl",
                  "animate-in fade-in-0 slide-in-from-left-1"
                )}
                role="menu"
              >
                <ColorPicker
                  activeTextColor={block?.node.attrs.textColor || null}
                  activeBackgroundColor={block?.node.attrs.backgroundColor || null}
                  onTextColorChange={(color) => handleColorChange(color, "text")}
                  onBackgroundColorChange={(color) => handleColorChange(color, "background")}
                />
              </div>
            )}
          </div>
        </>
      )}

      {/* Ask AI */}
      <div className="my-1.5 h-px bg-border" />
      <MenuButton
        icon={<Sparkles className="h-3.5 w-3.5 text-primary" />}
        label="Ask AI"
        focused={currentItemId === "askAI" && !activeSubmenu}
        onClick={handleAskAI}
        onMouseEnter={() => {
          setFocusIndex(menuItems.indexOf("askAI"));
          setActiveSubmenu(null);
        }}
        shortcut="Ctrl+J"
      />
    </div>,
    document.body
  );
}

/** Reusable menu button */
function MenuButton({
  icon,
  label,
  focused,
  onClick,
  onMouseEnter,
  shortcut,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  focused: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  shortcut?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-sm",
        "transition-colors duration-75",
        disabled && "pointer-events-none opacity-40",
        focused ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/50"
      )}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      disabled={disabled}
      role="menuitem"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {shortcut && <span className="text-[10px] text-muted-foreground/60">{shortcut}</span>}
    </button>
  );
}
