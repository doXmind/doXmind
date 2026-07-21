import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { UnifiedHeader } from "@/components/editor/unified-header";
import en from "@/messages/en.json";
import { useFileStore } from "@/stores/file-store";
import { useEditorStore } from "@/stores/editor-store";
import type { FileItem } from "@/types";

const attachment: FileItem = {
  id: "path:spec",
  name: "Spec",
  content: "",
  isFolder: false,
  parentId: null,
  position: 0,
  isFavorite: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  wordCount: 0,
  preview: "",
  documentType: "pdf",
  storageHandle: {
    mode: "disk",
    id: "path:spec",
    kind: "document",
    documentType: "pdf",
    path: "Spec.pdf",
    relPath: "Spec.pdf",
  },
};

describe("UnifiedHeader attachment boundary", () => {
  beforeEach(() => {
    useFileStore.setState({
      files: [attachment],
      currentFileId: attachment.id,
      openTabIds: [attachment.id],
      openTarget: "folder",
      rootPath: "/workspace",
    });
    useEditorStore.setState({ isDirty: false, isSaving: false });
  });

  it("does not offer Page save, export, or find actions for attachments", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <UnifiedHeader />
      </NextIntlClientProvider>
    );

    expect(screen.queryByLabelText("More actions")).not.toBeInTheDocument();
  });

  it("does not apply stale Page dirty state when closing an attachment", async () => {
    const user = userEvent.setup();
    useEditorStore.setState({ isDirty: true });
    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <UnifiedHeader />
      </NextIntlClientProvider>
    );

    await user.click(screen.getByLabelText("Close"));

    expect(useFileStore.getState().currentFileId).toBeNull();
  });
});
