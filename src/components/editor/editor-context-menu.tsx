"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { useTranslations } from "next-intl";
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

export function EditorContextMenu({ editor }: EditorContextMenuProps) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const [submenuFocusIndex, setSubmenuFocusIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const { openQuickEdit } = useEditorStore();
  const t = useTranslations("editor");

  const hasSelection = editor.state.selection.from !== editor.state.selection.to;

  const close = useCallback(() => {
    setPosition(null);
    setActiveSubmenu(null);
    setFocusIndex(0);
    setSubmenuFocusIndex(0);
  }, []);

  // Handle right-click on editor
  useEffect(() => {
    const editorElement = editor.view.dom;

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();

      // Position within viewport bounds
      const x = Math.min(e.clientX, window.innerWidth - 220);
      const y = Math.min(e.clientY, window.innerHeight - 300);

      setPosition({ x, y });
      setFocusIndex(0);
      setActiveSubmenu(null);
    };

    editorElement.addEventListener("contextmenu", handleContextMenu);
    return () => {
      editorElement.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [editor]);

  // Close on outside click
  useEffect(() => {
    if (!position) return;

    const handleClick = (e: MouseEvent) => {
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

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [position, close]);

  // Close on Escape
  useEffect(() => {
    if (!position) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [position, close]);

  // Build menu items
  const menuItems: MenuEntry[] = [
    {
      label: t("contextMenu.cut"),
      icon: <Scissors className="h-3.5 w-3.5" />,
      shortcut: "Ctrl+X",
      disabled: !hasSelection,
      action: () => {
        document.execCommand("cut");
        close();
      },
    },
    {
      label: t("contextMenu.copy"),
      icon: <Copy className="h-3.5 w-3.5" />,
      shortcut: "Ctrl+C",
      disabled: !hasSelection,
      action: () => {
        document.execCommand("copy");
        close();
      },
    },
    {
      label: t("contextMenu.paste"),
      icon: <ClipboardPaste className="h-3.5 w-3.5" />,
      shortcut: "Ctrl+V",
      action: () => {
        document.execCommand("paste");
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
          openQuickEdit({ x: position.x, y: position.y });
        }
        close();
      },
    },
  ];

  // Filter non-separator items for keyboard navigation
  const navigableItems = menuItems.filter((item) => !isSeparator(item));

  // Keyboard navigation
  useEffect(() => {
    if (!position) return;

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
  }, [position, focusIndex, activeSubmenu, submenuFocusIndex, navigableItems]);

  if (!position) return null;

  let navIndex = 0;

  return createPortal(
    <div
      ref={menuRef}
      className={cn(
        "fixed z-[100] min-w-[200px] rounded-lg border border-border bg-popover p-1.5 shadow-xl",
        "animate-in fade-in-0 zoom-in-95"
      )}
      style={{ left: position.x, top: position.y }}
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

              {/* Submenu */}
              {isSubmenuActive && (
                <div
                  className={cn(
                    "absolute left-full top-0 z-[101] min-w-[180px] rounded-lg border border-border bg-popover p-1.5 shadow-xl",
                    "animate-in fade-in-0 slide-in-from-left-1"
                  )}
                  role="menu"
                >
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
                </div>
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
