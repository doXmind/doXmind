import { create } from "zustand";

interface Selection {
  from: number;
  to: number;
  text: string;
}

export type PagePickerCallback = (attrs: {
  pageId: string;
  pageTitle: string;
  pageIcon: string | null;
}) => void;

export interface PagePickerAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface EditorState {
  isDirty: boolean;
  selection: Selection | null;
  isSaving: boolean;
  lastSavedAt: string | null;

  pagePickerOpen: boolean;
  pagePickerCallback: PagePickerCallback | null;
  pagePickerAnchor: PagePickerAnchor | null;

  setDirty: (dirty: boolean) => void;
  setSelection: (selection: Selection | null) => void;
  setSaving: (saving: boolean) => void;
  setLastSavedAt: (date: string | null) => void;

  openPagePicker: (callback: PagePickerCallback, anchor?: PagePickerAnchor | null) => void;
  closePagePicker: () => void;
}

export const useEditorStore = create<EditorState>()((set) => ({
  isDirty: false,
  selection: null,
  isSaving: false,
  lastSavedAt: null,

  pagePickerOpen: false,
  pagePickerCallback: null,
  pagePickerAnchor: null,

  setDirty: (dirty) => set({ isDirty: dirty }),
  setSelection: (selection) => set({ selection }),
  setSaving: (saving) => set({ isSaving: saving }),
  setLastSavedAt: (date) => set({ lastSavedAt: date }),

  openPagePicker: (callback, anchor = null) =>
    set({ pagePickerOpen: true, pagePickerCallback: callback, pagePickerAnchor: anchor }),
  closePagePicker: () =>
    set({ pagePickerOpen: false, pagePickerCallback: null, pagePickerAnchor: null }),
}));
