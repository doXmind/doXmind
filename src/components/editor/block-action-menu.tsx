"use client";

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { useTranslations } from "next-intl";
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
  Heading4,
  Heading5,
  Heading6,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Code,
  MessageSquareQuote,
  ChevronRight,
  Palette,
  ArrowRightLeft,
} from "lucide-react";
import { AiLogoIcon } from "@/components/ui/ai-logo-icon";
import { cn } from "@/lib/utils";
import { turnIntoOptions, isTurnIntoSeparator } from "@/lib/block-actions";
import { useLayoutStore } from "@/stores/layout-store";
import { useChatContextStore } from "@/stores/chat-context-store";
import { nodeToMarkdown } from "@/lib/markdown-selection";
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
  Heading4: <Heading4 className="h-3.5 w-3.5" />,
  Heading5: <Heading5 className="h-3.5 w-3.5" />,
  Heading6: <Heading6 className="h-3.5 w-3.5" />,
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
  const t = useTranslations("editor");
  // Freeze blockPos at mount time — parent may update hoveredBlockPos
  // via mousemove, but our target block must never change while open.
  const [stableBlockPos] = useState(blockPos);
  const [focusIndex, setFocusIndex] = useState(0);
  const [activeSubmenu, setActiveSubmenu] = useState<SubmenuType>(null);
  const [submenuFocusIndex, setSubmenuFocusIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const turnIntoRef = useRef<HTMLDivElement>(null);
  const colorRef = useRef<HTMLDivElement>(null);
  const [submenuStyle, setSubmenuStyle] = useState<React.CSSProperties>({});
  const submenuCloseTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Delayed close for submenus — allows mouse to travel from trigger to fixed submenu
  const scheduleSubmenuClose = useCallback(() => {
    submenuCloseTimer.current = setTimeout(() => setActiveSubmenu(null), 150);
  }, []);
  const cancelSubmenuClose = useCallback(() => {
    clearTimeout(submenuCloseTimer.current);
  }, []);

  // Compute fixed position for submenus so they stay within the viewport.
  // useLayoutEffect runs after DOM commit but before paint, so the submenu
  // is positioned correctly on the very first frame (no flash).
  useLayoutEffect(() => {
    if (!activeSubmenu || !menuRef.current) {
      setSubmenuStyle({});
      return;
    }

    const submenuEl = activeSubmenu === "turnInto" ? turnIntoRef.current : colorRef.current;
    const triggerEl = menuRef.current?.querySelector(
      `[data-submenu-trigger="${activeSubmenu}"]`
    ) as HTMLElement | null;
    if (!submenuEl || !triggerEl) return;

    const menuRect = menuRef.current!.getBoundingClientRect();
    const triggerRect = triggerEl.getBoundingClientRect();
    const submenuRect = submenuEl.getBoundingClientRect();
    const padding = 10;

    // Anchor horizontally to the main menu's right edge
    let left = menuRect.right + 4;
    let top = triggerRect.top;
    let maxHeight: number | undefined;

    // Vertical overflow — shift up so bottom stays within viewport
    if (top + submenuRect.height > window.innerHeight - padding) {
      top = window.innerHeight - submenuRect.height - padding;
    }

    // If shifted above viewport, clamp to top and constrain height
    if (top < padding) {
      top = padding;
      maxHeight = window.innerHeight - 2 * padding;
    }

    // Horizontal overflow — show to the left of the main menu instead
    if (left + submenuRect.width > window.innerWidth - padding) {
      left = menuRect.left - submenuRect.width - 4;
    }

    setSubmenuStyle({
      position: "fixed",
      left,
      top,
      ...(maxHeight ? { maxHeight, overflowY: "auto" as const } : {}),
    });
  }, [activeSubmenu]);

  const block = getBlockAtPos(editor, stableBlockPos);
  const blockType = block?.node.type.name ?? "";
  const showTurnInto = TURN_INTO_TYPES.has(blockType);
  const showColor = COLOR_TYPES.has(blockType);
  const resolveColorTarget = useCallback(
    (type: "text" | "background") => {
      if (!block) return null;

      let targetPos = block.from;
      let targetNode = block.node;

      if (
        targetNode.type.name === "bulletList" ||
        targetNode.type.name === "orderedList" ||
        targetNode.type.name === "taskList"
      ) {
        try {
          const { $from } = editor.state.selection;
          for (let depth = $from.depth; depth >= 1; depth--) {
            const typeName = $from.node(depth).type.name;
            if (typeName === "listItem" || typeName === "taskItem") {
              targetPos = $from.before(depth);
              const itemNode = editor.state.doc.nodeAt(targetPos);
              if (itemNode) {
                targetNode = itemNode;
              }
              break;
            }
          }
        } catch {
          // Fall back to the original target block.
        }
      }

      // For list item text colors, write to the inner text block so color
      // wins over paragraph defaults and behaves like Notion's per-item text color.
      if (
        type === "text" &&
        (targetNode.type.name === "listItem" || targetNode.type.name === "taskItem")
      ) {
        const contentPos = targetPos + 1;
        const contentNode = editor.state.doc.nodeAt(contentPos);
        if (
          contentNode &&
          (contentNode.type.name === "paragraph" || contentNode.type.name === "heading")
        ) {
          targetPos = contentPos;
          targetNode = contentNode;
        }
      }

      return { targetPos, targetNode };
    },
    [editor, block]
  );

  const colorTargetNode = (() => {
    const target = resolveColorTarget("text");
    if (!target) return null;
    if (target.targetNode.type.name === "paragraph" || target.targetNode.type.name === "heading") {
      return target.targetNode;
    }
    if (!block) return null;
    return target.targetNode;
  })();

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

  // Clean up submenu close timer on unmount
  useEffect(() => {
    return () => clearTimeout(submenuCloseTimer.current);
  }, []);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      // Check if click is inside the main menu or any fixed submenu
      if (menuRef.current?.contains(target)) return;
      if (turnIntoRef.current?.contains(target)) return;
      if (colorRef.current?.contains(target)) return;
      onClose();
    };
    const handleScroll = (e: Event) => {
      // Ignore scroll events from within the menu or submenus
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (turnIntoRef.current?.contains(target)) return;
      if (colorRef.current?.contains(target)) return;
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
      const target = resolveColorTarget(type);
      if (!target) return;

      // Use direct ProseMirror transaction to set attributes at the exact position
      // instead of selection-dependent updateAttributes which can target the wrong block
      const attrKey = type === "text" ? "textColor" : "backgroundColor";
      const tr = editor.state.tr.setNodeMarkup(target.targetPos, undefined, {
        ...target.targetNode.attrs,
        [attrKey]: colorValue || null,
      });
      editor.view.dispatch(tr);
      onClose();
    },
    [editor, onClose, resolveColorTarget]
  );

  const handleAskAI = useCallback(() => {
    if (block) {
      // Serialize block node to markdown — matches the format backend operates on
      const text = nodeToMarkdown(editor, block.node);

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
      aria-label={t("blockAction.blockActionsAria")}
    >
      {/* Delete */}
      <MenuButton
        icon={<Trash2 className="h-3.5 w-3.5" />}
        label={t("blockAction.delete")}
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
        label={t("blockAction.duplicate")}
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
          data-submenu-trigger="turnInto"
          onMouseEnter={() => {
            cancelSubmenuClose();
            setFocusIndex(menuItems.indexOf("turnInto"));
            setActiveSubmenu("turnInto");
            setSubmenuFocusIndex(0);
          }}
          onMouseLeave={scheduleSubmenuClose}
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
            <span className="flex-1">{t("blockAction.turnInto")}</span>
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          </div>

          {activeSubmenu === "turnInto" && (
            <div
              ref={turnIntoRef}
              className={cn(
                "fixed z-[101] max-h-[320px] min-w-[180px] overflow-y-auto rounded-lg border border-border bg-popover p-1.5 shadow-xl",
                "animate-in fade-in-0 slide-in-from-left-1"
              )}
              style={submenuStyle}
              onMouseEnter={cancelSubmenuClose}
              onMouseLeave={scheduleSubmenuClose}
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
        label={t("blockAction.copy")}
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
        label={t("blockAction.moveUp")}
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
        label={t("blockAction.moveDown")}
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
            data-submenu-trigger="color"
            onMouseEnter={() => {
              cancelSubmenuClose();
              setFocusIndex(menuItems.indexOf("color"));
              setActiveSubmenu("color");
              setSubmenuFocusIndex(0);
            }}
            onMouseLeave={scheduleSubmenuClose}
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
              <span className="flex-1">{t("blockAction.color")}</span>
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            </div>

            {activeSubmenu === "color" && (
              <div
                ref={colorRef}
                className={cn(
                  "fixed z-[101] min-w-[240px] rounded-lg border border-border bg-popover shadow-xl",
                  "animate-in fade-in-0 slide-in-from-left-1"
                )}
                style={submenuStyle}
                onMouseEnter={cancelSubmenuClose}
                onMouseLeave={scheduleSubmenuClose}
                role="menu"
              >
                <ColorPicker
                  activeTextColor={colorTargetNode?.attrs.textColor || null}
                  activeBackgroundColor={colorTargetNode?.attrs.backgroundColor || null}
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
        icon={<AiLogoIcon className="h-3.5 w-3.5 text-primary" />}
        label={t("blockAction.askAI")}
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
