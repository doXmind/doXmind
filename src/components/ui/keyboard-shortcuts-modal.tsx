"use client";

import * as React from "react";
import { Keyboard } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal, ModalHeader } from "./modal";
import { cn } from "@/lib/utils";

interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

interface ShortcutGroup {
  titleKey: string;
  shortcuts: {
    keys: string[];
    descriptionKey: string;
  }[];
}

// Every row here is asserted against the real binding by
// src/__tests__/components/ui/keyboard-shortcuts-accuracy.test.ts. A shortcut reference that has
// drifted from the code is worse than none: it teaches the user a key that does nothing.
const shortcutGroups: ShortcutGroup[] = [
  {
    titleKey: "navigationView",
    shortcuts: [
      { keys: ["Ctrl", "P"], descriptionKey: "commandPalette" },
      { keys: ["Ctrl", "O"], descriptionKey: "quickSwitcher" },
      { keys: ["Ctrl", "N"], descriptionKey: "newPage" },
      { keys: ["Ctrl", "F"], descriptionKey: "findInDocument" },
      { keys: ["Ctrl", "B"], descriptionKey: "toggleSidebar" },
      { keys: ["F11"], descriptionKey: "toggleFocusMode" },
      { keys: ["Ctrl", "?"], descriptionKey: "keyboardShortcuts" },
    ],
  },
  {
    titleKey: "editing",
    shortcuts: [
      { keys: ["Ctrl", "S"], descriptionKey: "saveAction" },
      { keys: ["Ctrl", "Z"], descriptionKey: "undoAction" },
      { keys: ["Ctrl", "Shift", "Z"], descriptionKey: "redoAction" },
      { keys: ["Ctrl", "K"], descriptionKey: "insertLink" },
      { keys: ["Ctrl", "D"], descriptionKey: "duplicateBlock" },
      { keys: ["Ctrl", "/"], descriptionKey: "blockMenu" },
    ],
  },
];

function KeyboardKey({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center justify-center",
        "h-6 min-w-[24px] px-1.5",
        "text-xs font-medium",
        "rounded border border-border bg-muted",
        "shadow-[0_1px_0_1px_rgba(0,0,0,0.05)]",
        "dark:shadow-[0_1px_0_1px_rgba(255,255,255,0.05)]"
      )}
    >
      {children}
    </kbd>
  );
}

export function KeyboardShortcutsModal({ open, onClose }: KeyboardShortcutsModalProps) {
  const t = useTranslations("shortcuts");
  // Detect if user is on macOS
  const [isMac, setIsMac] = React.useState(false);

  React.useEffect(() => {
    setIsMac(navigator.platform.toUpperCase().indexOf("MAC") >= 0);
  }, []);

  // Replace Ctrl with Cmd on macOS
  const formatKey = (key: string) => {
    if (isMac && key === "Ctrl") return "⌘";
    if (isMac && key === "Alt") return "⌥";
    if (isMac && key === "Shift") return "⇧";
    return key;
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      className="flex max-h-[65vh] max-w-2xl flex-col overflow-hidden"
    >
      <ModalHeader onClose={onClose}>
        <div className="flex items-center gap-2">
          <Keyboard className="h-5 w-5" />
          <span>{t("keyboardShortcuts")}</span>
        </div>
      </ModalHeader>

      <div className="-mx-6 flex-1 overflow-y-auto px-6 pb-2">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {shortcutGroups.map((group) => (
            <div key={group.titleKey}>
              <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
                {t(group.titleKey)}
              </h3>
              <div className="space-y-2">
                {group.shortcuts.map((shortcut, index) => (
                  <div key={index} className="flex items-center justify-between py-1">
                    <span className="text-sm">{t(shortcut.descriptionKey)}</span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, keyIndex) => (
                        <React.Fragment key={keyIndex}>
                          <KeyboardKey>{formatKey(key)}</KeyboardKey>
                          {keyIndex < shortcut.keys.length - 1 && (
                            <span className="text-xs text-muted-foreground">+</span>
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
