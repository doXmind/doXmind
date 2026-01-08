"use client";

import { useEffect, useRef, useState } from "react";
import {
  Wand2,
  Languages,
  FileText,
  Sparkles,
  ArrowDown,
  ArrowUp,
  CheckCircle,
  MessageSquare,
  MessageCircle,
  ChevronRight,
} from "lucide-react";
import { useEditorStore } from "@/stores/editor-store";
import { useQuickEdit } from "@/hooks/use-quick-edit";
import { cn } from "@/lib/utils";

interface QuickEditOption {
  id: string;
  label: string;
  icon: React.ReactNode;
  submenu?: { id: string; label: string }[];
}

const QUICK_EDIT_OPTIONS: QuickEditOption[] = [
  {
    id: "fix-grammar",
    label: "Fix Grammar",
    icon: <CheckCircle className="h-4 w-4" />,
  },
  {
    id: "improve",
    label: "Improve Writing",
    icon: <Sparkles className="h-4 w-4" />,
  },
  {
    id: "simplify",
    label: "Simplify",
    icon: <FileText className="h-4 w-4" />,
  },
  {
    id: "expand",
    label: "Make Longer",
    icon: <ArrowUp className="h-4 w-4" />,
  },
  {
    id: "shorten",
    label: "Make Shorter",
    icon: <ArrowDown className="h-4 w-4" />,
  },
  {
    id: "tone",
    label: "Change Tone",
    icon: <MessageSquare className="h-4 w-4" />,
    submenu: [
      { id: "professional", label: "Professional" },
      { id: "casual", label: "Casual" },
      { id: "friendly", label: "Friendly" },
    ],
  },
  {
    id: "translate",
    label: "Translate",
    icon: <Languages className="h-4 w-4" />,
    submenu: [
      { id: "translate-en", label: "English" },
      { id: "translate-zh", label: "Chinese" },
    ],
  },
];

interface QuickEditMenuProps {
  onApply: (newText: string, selection: { from: number; to: number }) => void;
}

export function QuickEditMenu({ onApply }: QuickEditMenuProps) {
  const { quickEditOpen, quickEditPosition, selection, closeQuickEdit, sendToChat } =
    useEditorStore();
  const { edit, isEditing, result } = useQuickEdit();
  const menuRef = useRef<HTMLDivElement>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const [adjustedPosition, setAdjustedPosition] = useState<{ x: number; y: number } | null>(null);
  // Save selection when menu opens so we don't lose it during editing
  const savedSelectionRef = useRef<{ from: number; to: number; text: string } | null>(null);

  // Save selection when menu opens
  useEffect(() => {
    if (quickEditOpen && selection) {
      savedSelectionRef.current = { ...selection };
    }
  }, [quickEditOpen, selection]);

  // Adjust position to keep menu within viewport
  useEffect(() => {
    if (!quickEditOpen || !quickEditPosition) {
      setAdjustedPosition(null);
      return;
    }

    // Use requestAnimationFrame to ensure DOM is rendered before measuring
    const adjustPosition = () => {
      if (!menuRef.current) return;

      const menu = menuRef.current;
      const menuRect = menu.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let x = quickEditPosition.x;
      let y = quickEditPosition.y;

      // Adjust horizontal position if menu goes off right edge
      if (x + menuRect.width > viewportWidth - 20) {
        x = viewportWidth - menuRect.width - 20;
      }

      // Adjust horizontal position if menu goes off left edge
      if (x < 20) {
        x = 20;
      }

      // Adjust vertical position if menu goes off bottom edge
      if (y + menuRect.height > viewportHeight - 20) {
        y = quickEditPosition.y - menuRect.height - 20; // Show above selection
      }

      // Adjust vertical position if menu goes off top edge
      if (y < 20) {
        y = 20;
      }

      setAdjustedPosition({ x, y });
    };

    requestAnimationFrame(adjustPosition);
  }, [quickEditOpen, quickEditPosition]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        closeQuickEdit();
        setActiveSubmenu(null);
      }
    };

    if (quickEditOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [quickEditOpen, closeQuickEdit]);

  useEffect(() => {
    if (result && savedSelectionRef.current) {
      onApply(result, savedSelectionRef.current);
      closeQuickEdit();
      setActiveSubmenu(null);
    }
  }, [result, onApply, closeQuickEdit]);

  // Reset submenu when menu closes
  useEffect(() => {
    if (!quickEditOpen) {
      setActiveSubmenu(null);
    }
  }, [quickEditOpen]);

  if (!quickEditOpen || !quickEditPosition || !selection) {
    return null;
  }

  const handleSelect = async (action: string) => {
    await edit(selection.text, action);
  };

  const handleAskInChat = () => {
    // Format the selected text with a quote block for context
    const prefillText = `Help me edit this text:\n\n> ${selection.text}\n\n`;
    sendToChat(prefillText);
    closeQuickEdit();
    setActiveSubmenu(null);
  };

  // Use adjusted position if available, otherwise use original (for initial render)
  const displayPosition = adjustedPosition || quickEditPosition;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[200px] overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-lg animate-in fade-in-0 zoom-in-95"
      style={{
        left: displayPosition.x,
        top: displayPosition.y,
        // Hide initially until position is adjusted to prevent flash
        visibility: adjustedPosition ? 'visible' : 'hidden',
      }}
    >
      <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-1">
        <Wand2 className="h-3 w-3" />
        AI Quick Edit
      </div>

      <div className="h-px bg-border my-1" />

      {QUICK_EDIT_OPTIONS.map((option) => (
        <div key={option.id} className="relative">
          {option.submenu ? (
            // Item with submenu
            <button
              onMouseEnter={() => setActiveSubmenu(option.id)}
              disabled={isEditing}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                "hover:bg-accent hover:text-accent-foreground",
                "disabled:opacity-50 disabled:pointer-events-none",
                activeSubmenu === option.id && "bg-accent"
              )}
            >
              {option.icon}
              <span className="flex-1 text-left">{option.label}</span>
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            </button>
          ) : (
            // Regular item
            <button
              onClick={() => handleSelect(option.id)}
              onMouseEnter={() => setActiveSubmenu(null)}
              disabled={isEditing}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                "hover:bg-accent hover:text-accent-foreground",
                "disabled:opacity-50 disabled:pointer-events-none"
              )}
            >
              {option.icon}
              {option.label}
            </button>
          )}

          {/* Submenu */}
          {option.submenu && activeSubmenu === option.id && (
            <div
              className="absolute left-full top-0 ml-1 min-w-[140px] overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-lg animate-in fade-in-0 zoom-in-95"
              onMouseLeave={() => setActiveSubmenu(null)}
            >
              {option.submenu.map((subItem) => (
                <button
                  key={subItem.id}
                  onClick={() => handleSelect(subItem.id)}
                  disabled={isEditing}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                    "hover:bg-accent hover:text-accent-foreground",
                    "disabled:opacity-50 disabled:pointer-events-none"
                  )}
                >
                  {subItem.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}

      <div className="h-px bg-border my-1" />

      {/* Ask in Chat option */}
      <button
        onClick={handleAskInChat}
        disabled={isEditing}
        className={cn(
          "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
          "hover:bg-accent hover:text-accent-foreground",
          "disabled:opacity-50 disabled:pointer-events-none",
          "text-primary"
        )}
      >
        <MessageCircle className="h-4 w-4" />
        Ask in Chat
      </button>

      {isEditing && (
        <>
          <div className="h-px bg-border my-1" />
          <div className="px-2 py-1.5 text-xs text-muted-foreground flex items-center gap-1">
            <div className="h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            Processing...
          </div>
        </>
      )}
    </div>
  );
}
