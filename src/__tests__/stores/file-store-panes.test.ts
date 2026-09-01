import { beforeEach, describe, expect, it } from "vitest";

import { useFileStore } from "@/stores/file-store";

const page = (id: string) => ({
  id,
  name: `${id}.md`,
  content: "",
  isFolder: false,
  parentId: null,
  position: 0,
  isFavorite: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  wordCount: 0,
  preview: "",
  documentType: "markdown" as const,
});

const state = () => useFileStore.getState();

describe("split panes", () => {
  beforeEach(() => {
    useFileStore.setState({
      files: [page("a"), page("b"), page("c")] as never,
      openTabIds: ["a", "b", "c"],
      currentFileId: "a",
      otherPaneFileId: null,
      otherPaneOnLeft: false,
    });
  });

  it("opens the next tab beside the active Page, never a second copy of it", () => {
    state().splitRight();

    // Two runtimes over one file are two documents sharing one guarded write and one cached
    // content, so the same Page must never be in both panes.
    expect(state().currentFileId).toBe("a");
    expect(state().otherPaneFileId).toBe("b");
  });

  it("leaves the other pane empty when there is nothing else open", () => {
    useFileStore.setState({ openTabIds: ["a"], currentFileId: "a" });
    state().splitRight();
    expect(state().otherPaneFileId).toBeNull();
  });

  it("does nothing when already split", () => {
    state().splitRight();
    state().splitRight();
    expect(state().otherPaneFileId).toBe("b");
  });

  it("swaps focus without moving the panes on screen", () => {
    state().splitRight();
    const sideBefore = state().otherPaneOnLeft;

    state().focusOtherPane();

    expect(state().currentFileId).toBe("b");
    expect(state().otherPaneFileId).toBe("a");
    // The side flips with the swap, so the Page the user was reading stays where it was drawn.
    expect(state().otherPaneOnLeft).toBe(!sideBefore);
  });

  it("focuses the other pane instead of opening a Page twice", () => {
    state().splitRight();
    expect(state().otherPaneFileId).toBe("b");

    state().setCurrentFile("b");

    expect(state().currentFileId).toBe("b");
    expect(state().otherPaneFileId).toBe("a");
  });

  it("closes the split when the Page it holds is closed", () => {
    state().splitRight();
    state().closeTab("b");

    expect(state().otherPaneFileId).toBeNull();
    expect(state().openTabIds).toEqual(["a", "c"]);
  });

  it("never leaves both panes on one Page after a close falls through", () => {
    useFileStore.setState({ openTabIds: ["a", "b"], currentFileId: "a", otherPaneFileId: "b" });

    // Closing the active tab lands `currentFileId` on `b`, which the other pane already holds.
    state().closeTab("a");

    expect(state().currentFileId).toBe("b");
    expect(state().otherPaneFileId).toBeNull();
  });

  it("collapses the split when the tabs around it are closed", () => {
    state().splitRight();
    state().closeOtherTabs("a");
    expect(state().otherPaneFileId).toBeNull();

    state().splitRight();
    state().closeAllTabs();
    expect(state().otherPaneFileId).toBeNull();
  });

  // The scan-level prune (a Page the rescan no longer sees) is exercised in
  // file-store.test.ts, where the workspace scan is mocked.
});
