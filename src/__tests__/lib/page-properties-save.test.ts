import { beforeEach, describe, expect, it, vi } from "vitest";

import { savePageProperties } from "@/lib/page-properties";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useEditorStore } from "@/stores/editor-store";
import { useFileStore } from "@/stores/file-store";
import type { FileItem } from "@/types";

const originalUpdatePageProperties = useFileStore.getState().updatePageProperties;

const page: FileItem = {
  id: "page-1",
  name: "Page.md",
  content: "Body\n",
  isFolder: false,
  parentId: null,
  position: 0,
  isFavorite: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  wordCount: 1,
  preview: "Body",
  documentType: "markdown",
};

describe("savePageProperties", () => {
  beforeEach(() => {
    useEditorRefStore.setState({ requestSave: null });
    useEditorStore.setState({ isDirty: false, isSaving: false });
    useFileStore.setState({ files: [page], currentFileId: page.id });
    useFileStore.setState({ updatePageProperties: originalUpdatePageProperties });
  });

  it("flushes the active editor before changing frontmatter", async () => {
    const order: string[] = [];
    useEditorRefStore.setState({
      requestSave: vi.fn(async () => {
        order.push("body");
        return true;
      }),
    });
    useEditorStore.setState({ isDirty: true });
    const updatePageProperties = vi.fn(async () => {
      order.push("properties");
    });
    useFileStore.setState({ updatePageProperties });

    await expect(savePageProperties(page.id, { tags: ["local"] })).resolves.toBe(true);
    expect(order).toEqual(["body", "properties"]);
  });

  it("does not touch frontmatter when the Page save is cancelled", async () => {
    useEditorRefStore.setState({ requestSave: vi.fn().mockResolvedValue(false) });
    useEditorStore.setState({ isDirty: true });
    const updatePageProperties = vi.fn();
    useFileStore.setState({ updatePageProperties });

    await expect(savePageProperties(page.id, { tags: ["local"] })).resolves.toBe(false);
    expect(updatePageProperties).not.toHaveBeenCalled();
  });

  it("keeps a clean property change metadata-only", async () => {
    const requestSave = vi.fn().mockResolvedValue(true);
    useEditorRefStore.setState({ requestSave });
    const updatePageProperties = vi.fn().mockResolvedValue(undefined);
    useFileStore.setState({ updatePageProperties });

    await expect(savePageProperties(page.id, { tags: ["local"] })).resolves.toBe(true);
    expect(requestSave).not.toHaveBeenCalled();
    expect(updatePageProperties).toHaveBeenCalledWith(page.id, { tags: ["local"] });
  });
});
