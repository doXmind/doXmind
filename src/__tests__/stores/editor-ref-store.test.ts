import { beforeEach, describe, expect, it, vi } from "vitest";

import { useEditorRefStore, type EditorHandles } from "@/stores/editor-ref-store";

const handles = (fileId = "page-1"): EditorHandles => ({
  fileId,
  requestSave: vi.fn(async () => true),
  requestUndo: vi.fn(),
  requestRedo: vi.fn(),
  requestFoldAll: vi.fn(),
  discardPendingChanges: vi.fn(),
});

describe("editor registry", () => {
  beforeEach(() => {
    useEditorRefStore.setState({
      editors: {},
      activeEditorId: null,
      requestSave: null,
      requestUndo: null,
      requestRedo: null,
      requestFoldAll: null,
      discardPendingChanges: null,
    });
  });

  it("mirrors the sole editor, so the chrome works before anything claims focus", () => {
    const one = handles();
    useEditorRefStore.getState().registerEditor("a", one);

    useEditorRefStore.getState().requestUndo?.();
    expect(one.requestUndo).toHaveBeenCalledOnce();
  });

  it("keeps a second editor from overwriting the first", () => {
    const a = handles();
    const b = handles();
    const store = useEditorRefStore.getState();
    store.registerEditor("a", a);
    store.registerEditor("b", b);

    // The chrome still talks to `a`: it was active first, and mounting a second Page beside it
    // is not the user choosing it.
    useEditorRefStore.getState().requestUndo?.();
    expect(a.requestUndo).toHaveBeenCalledOnce();
    expect(b.requestUndo).not.toHaveBeenCalled();

    useEditorRefStore.getState().setActiveEditor("b");
    useEditorRefStore.getState().requestUndo?.();
    expect(b.requestUndo).toHaveBeenCalledOnce();
    expect(a.requestUndo).toHaveBeenCalledOnce();
  });

  it("falls back to the survivor when the active editor unmounts", () => {
    const a = handles();
    const b = handles();
    const store = useEditorRefStore.getState();
    store.registerEditor("a", a);
    store.registerEditor("b", b);
    useEditorRefStore.getState().setActiveEditor("b");

    useEditorRefStore.getState().unregisterEditor("b");

    useEditorRefStore.getState().requestUndo?.();
    expect(a.requestUndo).toHaveBeenCalledOnce();
  });

  it("leaves the chrome inert when the last editor unmounts", () => {
    useEditorRefStore.getState().registerEditor("a", handles());
    useEditorRefStore.getState().unregisterEditor("a");

    expect(useEditorRefStore.getState().requestSave).toBeNull();
    expect(useEditorRefStore.getState().requestFoldAll).toBeNull();
  });

  it("saves every editor before closing, one at a time", async () => {
    const order: string[] = [];
    const a = {
      ...handles(),
      requestSave: vi.fn(async () => {
        order.push("a");
        return true;
      }),
    };
    const b = {
      ...handles(),
      requestSave: vi.fn(async () => {
        order.push("b");
        return true;
      }),
    };
    useEditorRefStore.getState().registerEditor("a", a);
    useEditorRefStore.getState().registerEditor("b", b);

    await expect(useEditorRefStore.getState().saveAllEditors()).resolves.toBe(true);
    // Sequential: two at once would stack two native destination pickers on the user.
    expect(order).toEqual(["a", "b"]);
  });

  it("stops at the first editor whose save the user cancelled", async () => {
    const a = { ...handles(), requestSave: vi.fn(async () => false) };
    const b = handles();
    useEditorRefStore.getState().registerEditor("a", a);
    useEditorRefStore.getState().registerEditor("b", b);

    await expect(useEditorRefStore.getState().saveAllEditors()).resolves.toBe(false);
    expect(b.requestSave).not.toHaveBeenCalled();
  });
});

describe("requestSaveFor", () => {
  beforeEach(() => {
    useEditorRefStore.setState({ editors: {}, activeEditorId: null });
  });

  it("flushes the editor showing that Page, whichever pane it is in", async () => {
    const a = handles("page-a");
    const b = handles("page-b");
    useEditorRefStore.getState().registerEditor("a", a);
    useEditorRefStore.getState().registerEditor("b", b);

    await useEditorRefStore.getState().requestSaveFor("page-b");

    expect(b.requestSave).toHaveBeenCalledOnce();
    expect(a.requestSave).not.toHaveBeenCalled();
  });

  it("resolves true when the Page is not open, because nothing is unsaved", async () => {
    useEditorRefStore.getState().registerEditor("a", handles("page-a"));
    await expect(useEditorRefStore.getState().requestSaveFor("elsewhere")).resolves.toBe(true);
  });
});
