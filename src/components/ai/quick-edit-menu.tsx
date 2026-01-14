"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
  Check,
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
      { id: "confident", label: "Confident" },
    ],
  },
  {
    id: "translate",
    label: "Translate",
    icon: <Languages className="h-4 w-4" />,
    submenu: [
      { id: "translate-en", label: "English" },
      { id: "translate-zh", label: "Chinese" },
      { id: "translate-es", label: "Spanish" },
      { id: "translate-fr", label: "French" },
      { id: "translate-de", label: "German" },
      { id: "translate-ja", label: "Japanese" },
    ],
  },
];

interface QuickEditMenuProps {
  onApply: (newText: string, selection: { from: number; to: number }) => void;
}

// Total count: QUICK_EDIT_OPTIONS.length + 1 (Ask in Chat)
const TOTAL_ITEMS = QUICK_EDIT_OPTIONS.length + 1;

export function QuickEditMenu({ onApply }: QuickEditMenuProps) {
  const { quickEditOpen, quickEditPosition, selection, closeQuickEdit, addChatContext } =
    useEditorStore();
  const { edit, isEditing, result } = useQuickEdit();
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const [adjustedPosition, setAdjustedPosition] = useState<{ x: number; y: number } | null>(null);
  const [submenuPosition, setSubmenuPosition] = useState<{ top: number; left: number } | null>(null);
  // Keyboard navigation state
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [submenuFocusedIndex, setSubmenuFocusedIndex] = useState<number>(-1);
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
      const target = event.target as Node;
      const isInsideMenu = menuRef.current && menuRef.current.contains(target);
      const isInsideSubmenu = submenuRef.current && submenuRef.current.contains(target);

      // Don't close if clicking inside menu or submenu
      if (isInsideMenu || isInsideSubmenu) {
        return;
      }

      // Don't close if currently editing (processing)
      if (isEditing) {
        return;
      }

      closeQuickEdit();
      setActiveSubmenu(null);
    };

    if (quickEditOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [quickEditOpen, closeQuickEdit, isEditing]);

  useEffect(() => {
    if (result && savedSelectionRef.current) {
      onApply(result, savedSelectionRef.current);
      closeQuickEdit();
      setActiveSubmenu(null);
    }
  }, [result, onApply, closeQuickEdit]);

  // Reset submenu and focus when menu closes
  useEffect(() => {
    if (!quickEditOpen) {
      setActiveSubmenu(null);
      setFocusedIndex(-1);
      setSubmenuFocusedIndex(-1);
    }
  }, [quickEditOpen]);

  // Keyboard navigation handler
  useEffect(() => {
    if (!quickEditOpen || isEditing) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle submenu navigation if a submenu is open
      if (activeSubmenu) {
        const activeOption = QUICK_EDIT_OPTIONS.find(o => o.id === activeSubmenu);
        const submenuItems = activeOption?.submenu || [];

        switch (e.key) {
          case "ArrowDown":
            e.preventDefault();
            setSubmenuFocusedIndex(prev =>
              prev < submenuItems.length - 1 ? prev + 1 : 0
            );
            break;
          case "ArrowUp":
            e.preventDefault();
            setSubmenuFocusedIndex(prev =>
              prev > 0 ? prev - 1 : submenuItems.length - 1
            );
            break;
          case "ArrowLeft":
          case "Escape":
            e.preventDefault();
            setActiveSubmenu(null);
            setSubmenuFocusedIndex(-1);
            break;
          case "Enter":
          case " ":
            e.preventDefault();
            if (submenuFocusedIndex >= 0 && submenuFocusedIndex < submenuItems.length) {
              handleSelect(submenuItems[submenuFocusedIndex].id);
            }
            break;
        }
        return;
      }

      // Main menu navigation
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusedIndex(prev => (prev < TOTAL_ITEMS - 1 ? prev + 1 : 0));
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusedIndex(prev => (prev > 0 ? prev - 1 : TOTAL_ITEMS - 1));
          break;
        case "ArrowRight":
          e.preventDefault();
          // Open submenu if current item has one
          if (focusedIndex >= 0 && focusedIndex < QUICK_EDIT_OPTIONS.length) {
            const option = QUICK_EDIT_OPTIONS[focusedIndex];
            if (option.submenu) {
              setActiveSubmenu(option.id);
              setSubmenuFocusedIndex(0);
            }
          }
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < QUICK_EDIT_OPTIONS.length) {
            const option = QUICK_EDIT_OPTIONS[focusedIndex];
            if (option.submenu) {
              setActiveSubmenu(option.id);
              setSubmenuFocusedIndex(0);
            } else {
              handleSelect(option.id);
            }
          } else if (focusedIndex === QUICK_EDIT_OPTIONS.length) {
            // Ask in Chat
            handleAskInChat();
          }
          break;
        case "Escape":
          e.preventDefault();
          closeQuickEdit();
          break;
        case "Home":
          e.preventDefault();
          setFocusedIndex(0);
          break;
        case "End":
          e.preventDefault();
          setFocusedIndex(TOTAL_ITEMS - 1);
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [quickEditOpen, isEditing, activeSubmenu, focusedIndex, submenuFocusedIndex, closeQuickEdit]);

  if (!quickEditOpen || !quickEditPosition || !selection) {
    return null;
  }

  const handleSelect = async (action: string) => {
    // Use saved selection to ensure we have the text even if selection changed
    const textToEdit = savedSelectionRef.current?.text || selection.text;
    // Close only the submenu, keep main menu open to show loading state
    setActiveSubmenu(null);
    await edit(textToEdit, action);
  };

  const handleAskInChat = () => {
    // Add chat context to show as a Context Pill (supports multiple)
    addChatContext({
      type: 'selection',
      text: selection.text,
      from: selection.from,
      to: selection.to,
    });
    closeQuickEdit();
    setActiveSubmenu(null);
  };

  // Use adjusted position if available, otherwise use original (for initial render)
  const displayPosition = adjustedPosition || quickEditPosition;

  // Calculate submenu position based on the active item
  const getSubmenuPosition = (optionId: string) => {
    const itemElement = document.querySelector(`[data-submenu-trigger="${optionId}"]`);
    if (!itemElement || !menuRef.current) return { top: 0, left: 0 };

    const itemRect = itemElement.getBoundingClientRect();
    const menuRect = menuRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;

    // Default: align submenu top with trigger item top
    let top = itemRect.top;

    // Get actual submenu element if it exists, otherwise estimate
    const submenuElement = submenuRef.current;
    let submenuHeight: number;

    if (submenuElement) {
      submenuHeight = submenuElement.getBoundingClientRect().height;
    } else {
      // Estimate: each item ~32px + padding 8px
      const activeOpt = QUICK_EDIT_OPTIONS.find(o => o.id === optionId);
      const submenuItemCount = activeOpt?.submenu?.length || 4;
      submenuHeight = submenuItemCount * 32 + 8;
    }

    // Check if submenu would go below viewport
    if (top + submenuHeight > viewportHeight - 10) {
      // Align submenu bottom with viewport bottom (with padding)
      top = viewportHeight - submenuHeight - 10;
    }

    // Ensure submenu doesn't go above viewport
    if (top < 10) {
      top = 10;
    }

    return {
      top,
      left: menuRect.right + 4,
    };
  };

  const activeOption = QUICK_EDIT_OPTIONS.find(o => o.id === activeSubmenu);
  const submenuPos = activeSubmenu ? getSubmenuPosition(activeSubmenu) : null;

  return (
    <>
      <motion.div
        ref={menuRef}
        role="menu"
        aria-label="AI Quick Edit options"
        initial={{ opacity: 0, y: 8, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{
          type: 'spring',
          stiffness: 500,
          damping: 30,
          mass: 0.8
        }}
        className="fixed z-50 min-w-[200px] rounded-lg border border-border bg-popover p-1 shadow-lg"
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

        {QUICK_EDIT_OPTIONS.map((option, index) => (
          <div
            key={option.id}
            data-submenu-trigger={option.id}
            onMouseEnter={() => {
              setActiveSubmenu(option.submenu ? option.id : null);
              setFocusedIndex(index);
            }}
          >
            {option.submenu ? (
              // Item with submenu
              <motion.button
                disabled={isEditing}
                whileHover={{ scale: 1.02, x: 2 }}
                whileTap={{ scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
                  "hover:bg-accent hover:text-accent-foreground",
                  "disabled:opacity-50 disabled:pointer-events-none",
                  (activeSubmenu === option.id || focusedIndex === index) && "bg-accent text-accent-foreground"
                )}
              >
                {option.icon}
                <span className="flex-1 text-left">{option.label}</span>
                <motion.span
                  animate={{ x: activeSubmenu === option.id ? 2 : 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                </motion.span>
              </motion.button>
            ) : (
              // Regular item
              <motion.button
                onClick={() => handleSelect(option.id)}
                disabled={isEditing}
                whileHover={{ scale: 1.02, x: 2 }}
                whileTap={{ scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
                  "hover:bg-accent hover:text-accent-foreground",
                  "disabled:opacity-50 disabled:pointer-events-none",
                  focusedIndex === index && "bg-accent text-accent-foreground"
                )}
              >
                {option.icon}
                {option.label}
              </motion.button>
            )}
          </div>
        ))}

        <div className="h-px bg-border my-1" />

        {/* Ask in Chat option */}
        <motion.button
          onClick={handleAskInChat}
          onMouseEnter={() => {
            setActiveSubmenu(null);
            setFocusedIndex(QUICK_EDIT_OPTIONS.length);
          }}
          disabled={isEditing}
          whileHover={{ scale: 1.02, x: 2 }}
          whileTap={{ scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          className={cn(
            "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
            "hover:bg-accent hover:text-accent-foreground",
            "disabled:opacity-50 disabled:pointer-events-none",
            "text-primary",
            focusedIndex === QUICK_EDIT_OPTIONS.length && "bg-accent"
          )}
        >
          <MessageCircle className="h-4 w-4" />
          Ask in Chat
        </motion.button>

        <AnimatePresence>
          {isEditing && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="h-px bg-border my-1" />
              <div className="px-2 py-1.5 text-xs text-muted-foreground flex items-center gap-1">
                <motion.div
                  className="h-3 w-3 rounded-full border-2 border-primary border-t-transparent"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                />
                Processing...
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Submenu rendered as a separate fixed element */}
      <AnimatePresence>
        {activeSubmenu && activeOption?.submenu && submenuPos && (
          <motion.div
            ref={submenuRef}
            role="menu"
            aria-label={`${activeOption.label} options`}
            initial={{ opacity: 0, x: -8, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -8, scale: 0.96 }}
            transition={{
              type: 'spring',
              stiffness: 500,
              damping: 30,
              mass: 0.8
            }}
            className="fixed z-[60] min-w-[140px] rounded-lg border border-border bg-popover p-1 shadow-lg"
            style={{
              top: submenuPos.top,
              left: submenuPos.left,
            }}
            onMouseEnter={() => setActiveSubmenu(activeSubmenu)}
            onMouseLeave={() => !isEditing && setActiveSubmenu(null)}
          >
            {activeOption.submenu.map((subItem, subIndex) => (
              <motion.button
                key={subItem.id}
                role="menuitem"
                onMouseDown={(e) => {
                  e.preventDefault(); // Prevent focus loss
                  handleSelect(subItem.id);
                }}
                onMouseEnter={() => setSubmenuFocusedIndex(subIndex)}
                disabled={isEditing}
                whileHover={{ scale: 1.02, x: 2 }}
                whileTap={{ scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
                  "hover:bg-accent hover:text-accent-foreground",
                  "disabled:opacity-50 disabled:pointer-events-none",
                  submenuFocusedIndex === subIndex && "bg-accent text-accent-foreground"
                )}
              >
                {subItem.label}
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
