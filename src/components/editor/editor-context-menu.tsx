"use client";

import { useState, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { useTranslations } from "next-intl";
import { useIsMobile } from "@/hooks/use-device-type";
import {
  Scissors,
  Copy,
  ClipboardPaste,
  Bold,
  Italic,
  Strikethrough,
  Code,
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
  MessageSquareQuote,
  ChevronRight,
} from "lucide-react";
import { cn, formatShortcut } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor-store";
import { turnIntoOptions, isTurnIntoSeparator } from "@/lib/block-actions";

interface EditorContextMenuProps {
  editor: Editor;
}

interface MenuItem {
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
  action: () => void;
  disabled?: boolean;
  separator?: boolean;
}

interface SubMenuItem {
  label: string;
  icon: React.ReactNode;
  items: MenuItem[];
}

type MenuEntry = MenuItem | SubMenuItem | { separator: true };

function isSeparator(entry: MenuEntry): entry is { separator: true } {
  return "separator" in entry && entry.separator === true;
}

function isSubMenu(entry: MenuEntry): entry is SubMenuItem {
  return "items" in entry;
}

/**
 * Submenu content with auto-positioning: renders to the right of the parent menu,
 * flips to the left if it would overflow the viewport right edge.
 * Also clamps vertically to stay within viewport bounds.
 */
function SubMenuContent({
  parentRef,
  children,
  ...props
}: {
  parentRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ left: "100%", top: 0 });
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    if (!ref.current || !parentRef.current) return;
    const sub = ref.current.getBoundingClientRect();
    const parent = parentRef.current.getBoundingClientRect();

    let left: number | string = "100%";
    // Flip to left side if right edge would overflow
    if (parent.right + sub.width > window.innerWidth - 8) {
      left = -sub.width;
    }

    let top = 0;
    // Clamp vertically: if submenu bottom overflows viewport
    if (parent.top + sub.height > window.innerHeight - 8) {
      top = -(parent.top + sub.height - window.innerHeight + 8);
    }

    setStyle({ left, top });
    setReady(true);
  }, [parentRef]);

  return (
    <div
      ref={ref}
      className={cn(
        "absolute z-[101] min-w-[180px] rounded-lg border border-border bg-popover p-1.5 shadow-xl",
        "animate-in fade-in-0 slide-in-from-left-1"
      )}
      style={{ ...style, visibility: ready ? "visible" : "hidden" }}
      {...props}
    >
      {children}
    </div>
  );
}

export function EditorContextMenu({ editor }: EditorContextMenuProps) {
  // Two-pass positioning: rawPosition is set first, then adjusted after measurement
  const [rawPosition, setRawPosition] = useState<{ x: number; y: number } | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [isPositionReady, setIsPositionReady] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const [submenuFocusIndex, setSubmenuFocusIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const { openInlineAI } = useEditorStore();
  const t = useTranslations("editor");
  const isMobile = useIsMobile();

  const hasSelection = editor.state.selection.from !== editor.state.selection.to;

  const close = useCallback(() => {
    setRawPosition(null);
    setPosition(null);
    setIsPositionReady(false);
    setActiveSubmenu(null);
    setFocusIndex(0);
    setSubmenuFocusIndex(0);
  }, []);

  const openMenu = useCallback((x: number, y: number) => {
    setRawPosition({ x, y });
    setIsPositionReady(false);
    setFocusIndex(0);
    setActiveSubmenu(null);
  }, []);

  // Two-pass: measure menu after render and clamp to viewport
  useLayoutEffect(() => {
    if (!rawPosition || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    let x = rawPosition.x;
    let y = rawPosition.y;

    if (x + rect.width > window.innerWidth - 8) x = window.innerWidth - rect.width - 8;
    if (x < 8) x = 8;
    if (y + rect.height > window.innerHeight - 8) y = window.innerHeight - rect.height - 8;
    if (y < 8) y = 8;

    setPosition({ x, y });
    setIsPositionReady(true);
  }, [rawPosition]);

  // Handle right-click on editor + mobile long-press
  useEffect(() => {
    const editorElement = editor.view.dom;

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      openMenu(e.clientX, e.clientY);
    };

    // Mobile long-press handling
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let touchStartPos = { x: 0, y: 0 };
    const LONG_PRESS_MS = 500;
    const MOVE_THRESHOLD = 10;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || !editor.isEditable) return;
      const touch = e.touches[0];
      touchStartPos = { x: touch.clientX, y: touch.clientY };

      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        if (navigator.vibrate) navigator.vibrate(30);
        openMenu(touchStartPos.x, touchStartPos.y);
      }, LONG_PRESS_MS);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!longPressTimer) return;
      const touch = e.touches[0];
      const dx = touch.clientX - touchStartPos.x;
      const dy = touch.clientY - touchStartPos.y;
      if (Math.sqrt(dx * dx + dy * dy) > MOVE_THRESHOLD) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    const handleTouchEnd = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    editorElement.addEventListener("contextmenu", handleContextMenu);
    if (isMobile) {
      editorElement.addEventListener("touchstart", handleTouchStart, { passive: true });
      editorElement.addEventListener("touchmove", handleTouchMove, { passive: true });
      editorElement.addEventListener("touchend", handleTouchEnd);
      editorElement.addEventListener("touchcancel", handleTouchEnd);
    }

    return () => {
      editorElement.removeEventListener("contextmenu", handleContextMenu);
      if (isMobile) {
        editorElement.removeEventListener("touchstart", handleTouchStart);
        editorElement.removeEventListener("touchmove", handleTouchMove);
        editorElement.removeEventListener("touchend", handleTouchEnd);
        editorElement.removeEventListener("touchcancel", handleTouchEnd);
      }
      if (longPressTimer) clearTimeout(longPressTimer);
    };
  }, [editor, isMobile, openMenu]);

  // Close on outside click/tap
  useEffect(() => {
    if (!rawPosition) return;

    const handleDismiss = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        close();
      }
    };

    const handleScroll = (e: Event) => {
      // Ignore scroll events from within the context menu itself (e.g.
      // scrolling through submenu items)
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      close();
    };

    document.addEventListener("mousedown", handleDismiss);
    document.addEventListener("touchstart", handleDismiss, { passive: true });
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleDismiss);
      document.removeEventListener("touchstart", handleDismiss);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [rawPosition, close]);

  // Close on Escape
  useEffect(() => {
    if (!rawPosition) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [rawPosition, close]);

  // Build menu items
  const menuItems: MenuEntry[] = [
    {
      label: t("contextMenu.cut"),
      icon: <Scissors className="h-3.5 w-3.5" />,
      shortcut: "Ctrl+X",
      disabled: !hasSelection,
      action: async () => {
        const text = window.getSelection()?.toString() || "";
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        }
        editor.commands.deleteSelection();
        close();
      },
    },
    {
      label: t("contextMenu.copy"),
      icon: <Copy className="h-3.5 w-3.5" />,
      shortcut: "Ctrl+C",
      disabled: !hasSelection,
      action: async () => {
        const text = window.getSelection()?.toString() || "";
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        }
        close();
      },
    },
    {
      label: t("contextMenu.paste"),
      icon: <ClipboardPaste className="h-3.5 w-3.5" />,
      shortcut: "Ctrl+V",
      action: async () => {
        try {
          if (navigator.clipboard?.readText) {
            const text = await navigator.clipboard.readText();
            editor.commands.insertContent(text);
          }
        } catch {
          // Clipboard API may be denied by browser permission
          // Fall back silently — user can still use Ctrl+V
        }
        close();
      },
    },
    { separator: true },
    {
      label: t("contextMenu.format"),
      icon: <Bold className="h-3.5 w-3.5" />,
      items: [
        {
          label: t("bubbleMenu.bold"),
          icon: <Bold className="h-3.5 w-3.5" />,
          shortcut: "Ctrl+B",
          action: () => {
            editor.chain().focus().toggleBold().run();
            close();
          },
        },
        {
          label: t("bubbleMenu.italic"),
          icon: <Italic className="h-3.5 w-3.5" />,
          shortcut: "Ctrl+I",
          action: () => {
            editor.chain().focus().toggleItalic().run();
            close();
          },
        },
        {
          label: t("bubbleMenu.strikethrough"),
          icon: <Strikethrough className="h-3.5 w-3.5" />,
          action: () => {
            editor.chain().focus().toggleStrike().run();
            close();
          },
        },
        {
          label: t("bubbleMenu.code"),
          icon: <Code className="h-3.5 w-3.5" />,
          shortcut: "Ctrl+E",
          action: () => {
            editor.chain().focus().toggleCode().run();
            close();
          },
        },
        {
          label: t("bubbleMenu.highlight"),
          icon: <Highlighter className="h-3.5 w-3.5" />,
          action: () => {
            editor.chain().focus().toggleHighlight().run();
            close();
          },
        },
      ],
    },
    {
      label: t("bubbleMenu.turnInto"),
      icon: <Type className="h-3.5 w-3.5" />,
      items: turnIntoOptions
        .filter((o) => !isTurnIntoSeparator(o))
        .map((option) => {
          if (isTurnIntoSeparator(option)) return option as unknown as MenuItem;
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
          return {
            label: option.label,
            icon: iconMap[option.iconName] || <Type className="h-3.5 w-3.5" />,
            action: () => {
              option.action(editor);
              close();
            },
          };
        }),
    },
    { separator: true },
    {
      label: t("contextMenu.askAI"),
      icon: <Sparkles className="h-3.5 w-3.5 text-primary" />,
      disabled: !hasSelection,
      action: () => {
        if (position) {
          const { from, to } = editor.state.selection;
          const beforeStart = Math.max(0, from - 220);
          const afterEnd = Math.min(editor.state.doc.content.size, to + 220);
          openInlineAI({ x: position.x, y: position.y }, "ask", {
            from,
            to,
            beforeText: editor.state.doc.textBetween(beforeStart, from, "\n", "\n").slice(-220),
            afterText: editor.state.doc.textBetween(to, afterEnd, "\n", "\n").slice(0, 220),
          });
        }
        close();
      },
    },
  ];

  // Filter non-separator items for keyboard navigation
  const navigableItems = menuItems.filter((item) => !isSeparator(item));

  // Keyboard navigation
  useEffect(() => {
    if (!rawPosition) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeSubmenu) {
        const submenuEntry = navigableItems.find(
          (item) => isSubMenu(item) && item.label === activeSubmenu
        ) as SubMenuItem | undefined;
        if (!submenuEntry) return;

        switch (e.key) {
          case "ArrowDown":
            e.preventDefault();
            setSubmenuFocusIndex((prev) => (prev < submenuEntry.items.length - 1 ? prev + 1 : 0));
            break;
          case "ArrowUp":
            e.preventDefault();
            setSubmenuFocusIndex((prev) => (prev > 0 ? prev - 1 : submenuEntry.items.length - 1));
            break;
          case "ArrowLeft":
            e.preventDefault();
            setActiveSubmenu(null);
            break;
          case "Enter":
            e.preventDefault();
            submenuEntry.items[submenuFocusIndex]?.action();
            break;
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusIndex((prev) => (prev < navigableItems.length - 1 ? prev + 1 : 0));
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusIndex((prev) => (prev > 0 ? prev - 1 : navigableItems.length - 1));
          break;
        case "ArrowRight": {
          e.preventDefault();
          const focused = navigableItems[focusIndex];
          if (focused && isSubMenu(focused)) {
            setActiveSubmenu(focused.label);
            setSubmenuFocusIndex(0);
          }
          break;
        }
        case "Enter": {
          e.preventDefault();
          const focused = navigableItems[focusIndex];
          if (focused && isSubMenu(focused)) {
            setActiveSubmenu(focused.label);
            setSubmenuFocusIndex(0);
          } else if (focused && !isSeparator(focused) && !isSubMenu(focused)) {
            if (!focused.disabled) {
              focused.action();
            }
          }
          break;
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [rawPosition, focusIndex, activeSubmenu, submenuFocusIndex, navigableItems]);

  if (!rawPosition) return null;

  let navIndex = 0;

  return createPortal(
    <div
      ref={menuRef}
      className={cn(
        "fixed z-[100] min-w-[200px] rounded-lg border border-border bg-popover p-1.5 shadow-xl",
        "animate-in fade-in-0 zoom-in-95"
      )}
      style={{
        left: (isPositionReady ? position?.x : rawPosition.x) ?? 0,
        top: (isPositionReady ? position?.y : rawPosition.y) ?? 0,
        visibility: isPositionReady ? "visible" : "hidden",
      }}
      role="menu"
      aria-label={t("contextMenuAria")}
    >
      {menuItems.map((item, idx) => {
        if (isSeparator(item)) {
          return <div key={`sep-${idx}`} className="my-1.5 h-px bg-border" />;
        }

        const currentNavIndex = navIndex++;
        const isFocused = currentNavIndex === focusIndex && !activeSubmenu;

        if (isSubMenu(item)) {
          const isSubmenuActive = activeSubmenu === item.label;
          return (
            <div
              key={item.label}
              className="relative"
              onMouseEnter={() => {
                setFocusIndex(currentNavIndex);
                setActiveSubmenu(item.label);
                setSubmenuFocusIndex(0);
              }}
              onMouseLeave={() => setActiveSubmenu(null)}
            >
              <div
                className={cn(
                  "flex cursor-default items-center gap-2 rounded-sm px-3 py-1.5 text-sm",
                  isFocused || isSubmenuActive
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground"
                )}
                role="menuitem"
                aria-haspopup="true"
                aria-expanded={isSubmenuActive}
              >
                <span className="text-muted-foreground">{item.icon}</span>
                <span className="flex-1">{item.label}</span>
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
              </div>

              {/* Submenu — auto-flips to left side when overflowing viewport right edge */}
              {isSubmenuActive && (
                <SubMenuContent parentRef={menuRef} role="menu">
                  {item.items.map((subItem, subIdx) => (
                    <button
                      key={subItem.label}
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-sm",
                        "transition-colors duration-75",
                        subIdx === submenuFocusIndex
                          ? "bg-accent text-accent-foreground"
                          : "text-foreground hover:bg-accent/50"
                      )}
                      onClick={subItem.action}
                      onMouseEnter={() => setSubmenuFocusIndex(subIdx)}
                      role="menuitem"
                    >
                      <span className="text-muted-foreground">{subItem.icon}</span>
                      <span className="flex-1 text-left">{subItem.label}</span>
                      {subItem.shortcut && (
                        <span className="text-xs text-muted-foreground">
                          {formatShortcut(subItem.shortcut)}
                        </span>
                      )}
                    </button>
                  ))}
                </SubMenuContent>
              )}
            </div>
          );
        }

        return (
          <button
            key={item.label}
            type="button"
            className={cn(
              "flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-sm",
              "transition-colors duration-75",
              item.disabled && "pointer-events-none opacity-40",
              isFocused ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/50"
            )}
            onClick={item.action}
            onMouseEnter={() => {
              setFocusIndex(currentNavIndex);
              setActiveSubmenu(null);
            }}
            disabled={item.disabled}
            role="menuitem"
          >
            <span className="text-muted-foreground">{item.icon}</span>
            <span className="flex-1 text-left">{item.label}</span>
            {item.shortcut && (
              <span className="text-xs text-muted-foreground">{formatShortcut(item.shortcut)}</span>
            )}
          </button>
        );
      })}
    </div>,
    document.body
  );
}
