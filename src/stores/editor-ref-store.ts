import { create } from "zustand";

/** What one mounted Markdown runtime can be asked to do. */
export interface EditorHandles {
  // Awaitable "save this document now", so chrome (e.g. the header's close
  // button) can save-then-close. Resolves true when saved (or there was nothing
  // to save), false when the user cancelled the save-location picker.
  requestSave: () => Promise<boolean>;
  // Source-history commands. Native application menus must call these instead
  // of browser/webview undo roles, which can mutate the textarea without
  // updating canonical Markdown.
  requestUndo: () => void;
  requestRedo: () => void;
  // Fold or unfold every foldable Block, so the command palette can reach it and
  // PDF export can unfold before it prints the live DOM.
  requestFoldAll: (folded: boolean) => void;
  // Called only after the user confirms discarding the Page. The runtime uses it
  // to invalidate queued writes before its DOM unmounts.
  discardPendingChanges: () => void;
}

interface EditorRefState {
  /**
   * Every mounted runtime, by its own id.
   *
   * A registry rather than one set of callbacks: with two Pages on screen, the second to mount
   * would otherwise overwrite the first, and ⌘S, the native menu's undo and fold-all would all
   * act on whichever happened to mount last rather than on the Page being looked at.
   */
  editors: Record<string, EditorHandles>;
  /** Which registered editor the chrome is talking about. */
  activeEditorId: string | null;

  // Mirrors of the active editor's handles. Every consumer means "the editor the user is looking
  // at", so they read these and need to know nothing about the registry.
  requestSave: (() => Promise<boolean>) | null;
  requestUndo: (() => void) | null;
  requestRedo: (() => void) | null;
  requestFoldAll: ((folded: boolean) => void) | null;
  discardPendingChanges: (() => void) | null;

  registerEditor: (id: string, handles: EditorHandles) => void;
  unregisterEditor: (id: string) => void;
  setActiveEditor: (id: string | null) => void;
  /** Flush every mounted editor, for the paths that mean "before we close, save everything". */
  saveAllEditors: () => Promise<boolean>;
}

/** Recompute the mirrored handles from the registry. */
function mirror(editors: Record<string, EditorHandles>, activeEditorId: string | null) {
  // Falling back to the sole editor keeps the chrome working before anything has claimed focus,
  // which is the state every session starts in.
  const ids = Object.keys(editors);
  const id =
    (activeEditorId && editors[activeEditorId] ? activeEditorId : null) ??
    (ids.length === 1 ? ids[0] : null);
  const active = id ? editors[id] : null;
  return {
    activeEditorId: id,
    requestSave: active?.requestSave ?? null,
    requestUndo: active?.requestUndo ?? null,
    requestRedo: active?.requestRedo ?? null,
    requestFoldAll: active?.requestFoldAll ?? null,
    discardPendingChanges: active?.discardPendingChanges ?? null,
  };
}

export const useEditorRefStore = create<EditorRefState>()((set, get) => ({
  editors: {},
  activeEditorId: null,
  requestSave: null,
  requestUndo: null,
  requestRedo: null,
  requestFoldAll: null,
  discardPendingChanges: null,

  registerEditor: (id, handles) =>
    set((state) => {
      const editors = { ...state.editors, [id]: handles };
      return { editors, ...mirror(editors, state.activeEditorId ?? id) };
    }),

  unregisterEditor: (id) =>
    set((state) => {
      const { [id]: _gone, ...editors } = state.editors;
      const next = state.activeEditorId === id ? null : state.activeEditorId;
      return { editors, ...mirror(editors, next) };
    }),

  setActiveEditor: (id) => set((state) => mirror(state.editors, id)),

  saveAllEditors: async () => {
    // Sequential, not parallel: each save may open a native destination picker, and two at once
    // would stack two modal dialogs on the user.
    for (const handles of Object.values(get().editors)) {
      if (!(await handles.requestSave())) return false;
    }
    return true;
  },
}));
