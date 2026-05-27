"use client";

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Editor } from "@tiptap/react";
import { equals, normalizeFromEditor, type Heading } from "./canonical-outline";

const OUTLINE_DEBOUNCE_MS = 200;
const EMPTY_HEADINGS: Heading[] = [];

type OutlineListener = (headings: Heading[]) => void;

/**
 * Per-editor record. Listeners (React + non-React consumers) all read the
 * same `snapshot`. The snapshot reference is preserved across recomputes
 * when the headings are structurally equal — this is what lets a warm
 * read↔edit runtime switch reuse the previous outline data even though
 * a fresh editor instance is mounted: when the new editor produces the
 * same heading list as the old one, the array identity stays stable so
 * React consumers and subscribers do not see a change.
 */
interface OutlineRecord {
  snapshot: Heading[];
  listeners: Set<OutlineListener>;
  dispose: () => void;
}

const records = new WeakMap<Editor, OutlineRecord>();

function emit(record: OutlineRecord, next: Heading[]) {
  if (equals(record.snapshot, next)) return;
  record.snapshot = next;
  for (const listener of record.listeners) {
    listener(next);
  }
}

function attach(editor: Editor): OutlineRecord {
  const existing = records.get(editor);
  if (existing) return existing;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const record: OutlineRecord = {
    snapshot: normalizeFromEditor(editor),
    listeners: new Set(),
    dispose: () => {},
  };
  records.set(editor, record);

  const recompute = () => {
    debounceTimer = null;
    emit(record, normalizeFromEditor(editor));
  };

  const scheduleRecompute = () => {
    if (debounceTimer !== null) return;
    debounceTimer = setTimeout(recompute, OUTLINE_DEBOUNCE_MS);
  };

  editor.on("update", scheduleRecompute);

  record.dispose = () => {
    editor.off("update", scheduleRecompute);
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    records.delete(editor);
  };

  return record;
}

function detachIfIdle(editor: Editor, record: OutlineRecord) {
  if (record.listeners.size > 0) return;
  record.dispose();
}

/** Latest snapshot for an editor without subscribing. */
export function getOutlineSnapshot(editor: Editor | null): Heading[] {
  if (!editor) return EMPTY_HEADINGS;
  const record = records.get(editor);
  return record ? record.snapshot : normalizeFromEditor(editor);
}

/**
 * Non-React subscription surface. Used by the inline TOC node view in
 * Wave E so it can render outline data without sitting inside the
 * sidebar's React tree. Returns an unsubscribe function.
 */
export function subscribeOutline(editor: Editor | null, listener: OutlineListener): () => void {
  if (!editor) {
    listener(EMPTY_HEADINGS);
    return () => {};
  }

  const record = attach(editor);
  record.listeners.add(listener);
  listener(record.snapshot);

  return () => {
    record.listeners.delete(listener);
    detachIfIdle(editor, record);
  };
}

interface OutlineContextValue {
  editor: Editor | null;
}

const OutlineContext = createContext<OutlineContextValue | null>(null);

export function OutlineProvider({
  editor,
  children,
}: {
  editor: Editor | null;
  children: ReactNode;
}) {
  const value = useMemo<OutlineContextValue>(() => ({ editor }), [editor]);
  return createElement(OutlineContext.Provider, { value }, children);
}

/**
 * Subscribe to the canonical outline for an editor. The hook prefers the
 * editor provided via `OutlineProvider`; when no provider is mounted, the
 * caller may pass an `editor` argument and the hook attaches directly.
 */
export function useCanonicalOutline(editor?: Editor | null): { headings: Heading[] } {
  const ctx = useContext(OutlineContext);
  const target = editor !== undefined ? editor : (ctx?.editor ?? null);

  const [headings, setHeadings] = useState<Heading[]>(() => getOutlineSnapshot(target));
  const lastEditorRef = useRef<Editor | null>(target);

  useEffect(() => {
    if (lastEditorRef.current !== target) {
      lastEditorRef.current = target;
      // Editor swap (e.g. warm read↔edit runtime switch). Run the new
      // editor's snapshot through the same equality guard the subscribe
      // path uses, so a structurally-equal outline preserves the previous
      // array reference and downstream consumers do not re-render.
      const swapSnapshot = getOutlineSnapshot(target);
      setHeadings((prev) => (equals(prev, swapSnapshot) ? prev : swapSnapshot));
    }
    return subscribeOutline(target, (next) => {
      setHeadings((prev) => (equals(prev, next) ? prev : next));
    });
  }, [target]);

  return { headings };
}
