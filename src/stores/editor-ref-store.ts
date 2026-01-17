import { create } from "zustand";
import type { Editor } from "@tiptap/core";

interface EditorRefState {
  editor: Editor | null;
  setEditor: (editor: Editor | null) => void;
}

export const useEditorRefStore = create<EditorRefState>()((set) => ({
  editor: null,
  setEditor: (editor) => set({ editor }),
}));
