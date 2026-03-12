import { useState, useCallback, useMemo, useRef } from "react";
import { useFileStore } from "@/stores/file-store";
import { useDataFilesStore, getDataFileIcon } from "@/stores/data-files-store";
import { useChatContextStore } from "@/stores/chat-context-store";

export interface MentionItem {
  id: string;
  name: string;
  /** Display name with file extension stripped */
  displayName: string;
  source: "document" | "data_file";
  icon?: string | null;
  fileType?: string;
  parentName?: string;
}

/** Strip common file extensions for cleaner display */
export function stripFileExtension(name: string): string {
  return name.replace(/\.(md|csv|xlsx|xls|json|txt|pdf|doc|docx|pptx|ppt)$/i, "");
}

interface MentionQuery {
  query: string;
  startIndex: number;
}

function detectMentionQuery(value: string, cursorPos: number): MentionQuery | null {
  let i = cursorPos - 1;
  while (i >= 0) {
    const char = value[i];
    if (char === "@") {
      if (i === 0 || /\s/.test(value[i - 1])) {
        return { query: value.slice(i + 1, cursorPos), startIndex: i };
      }
      return null;
    }
    if (/[\s\n]/.test(char)) return null;
    i--;
  }
  return null;
}

export function useMentionTrigger(
  value: string,
  onChange: (value: string) => void,
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  conversationId: string | null
) {
  const [cursorPos, setCursorPos] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const mentionQueryRef = useRef<MentionQuery | null>(null);

  const files = useFileStore((s) => s.files);
  const getDataFiles = useDataFilesStore((s) => s.getDataFiles);
  const addChatContext = useChatContextStore((s) => s.addChatContext);
  const chatContexts = useChatContextStore((s) => s.chatContexts);

  // Detect @ mention query from current value + cursor
  const mentionQuery = useMemo(() => {
    return detectMentionQuery(value, cursorPos);
  }, [value, cursorPos]);

  // Keep ref in sync for use in callbacks
  mentionQueryRef.current = mentionQuery;

  // Build candidate list
  const filteredItems = useMemo(() => {
    if (!mentionQuery) return [];

    const q = mentionQuery.query.toLowerCase();
    const items: MentionItem[] = [];

    // Documents (non-folders)
    const docPages = files.filter((f) => !f.isFolder);
    // Detect duplicate names for disambiguation
    const nameCount = new Map<string, number>();
    for (const f of docPages) {
      nameCount.set(f.name, (nameCount.get(f.name) || 0) + 1);
    }

    for (const f of docPages) {
      const display = stripFileExtension(f.name);
      if (q && !f.name.toLowerCase().includes(q) && !display.toLowerCase().includes(q)) continue;
      const parentFile =
        nameCount.get(f.name)! > 1 && f.parentId ? files.find((p) => p.id === f.parentId) : null;
      items.push({
        id: f.id,
        name: f.name,
        displayName: display,
        source: "document",
        icon: f.icon,
        parentName: parentFile?.name || undefined,
      });
    }

    // Data files for current conversation
    if (conversationId) {
      const dataFiles = getDataFiles(conversationId).filter((f) => f.status === "ready");
      for (const f of dataFiles) {
        const display = stripFileExtension(f.originalFilename);
        if (
          q &&
          !f.originalFilename.toLowerCase().includes(q) &&
          !display.toLowerCase().includes(q)
        )
          continue;
        items.push({
          id: f.id,
          name: f.originalFilename,
          displayName: display,
          source: "data_file",
          icon: getDataFileIcon(f.fileType),
          fileType: f.fileType,
        });
      }
    }

    return items;
  }, [mentionQuery, files, conversationId, getDataFiles]);

  // Open/close state derived from query + results
  const shouldBeOpen = mentionQuery !== null && filteredItems.length > 0;

  // Sync open state
  if (shouldBeOpen && !isOpen) {
    setIsOpen(true);
    setSelectedIndex(0);
  } else if (!shouldBeOpen && isOpen) {
    setIsOpen(false);
  }

  // Clamp selectedIndex
  if (isOpen && selectedIndex >= filteredItems.length) {
    setSelectedIndex(Math.max(0, filteredItems.length - 1));
  }

  const trackCursor = useCallback((e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    setCursorPos(ta.selectionStart);
  }, []);

  const handleSelect = useCallback(
    (item: MentionItem) => {
      const mq = mentionQueryRef.current;
      if (!mq) return;

      // Check for duplicate
      const alreadyMentioned = chatContexts.some(
        (c) => c.type === "file_mention" && c.fileId === item.id
      );
      if (alreadyMentioned) {
        // Just close dropdown and clean up @query text
        const before = value.slice(0, mq.startIndex);
        const after = value.slice(mq.startIndex + 1 + mq.query.length);
        const newValue = before + after;
        onChange(newValue);
        setIsOpen(false);
        return;
      }

      // Replace @query with @displayName (no extension)
      const before = value.slice(0, mq.startIndex);
      const after = value.slice(mq.startIndex + 1 + mq.query.length);
      const mention = `@${item.displayName} `;
      const newValue = before + mention + after;
      const newCursorPos = mq.startIndex + mention.length;

      onChange(newValue);
      setCursorPos(newCursorPos);

      // Restore cursor after React re-render
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.setSelectionRange(newCursorPos, newCursorPos);
          ta.focus();
        }
      });

      addChatContext({
        type: "file_mention",
        fileId: item.id,
        fileName: item.displayName,
        fileSource: item.source,
      });

      setIsOpen(false);
    },
    [value, onChange, addChatContext, chatContexts, textareaRef]
  );

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!isOpen || filteredItems.length === 0) return false;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => (i + 1) % filteredItems.length);
          return true;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => (i - 1 + filteredItems.length) % filteredItems.length);
          return true;
        case "Enter":
          e.preventDefault();
          handleSelect(filteredItems[selectedIndex]);
          return true;
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          return true;
        case "Tab":
          e.preventDefault();
          handleSelect(filteredItems[selectedIndex]);
          return true;
        default:
          return false;
      }
    },
    [isOpen, filteredItems, selectedIndex, handleSelect]
  );

  return {
    isOpen,
    query: mentionQuery?.query || "",
    filteredItems,
    selectedIndex,
    setSelectedIndex,
    handleKeyDown,
    handleSelect,
    handleClose,
    trackCursor,
  };
}
