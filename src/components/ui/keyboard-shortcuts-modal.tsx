"use client";

import * as React from "react";
import { Keyboard } from "lucide-react";
import { Modal, ModalHeader } from "./modal";
import { cn } from "@/lib/utils";

interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

interface ShortcutGroup {
  title: string;
  shortcuts: {
    keys: string[];
    description: string;
  }[];
}

const shortcutGroups: ShortcutGroup[] = [
  {
    title: "Text Formatting",
    shortcuts: [
      { keys: ["Ctrl", "B"], description: "Bold" },
      { keys: ["Ctrl", "I"], description: "Italic" },
      { keys: ["Ctrl", "U"], description: "Underline" },
      { keys: ["Ctrl", "Shift", "S"], description: "Strikethrough" },
      { keys: ["Ctrl", "E"], description: "Inline code" },
      { keys: ["Ctrl", "Shift", "H"], description: "Highlight" },
      { keys: ["Ctrl", "K"], description: "Add link" },
    ],
  },
  {
    title: "Headings & Blocks",
    shortcuts: [
      { keys: ["Ctrl", "Alt", "1"], description: "Heading 1" },
      { keys: ["Ctrl", "Alt", "2"], description: "Heading 2" },
      { keys: ["Ctrl", "Alt", "3"], description: "Heading 3" },
      { keys: ["Ctrl", "Shift", "8"], description: "Bullet list" },
      { keys: ["Ctrl", "Shift", "7"], description: "Numbered list" },
      { keys: ["Ctrl", "Shift", "9"], description: "Task list" },
    ],
  },
  {
    title: "Navigation & View",
    shortcuts: [
      { keys: ["Ctrl", "K"], description: "Command palette" },
      { keys: ["Ctrl", "F"], description: "Find in document" },
      { keys: ["Ctrl", "Shift", "O"], description: "Toggle outline" },
      { keys: ["Ctrl", "?"], description: "Keyboard shortcuts" },
    ],
  },
  {
    title: "Editing",
    shortcuts: [
      { keys: ["Ctrl", "Z"], description: "Undo" },
      { keys: ["Ctrl", "Y"], description: "Redo" },
      { keys: ["Alt", "/"], description: "Trigger AI autocomplete" },
    ],
  },
  {
    title: "AI Features",
    shortcuts: [
      { keys: ["Select text"], description: "Show AI quick edit menu" },
      { keys: ["Enter"], description: "Send message in chat" },
      { keys: ["Shift", "Enter"], description: "New line in chat" },
    ],
  },
];

function KeyboardKey({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center justify-center",
        "min-w-[24px] h-6 px-1.5",
        "text-xs font-medium",
        "bg-muted border border-border rounded",
        "shadow-[0_1px_0_1px_rgba(0,0,0,0.05)]",
        "dark:shadow-[0_1px_0_1px_rgba(255,255,255,0.05)]"
      )}
    >
      {children}
    </kbd>
  );
}

export function KeyboardShortcutsModal({
  open,
  onClose,
}: KeyboardShortcutsModalProps) {
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
    <Modal open={open} onClose={onClose} className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
      <ModalHeader onClose={onClose}>
        <div className="flex items-center gap-2">
          <Keyboard className="h-5 w-5" />
          <span>Keyboard Shortcuts</span>
        </div>
      </ModalHeader>

      <div className="flex-1 overflow-y-auto -mx-6 px-6 pb-2">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {shortcutGroups.map((group) => (
            <div key={group.title}>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3">
                {group.title}
              </h3>
              <div className="space-y-2">
                {group.shortcuts.map((shortcut, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between py-1"
                  >
                    <span className="text-sm">{shortcut.description}</span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, keyIndex) => (
                        <React.Fragment key={keyIndex}>
                          <KeyboardKey>{formatKey(key)}</KeyboardKey>
                          {keyIndex < shortcut.keys.length - 1 && (
                            <span className="text-muted-foreground text-xs">+</span>
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

      <div className="pt-4 border-t border-border mt-4 text-center">
        <p className="text-xs text-muted-foreground">
          Press <KeyboardKey>{isMac ? "⌘" : "Ctrl"}</KeyboardKey>
          <span className="mx-1">+</span>
          <KeyboardKey>?</KeyboardKey> to toggle this panel
        </p>
      </div>
    </Modal>
  );
}
