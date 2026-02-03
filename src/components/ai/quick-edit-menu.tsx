"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Wand2, MessageCircle, ChevronRight } from "lucide-react";
import { useEditorStore } from "@/stores/editor-store";
import { useQuickEdit } from "@/hooks/use-quick-edit";
import { useMockQuickEdit } from "@/hooks/use-mock-quick-edit";
import { useMenuPosition, getSubmenuPosition } from "@/hooks/use-menu-position";
import { useMenuKeyboard } from "@/hooks/use-menu-keyboard";
import { QUICK_EDIT_OPTIONS, TOTAL_MENU_ITEMS } from "./quick-edit-options";
import { cn } from "@/lib/utils";

/** Spring animation config for menu transitions */
const MENU_SPRING = { stiffness: 500, damping: 30, mass: 0.8 };
const ITEM_SPRING = { stiffness: 400, damping: 25 };

interface QuickEditMenuProps {
  onApply: (newText: string, selection: { from: number; to: number }) => void;
  isDemoMode?: boolean;
}

export function QuickEditMenu({ onApply, isDemoMode = false }: QuickEditMenuProps) {
  const { quickEditOpen, quickEditPosition, selection, closeQuickEdit, addChatContext } =
    useEditorStore();
  // Use mock quick edit in demo mode, real API otherwise
  const realQuickEdit = useQuickEdit();
  const mockQuickEdit = useMockQuickEdit();
  const { edit, isEditing, result } = isDemoMode ? mockQuickEdit : realQuickEdit;
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [submenuFocusedIndex, setSubmenuFocusedIndex] = useState<number>(-1);
  const savedSelectionRef = useRef<{ from: number; to: number; text: string } | null>(null);

  // Use extracted position hook
  const { adjustedPosition, displayPosition } = useMenuPosition({
    isOpen: quickEditOpen,
    initialPosition: quickEditPosition,
    menuRef: menuRef as React.RefObject<HTMLDivElement>,
  });

  // Save selection when menu opens
  useEffect(() => {
    if (quickEditOpen && selection) {
      savedSelectionRef.current = { ...selection };
    }
  }, [quickEditOpen, selection]);

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isInsideMenu = menuRef.current?.contains(target);
      const isInsideSubmenu = submenuRef.current?.contains(target);

      if (isInsideMenu || isInsideSubmenu || isEditing) return;

      closeQuickEdit();
      setActiveSubmenu(null);
    };

    if (quickEditOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [quickEditOpen, closeQuickEdit, isEditing]);

  // Apply result when editing completes
  useEffect(() => {
    if (result && savedSelectionRef.current) {
      onApply(result, savedSelectionRef.current);
      closeQuickEdit();
      setActiveSubmenu(null);
    }
  }, [result, onApply, closeQuickEdit]);

  // Reset state when menu closes
  useEffect(() => {
    if (!quickEditOpen) {
      setActiveSubmenu(null);
      setFocusedIndex(-1);
      setSubmenuFocusedIndex(-1);
    }
  }, [quickEditOpen]);

  const handleSelect = useCallback(
    async (action: string) => {
      const textToEdit = savedSelectionRef.current?.text || selection?.text;
      if (!textToEdit) return;
      setActiveSubmenu(null);
      await edit(textToEdit, action);
    },
    [selection, edit]
  );

  const handleAskInChat = useCallback(() => {
    if (!selection) return;
    addChatContext({
      type: "selection",
      text: selection.text,
      from: selection.from,
      to: selection.to,
    });
    closeQuickEdit();
    setActiveSubmenu(null);
  }, [selection, addChatContext, closeQuickEdit]);

  // Handle main menu item selection
  const handleMainItemSelect = useCallback(
    (index: number) => {
      if (index >= 0 && index < QUICK_EDIT_OPTIONS.length) {
        const option = QUICK_EDIT_OPTIONS[index];
        if (option.submenu) {
          setActiveSubmenu(option.id);
          setSubmenuFocusedIndex(0);
        } else {
          handleSelect(option.id);
        }
      } else if (index === QUICK_EDIT_OPTIONS.length) {
        handleAskInChat();
      }
    },
    [handleSelect, handleAskInChat]
  );

  // Handle submenu item selection
  const handleSubmenuSelect = useCallback(
    (itemId: string) => {
      handleSelect(itemId);
    },
    [handleSelect]
  );

  // Get submenu items for active option
  const getSubmenuItems = useCallback((submenuId: string) => {
    const option = QUICK_EDIT_OPTIONS.find((o) => o.id === submenuId);
    return option?.submenu || [];
  }, []);

  // Use keyboard navigation hook
  useMenuKeyboard({
    isOpen: quickEditOpen,
    isProcessing: isEditing,
    focusedIndex,
    setFocusedIndex,
    totalItems: TOTAL_MENU_ITEMS,
    activeSubmenu,
    setActiveSubmenu,
    submenuFocusedIndex,
    setSubmenuFocusedIndex,
    getSubmenuItems,
    onSelectItem: handleMainItemSelect,
    onSelectSubmenuItem: handleSubmenuSelect,
    onClose: closeQuickEdit,
  });

  if (!quickEditOpen || !quickEditPosition || !selection || !displayPosition) {
    return null;
  }

  const activeOption = QUICK_EDIT_OPTIONS.find((o) => o.id === activeSubmenu);
  const submenuPos = activeSubmenu
    ? getSubmenuPosition(
        activeSubmenu,
        menuRef as React.RefObject<HTMLDivElement>,
        submenuRef as React.RefObject<HTMLDivElement>,
        activeOption?.submenu?.length || 4
      )
    : null;

  return (
    <>
      {/* Main Menu */}
      <motion.div
        ref={menuRef}
        role="menu"
        aria-label="AI Quick Edit options"
        initial={{ opacity: 0, y: 8, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", ...MENU_SPRING }}
        className="fixed z-50 min-w-[200px] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover p-1 shadow-lg"
        style={{
          left: displayPosition.x,
          top: displayPosition.y,
          visibility: adjustedPosition ? "visible" : "hidden",
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-muted-foreground">
          <Wand2 className="h-3 w-3" />
          AI Quick Edit
        </div>

        <div className="my-1 h-px bg-border" />

        {/* Options */}
        {QUICK_EDIT_OPTIONS.map((option, index) => (
          <MenuOption
            key={option.id}
            option={option}
            index={index}
            isEditing={isEditing}
            isFocused={focusedIndex === index}
            isSubmenuActive={activeSubmenu === option.id}
            onSelect={handleSelect}
            onHover={(idx) => {
              setActiveSubmenu(option.submenu ? option.id : null);
              setFocusedIndex(idx);
            }}
          />
        ))}

        <div className="my-1 h-px bg-border" />

        {/* Ask in Chat */}
        <motion.button
          onClick={handleAskInChat}
          onMouseEnter={() => {
            setActiveSubmenu(null);
            setFocusedIndex(QUICK_EDIT_OPTIONS.length);
          }}
          disabled={isEditing}
          whileHover={{ scale: 1.02, x: 2 }}
          whileTap={{ scale: 0.98 }}
          transition={{ type: "spring", ...ITEM_SPRING }}
          className={cn(
            "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
            "hover:bg-accent hover:text-accent-foreground",
            "disabled:pointer-events-none disabled:opacity-50",
            "text-primary",
            focusedIndex === QUICK_EDIT_OPTIONS.length && "bg-accent"
          )}
        >
          <MessageCircle className="h-4 w-4" />
          Ask in Chat
        </motion.button>

        {/* Processing indicator */}
        <AnimatePresence>
          {isEditing && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="my-1 h-px bg-border" />
              <div className="flex items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground">
                <motion.div
                  className="h-3 w-3 rounded-full border-2 border-primary border-t-transparent"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                />
                Processing...
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Submenu */}
      <AnimatePresence>
        {activeSubmenu && activeOption?.submenu && submenuPos && (
          <motion.div
            ref={submenuRef}
            role="menu"
            aria-label={`${activeOption.label} options`}
            initial={{ opacity: 0, x: -8, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -8, scale: 0.96 }}
            transition={{ type: "spring", ...MENU_SPRING }}
            className="fixed z-[60] min-w-[140px] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover p-1 shadow-lg"
            style={{ top: submenuPos.top, left: submenuPos.left }}
            onMouseEnter={() => setActiveSubmenu(activeSubmenu)}
            onMouseLeave={() => !isEditing && setActiveSubmenu(null)}
          >
            {activeOption.submenu.map((subItem, subIndex) => (
              <motion.button
                key={subItem.id}
                role="menuitem"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(subItem.id);
                }}
                onMouseEnter={() => setSubmenuFocusedIndex(subIndex)}
                disabled={isEditing}
                whileHover={{ scale: 1.02, x: 2 }}
                whileTap={{ scale: 0.98 }}
                transition={{ type: "spring", ...ITEM_SPRING }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
                  "hover:bg-accent hover:text-accent-foreground",
                  "disabled:pointer-events-none disabled:opacity-50",
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

/** Individual menu option component */
interface MenuOptionProps {
  option: (typeof QUICK_EDIT_OPTIONS)[number];
  index: number;
  isEditing: boolean;
  isFocused: boolean;
  isSubmenuActive: boolean;
  onSelect: (id: string) => void;
  onHover: (index: number) => void;
}

function MenuOption({
  option,
  index,
  isEditing,
  isFocused,
  isSubmenuActive,
  onSelect,
  onHover,
}: MenuOptionProps) {
  const hasSubmenu = !!option.submenu;

  return (
    <div data-submenu-trigger={option.id} onMouseEnter={() => onHover(index)}>
      <motion.button
        onClick={hasSubmenu ? undefined : () => onSelect(option.id)}
        disabled={isEditing}
        whileHover={{ scale: 1.02, x: 2 }}
        whileTap={{ scale: 0.98 }}
        transition={{ type: "spring", ...ITEM_SPRING }}
        className={cn(
          "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
          "hover:bg-accent hover:text-accent-foreground",
          "disabled:pointer-events-none disabled:opacity-50",
          (isSubmenuActive || isFocused) && "bg-accent text-accent-foreground"
        )}
      >
        {option.icon}
        <span className="flex-1 text-left">{option.label}</span>
        {hasSubmenu && (
          <motion.span animate={{ x: isSubmenuActive ? 2 : 0 }} transition={{ duration: 0.15 }}>
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          </motion.span>
        )}
      </motion.button>
    </div>
  );
}
