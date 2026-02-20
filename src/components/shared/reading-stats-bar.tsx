"use client";

import { useEffect, useMemo, useState } from "react";
import { useEditorRefStore } from "@/stores/editor-ref-store";

function getWordCount(text: string): number {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function getReadingTime(wordCount: number): string {
  const minutes = Math.ceil(wordCount / 200);
  if (minutes < 1) return "< 1 min read";
  return `${minutes} min read`;
}

export function ReadingStatsBar() {
  const editor = useEditorRefStore((s) => s.editor);
  const [docSize, setDocSize] = useState(0);

  // Listen to editor update events so we re-render when content changes
  // (needed when this component is rendered outside SharedDocumentView)
  useEffect(() => {
    if (!editor) return;
    const handler = () => setDocSize(editor.state.doc.content.size);
    handler();
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
    };
  }, [editor]);

  const stats = useMemo(() => {
    if (!editor) return { words: 0, characters: 0 };
    const text = editor.getText();
    const words = getWordCount(text);
    const characters = text.length;
    return { words, characters };
  }, [editor, docSize]);

  if (stats.words === 0) return null;

  return (
    <div className="py-1.5 text-[11px] text-muted-foreground/60">
      <div className="flex items-center gap-3">
        <span className="text-border">&middot;</span>
        <span>
          {stats.words.toLocaleString()} {stats.words === 1 ? "word" : "words"}
        </span>
        <span className="text-border">&middot;</span>
        <span>{stats.characters.toLocaleString()} characters</span>
        <span className="text-border">&middot;</span>
        <span>{getReadingTime(stats.words)}</span>
      </div>
    </div>
  );
}
