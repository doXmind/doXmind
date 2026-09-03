import { NextIntlClientProvider } from "next-intl";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  AttachmentWorkspace,
  type AttachmentWorkspaceServices,
} from "@/components/workspace/attachment-workspace";
import en from "@/messages/en.json";
import type { FileItem } from "@/types";

const pdfFile: FileItem = {
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
    path: "Research/Spec.pdf",
    relPath: "Research/Spec.pdf",
  },
};

function renderAttachment(file: FileItem, services: AttachmentWorkspaceServices) {
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <AttachmentWorkspace file={file} services={services} />
    </NextIntlClientProvider>
  );
}

describe("AttachmentWorkspace", () => {
  it("opens an ordinary attachment as a read-only system-file surface", async () => {
    const user = userEvent.setup();
    const services: AttachmentWorkspaceServices = {
      openExternally: vi.fn().mockResolvedValue(undefined),
      reveal: vi.fn().mockResolvedValue(undefined),
    };

    renderAttachment(pdfFile, services);

    expect(await screen.findByText("PDF attachment")).toBeInTheDocument();
    expect(screen.getByText(/read-only in doXmind/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open externally" }));
    await user.click(screen.getByRole("button", { name: "Reveal in Finder" }));

    await waitFor(() => {
      expect(services.openExternally).toHaveBeenCalledWith(pdfFile);
      expect(services.reveal).toHaveBeenCalledWith(pdfFile);
    });
  });

  it("surfaces a failed system action without offering an editing path", async () => {
    const user = userEvent.setup();
    const services: AttachmentWorkspaceServices = {
      openExternally: vi.fn().mockRejectedValue(new Error("no default application")),
      reveal: vi.fn().mockResolvedValue(undefined),
    };

    renderAttachment(pdfFile, services);

    await user.click(screen.getByRole("button", { name: "Open externally" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("no default application");
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
});
