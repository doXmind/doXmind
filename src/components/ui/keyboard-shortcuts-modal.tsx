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

const shortcutGroups: ShortcutGroup[] = [
  {
    titleKey: "textFormatting",
    shortcuts: [
      { keys: ["Ctrl", "B"], descriptionKey: "bold" },
      { keys: ["Ctrl", "I"], descriptionKey: "italic" },
      { keys: ["Ctrl", "U"], descriptionKey: "underline" },
      { keys: ["Ctrl", "Shift", "S"], descriptionKey: "strikethrough" },
      { keys: ["Ctrl", "E"], descriptionKey: "inlineCode" },
      { keys: ["Ctrl", "Shift", "H"], descriptionKey: "highlight" },
      { keys: ["Ctrl", "K"], descriptionKey: "addLink" },
    ],
  },
  {
    titleKey: "headingsBlocks",
    shortcuts: [
      { keys: ["Ctrl", "Alt", "1"], descriptionKey: "heading1" },
      { keys: ["Ctrl", "Alt", "2"], descriptionKey: "heading2" },
      { keys: ["Ctrl", "Alt", "3"], descriptionKey: "heading3" },
      { keys: ["Ctrl", "Shift", "8"], descriptionKey: "bulletList" },
      { keys: ["Ctrl", "Shift", "7"], descriptionKey: "numberedList" },
      { keys: ["Ctrl", "Shift", "9"], descriptionKey: "taskList" },
    ],
  },
  {
    titleKey: "navigationView",
    shortcuts: [
      { keys: ["Ctrl", "K"], descriptionKey: "commandPalette" },
      { keys: ["Ctrl", "F"], descriptionKey: "findInDocument" },
      { keys: ["Ctrl", "?"], descriptionKey: "keyboardShortcuts" },
    ],
  },
  {
    titleKey: "editing",
    shortcuts: [
      { keys: ["Ctrl", "Z"], descriptionKey: "undoAction" },
      { keys: ["Ctrl", "Y"], descriptionKey: "redoAction" },
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

      <div className="mt-4 border-t border-border pt-4 text-center">
        <p className="text-xs text-muted-foreground">
          Press <KeyboardKey>{isMac ? "⌘" : "Ctrl"}</KeyboardKey>
          <span className="mx-1">+</span>
          <KeyboardKey>?</KeyboardKey> to toggle this panel
        </p>
      </div>
    </Modal>
  );
}
