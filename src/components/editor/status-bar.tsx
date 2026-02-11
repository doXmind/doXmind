"use client";

import { useMemo } from "react";
import { type Editor } from "@tiptap/react";
import { Check, Loader2 } from "lucide-react";
import { useEditorStore } from "@/stores/editor-store";
import { cn } from "@/lib/utils";

interface StatusBarProps {
  editor: Editor;
}

function getWordCount(text: string): number {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function getReadingTime(wordCount: number): string {
  const minutes = Math.ceil(wordCount / 200);
  if (minutes < 1) return "< 1 min read";
  return `${minutes} min read`;
}

export function StatusBar({ editor }: StatusBarProps) {
  const { isDirty, isSaving, lastSavedAt } = useEditorStore();

  const stats = useMemo(() => {
    const text = editor.getText();
    const words = getWordCount(text);
    const characters = text.length;
    return { words, characters };
  }, [editor.state.doc.content.size]);

  const saveStatus = useMemo(() => {
    if (isSaving) return "saving";
    if (isDirty) return "unsaved";
    if (lastSavedAt) return "saved";
    return "idle";
  }, [isSaving, isDirty, lastSavedAt]);

  return (
    <div className="flex items-center justify-between border-t border-border/50 px-4 py-1 text-[11px] text-muted-foreground/70 md:px-8">
      {/* Left: Word count stats */}
      <div className="flex items-center gap-3">
        <span>
          {stats.words.toLocaleString()} {stats.words === 1 ? "word" : "words"}
        </span>
        <span className="text-border">·</span>
        <span>{stats.characters.toLocaleString()} characters</span>
        <span className="text-border">·</span>
        <span>{getReadingTime(stats.words)}</span>
      </div>

      {/* Right: Save status */}
      <div className="flex items-center gap-1.5">
        {saveStatus === "saving" && (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Saving...</span>
          </>
        )}
        {saveStatus === "saved" && (
          <span className={cn("flex items-center gap-1 transition-opacity")}>
            <Check className="h-3 w-3 text-green-600 dark:text-green-500" />
            Saved
          </span>
        )}
        {saveStatus === "unsaved" && (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Unsaved changes
          </span>
        )}
      </div>
    </div>
  );
}
