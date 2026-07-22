import { create } from "zustand";

interface EditorRefState {
  // Awaitable "save the active document now", registered by the markdown
  // runtime so chrome (e.g. the header's close button) can save-then-close.
  // Resolves true when saved (or there was nothing to save), false when the
  // user cancelled the save-location picker. Null when no saveable document is
  // mounted.
  requestSave: (() => Promise<boolean>) | null;
  setRequestSave: (fn: (() => Promise<boolean>) | null) => void;
  // Source-history commands registered by the active Markdown runtime. Native
  // application menus must call these instead of browser/webview undo roles,
  // which can mutate the textarea without updating canonical Markdown.
  requestUndo: (() => void) | null;
  setRequestUndo: (fn: (() => void) | null) => void;
  requestRedo: (() => void) | null;
  setRequestRedo: (fn: (() => void) | null) => void;
  // Called only after the user confirms discarding the active Page. The
  // runtime uses it to invalidate queued writes before its DOM unmounts.
  discardPendingChanges: (() => void) | null;
  setDiscardPendingChanges: (fn: (() => void) | null) => void;
}

export const useEditorRefStore = create<EditorRefState>()((set) => ({
  requestSave: null,
  setRequestSave: (requestSave) => set({ requestSave }),
  requestUndo: null,
  setRequestUndo: (requestUndo) => set({ requestUndo }),
  requestRedo: null,
  setRequestRedo: (requestRedo) => set({ requestRedo }),
  discardPendingChanges: null,
  setDiscardPendingChanges: (discardPendingChanges) => set({ discardPendingChanges }),
}));
