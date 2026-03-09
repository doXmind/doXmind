"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Editor } from "@tiptap/react";

interface InlineCommentToolbarProps {
  editor: Editor | null;
  onAddComment: (from: number, to: number, text: string) => void;
}

export function InlineCommentToolbar({ editor, onAddComment }: InlineCommentToolbarProps) {
  const t = useTranslations("inlineComments");
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [selectionData, setSelectionData] = useState<{
    from: number;
    to: number;
    text: string;
  } | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    if (!editor) return;

    const { from, to, empty } = editor.state.selection;
    if (empty || from === to) {
      setPosition(null);
      setSelectionData(null);
      return;
    }

    // Get the selected text
    const text = editor.state.doc.textBetween(from, to, " ");
    if (!text.trim()) {
      setPosition(null);
      setSelectionData(null);
      return;
    }

    // Get selection bounding rect from the DOM
    const { view } = editor;
    const start = view.coordsAtPos(from);
    const end = view.coordsAtPos(to);

    // Position toolbar above the selection
    const editorDom = view.dom.closest(".ProseMirror")?.parentElement;
    if (!editorDom) return;

    const editorRect = editorDom.getBoundingClientRect();
    const midX = (start.left + end.left) / 2;
    const top = start.top - editorRect.top - 44; // 44px above selection
    const left = midX - editorRect.left;

    // Clamp to viewport
    const clampedLeft = Math.max(8, Math.min(left, editorRect.width - 120));
    const clampedTop = top < 8 ? end.bottom - editorRect.top + 8 : top;

    setPosition({ top: clampedTop, left: clampedLeft });
    setSelectionData({ from, to, text: text.slice(0, 500) });
  }, [editor]);

  useEffect(() => {
    if (!editor) return;

    editor.on("selectionUpdate", updatePosition);
    return () => {
      editor.off("selectionUpdate", updatePosition);
    };
  }, [editor, updatePosition]);

  // Close toolbar on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        // Don't close if clicking inside the editor (selection may change)
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!position || !selectionData) return null;

  return (
    <div
      ref={toolbarRef}
      className="animate-in fade-in-0 zoom-in-95 absolute z-50 duration-150"
      style={{ top: position.top, left: position.left, transform: "translateX(-50%)" }}
    >
      <Button
        variant="secondary"
        size="sm"
        className="gap-1.5 border border-border/50 bg-background shadow-md hover:bg-accent"
        onClick={() => {
          onAddComment(selectionData.from, selectionData.to, selectionData.text);
          setPosition(null);
          setSelectionData(null);
        }}
      >
        <MessageSquarePlus className="h-3.5 w-3.5" />
        <span className="text-xs">{t("addComment")}</span>
      </Button>
    </div>
  );
}
