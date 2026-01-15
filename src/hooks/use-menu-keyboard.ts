"use client";

import { useEffect, useCallback } from "react";

interface UseMenuKeyboardOptions {
  /** Whether the menu is open */
  isOpen: boolean;
  /** Whether an action is processing */
  isProcessing: boolean;
  /** Currently focused index in main menu */
  focusedIndex: number;
  /** Set focused index */
  setFocusedIndex: (index: number | ((prev: number) => number)) => void;
  /** Total items in main menu */
  totalItems: number;
  /** Active submenu ID */
  activeSubmenu: string | null;
  /** Set active submenu */
  setActiveSubmenu: (id: string | null) => void;
  /** Focused index in submenu */
  submenuFocusedIndex: number;
  /** Set submenu focused index */
  setSubmenuFocusedIndex: (index: number | ((prev: number) => number)) => void;
  /** Get submenu items for active option */
  getSubmenuItems: (activeSubmenu: string) => { id: string; label: string }[];
  /** Callback to select a main menu item */
  onSelectItem: (index: number) => void;
  /** Callback to select a submenu item */
  onSelectSubmenuItem: (itemId: string) => void;
  /** Callback to close menu */
  onClose: () => void;
}

/**
 * Hook for handling keyboard navigation in a menu with submenus.
 * Supports arrow keys, Enter, Escape, Home, End.
 */
export function useMenuKeyboard({
  isOpen,
  isProcessing,
  focusedIndex,
  setFocusedIndex,
  totalItems,
  activeSubmenu,
  setActiveSubmenu,
  submenuFocusedIndex,
  setSubmenuFocusedIndex,
  getSubmenuItems,
  onSelectItem,
  onSelectSubmenuItem,
  onClose,
}: UseMenuKeyboardOptions): void {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Handle submenu navigation if a submenu is open
      if (activeSubmenu) {
        const submenuItems = getSubmenuItems(activeSubmenu);

        switch (e.key) {
          case "ArrowDown":
            e.preventDefault();
            setSubmenuFocusedIndex((prev) =>
              prev < submenuItems.length - 1 ? prev + 1 : 0
            );
            break;
          case "ArrowUp":
            e.preventDefault();
            setSubmenuFocusedIndex((prev) =>
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
              onSelectSubmenuItem(submenuItems[submenuFocusedIndex].id);
            }
            break;
        }
        return;
      }

      // Main menu navigation
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusedIndex((prev) => (prev < totalItems - 1 ? prev + 1 : 0));
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusedIndex((prev) => (prev > 0 ? prev - 1 : totalItems - 1));
          break;
        case "ArrowRight":
          e.preventDefault();
          onSelectItem(focusedIndex);
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          onSelectItem(focusedIndex);
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
        case "Home":
          e.preventDefault();
          setFocusedIndex(0);
          break;
        case "End":
          e.preventDefault();
          setFocusedIndex(totalItems - 1);
          break;
      }
    },
    [
      activeSubmenu,
      focusedIndex,
      totalItems,
      submenuFocusedIndex,
      getSubmenuItems,
      setFocusedIndex,
      setActiveSubmenu,
      setSubmenuFocusedIndex,
      onSelectItem,
      onSelectSubmenuItem,
      onClose,
    ]
  );

  useEffect(() => {
    if (!isOpen || isProcessing) return;

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isProcessing, handleKeyDown]);
}
