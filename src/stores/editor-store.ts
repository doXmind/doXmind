import { create } from "zustand";

interface Selection {
  from: number;
  to: number;
  text: string;
}

export type ImageModalCallback = (url: string, alt?: string) => void;

export type BookmarkModalCallback = (attrs: {
  url: string;
  title: string;
  description: string | null;
  faviconUrl: string | null;
  imageUrl: string | null;
}) => void;

export type PagePickerCallback = (attrs: {
  pageId: string;
  pageTitle: string;
  pageIcon: string | null;
}) => void;

interface EditorState {
  isDirty: boolean;
  selection: Selection | null;
  isSaving: boolean;
  lastSavedAt: string | null;

  imageModalOpen: boolean;
  imageModalCallback: ImageModalCallback | null;

  bookmarkModalOpen: boolean;
  bookmarkModalCallback: BookmarkModalCallback | null;

  pagePickerOpen: boolean;
  pagePickerCallback: PagePickerCallback | null;

  setDirty: (dirty: boolean) => void;
  setSelection: (selection: Selection | null) => void;
  setSaving: (saving: boolean) => void;
  setLastSavedAt: (date: string | null) => void;

  openImageModal: (callback: ImageModalCallback) => void;
  closeImageModal: () => void;

  openBookmarkModal: (callback: BookmarkModalCallback) => void;
  closeBookmarkModal: () => void;

  openPagePicker: (callback: PagePickerCallback) => void;
  closePagePicker: () => void;
}

export const useEditorStore = create<EditorState>()((set) => ({
  isDirty: false,
  selection: null,
  isSaving: false,
  lastSavedAt: null,

  imageModalOpen: false,
  imageModalCallback: null,

  bookmarkModalOpen: false,
  bookmarkModalCallback: null,

  pagePickerOpen: false,
  pagePickerCallback: null,

  setDirty: (dirty) => set({ isDirty: dirty }),
  setSelection: (selection) => set({ selection }),
  setSaving: (saving) => set({ isSaving: saving }),
  setLastSavedAt: (date) => set({ lastSavedAt: date }),

  openImageModal: (callback) => set({ imageModalOpen: true, imageModalCallback: callback }),
  closeImageModal: () => set({ imageModalOpen: false, imageModalCallback: null }),

  openBookmarkModal: (callback) =>
    set({ bookmarkModalOpen: true, bookmarkModalCallback: callback }),
  closeBookmarkModal: () => set({ bookmarkModalOpen: false, bookmarkModalCallback: null }),

  openPagePicker: (callback) => set({ pagePickerOpen: true, pagePickerCallback: callback }),
  closePagePicker: () => set({ pagePickerOpen: false, pagePickerCallback: null }),
}));
