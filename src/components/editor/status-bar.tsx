"use client";

import { useMemo } from "react";
import { type Editor } from "@tiptap/react";
import { Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEditorStore } from "@/stores/editor-store";

interface StatusBarProps {
  editor: Editor;
}

function getWordCount(text: string): number {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

export function StatusBar({ editor }: StatusBarProps) {
  const t = useTranslations("editor");
  const { isDirty, isSaving, lastSavedAt } = useEditorStore();

  const getReadingTime = (wordCount: number): string => {
    const minutes = Math.ceil(wordCount / 200);
    if (minutes < 1) return t("lessThanOneMinRead");
    return t("minRead", { minutes });
  };

  const stats = useMemo(() => {
    // One newline per block boundary: getText()'s default separator is "\n\n",
    // which bills every boundary as two characters the document does not have.
    const text = editor.getText({ blockSeparator: "\n" });
    const words = getWordCount(text);
    const characters = text.length;
    return { words, characters };
    // Keyed on the doc node, not its size — replacing a character or toggling a
    // mark leaves the size identical and would otherwise freeze the counts.
    // A selection-only transaction reuses the same doc, so this stays cheap.
  }, [editor, editor.state.doc]);

  const saveStatus = useMemo(() => {
    if (isSaving) return "saving";
    if (isDirty) return "unsaved";
    if (lastSavedAt) return "saved";
    return "idle";
  }, [isSaving, isDirty, lastSavedAt]);

  return (
    <div className="text-ui-xs py-1.5 text-muted-foreground/60">
      <div className="editor-content-frame flex items-center gap-3">
        {/* Save status */}
        {saveStatus === "saving" && (
          <span className="flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t("saving")}
          </span>
        )}
        {saveStatus === "saved" && (
          <span className="flex items-center gap-1 transition-opacity">
            <Check className="h-3 w-3 text-green-600 dark:text-green-500" />
            {t("saved")}
          </span>
        )}
        {saveStatus === "unsaved" && (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            {t("unsavedChanges")}
          </span>
        )}

        <span className="text-border">·</span>
        <span>
          {stats.words.toLocaleString()} {stats.words === 1 ? t("wordSingular") : t("wordPlural")}
        </span>
        <span className="text-border">·</span>
        <span>
          {stats.characters.toLocaleString()} {t("characters")}
        </span>
        <span className="text-border">·</span>
        <span>{getReadingTime(stats.words)}</span>
      </div>
    </div>
  );
}
