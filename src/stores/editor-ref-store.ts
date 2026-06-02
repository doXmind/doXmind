import { create } from "zustand";
import type { Editor } from "@tiptap/core";

interface EditorRefState {
  editor: Editor | null;
  setEditor: (editor: Editor | null) => void;
  // Awaitable "save the active document now", registered by the markdown
  // runtime so chrome (e.g. the header's close button) can save-then-close.
  // Resolves true when saved (or there was nothing to save), false when the
  // user cancelled the save-location picker. Null when no saveable document is
  // mounted.
  requestSave: (() => Promise<boolean>) | null;
  setRequestSave: (fn: (() => Promise<boolean>) | null) => void;
}

export const useEditorRefStore = create<EditorRefState>()((set) => ({
  editor: null,
  setEditor: (editor) => set({ editor }),
  requestSave: null,
  setRequestSave: (requestSave) => set({ requestSave }),
}));
