"use client";

import { useEffect, useState } from "react";
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
  const [stats, setStats] = useState({ words: 0, characters: 0 });

  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      const text = editor.getText();
      setStats({ words: getWordCount(text), characters: text.length });
    };
    handler();
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
    };
  }, [editor]);

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
