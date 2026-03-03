"use client";

import { useEffect, useState } from "react";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useTranslations } from "next-intl";

function getWordCount(text: string): number {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function getReadingTime(
  wordCount: number,
  t: (key: string, values?: Record<string, string | number>) => string
): string {
  const minutes = Math.ceil(wordCount / 200);
  if (minutes < 1) return t("lessThanOneMinRead");
  return t("minRead", { minutes });
}

export function ReadingStatsBar() {
  const t = useTranslations("editor");
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
          {stats.words.toLocaleString()} {stats.words === 1 ? t("wordSingular") : t("wordPlural")}
        </span>
        <span className="text-border">&middot;</span>
        <span>
          {stats.characters.toLocaleString()} {t("characters")}
        </span>
        <span className="text-border">&middot;</span>
        <span>{getReadingTime(stats.words, t)}</span>
      </div>
    </div>
  );
}
