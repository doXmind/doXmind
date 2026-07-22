import { create } from "zustand";

interface Selection {
  from: number;
  to: number;
  text: string;
}

interface EditorState {
  isDirty: boolean;
  selection: Selection | null;
  isSaving: boolean;
  lastSavedAt: string | null;

  setDirty: (dirty: boolean) => void;
  setSelection: (selection: Selection | null) => void;
  setSaving: (saving: boolean) => void;
  setLastSavedAt: (date: string | null) => void;
}

export const useEditorStore = create<EditorState>()((set) => ({
  isDirty: false,
  selection: null,
  isSaving: false,
  lastSavedAt: null,

  setDirty: (dirty) => set({ isDirty: dirty }),
  setSelection: (selection) => set({ selection }),
  setSaving: (saving) => set({ isSaving: saving }),
  setLastSavedAt: (date) => set({ lastSavedAt: date }),
}));
