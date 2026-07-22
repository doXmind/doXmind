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
      inspect: vi.fn().mockResolvedValue({
        documentType: "pdf",
        recoveryStatus: "none",
        sidecarStatus: "missing",
        sidecarPath: ".Spec.pdf.doxmind",
      }),
      openExternally: vi.fn().mockResolvedValue(undefined),
      reveal: vi.fn().mockResolvedValue(undefined),
      exportRecovery: vi.fn().mockResolvedValue(undefined),
    };

    renderAttachment(pdfFile, services);

    expect(await screen.findByText("PDF attachment")).toBeInTheDocument();
    expect(screen.getByText(/read-only in doXmind/i)).toBeInTheDocument();
    expect(screen.queryByText(/legacy doXmind edits found/i)).not.toBeInTheDocument();
    expect(services.inspect).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Open externally" }));
    await user.click(screen.getByRole("button", { name: "Reveal in Finder" }));

    await waitFor(() => {
      expect(services.openExternally).toHaveBeenCalledWith(pdfFile);
      expect(services.reveal).toHaveBeenCalledWith(pdfFile);
    });
  });

  it("offers an explicit read-only recovery export only when legacy edits are available", async () => {
    const user = userEvent.setup();
    const services: AttachmentWorkspaceServices = {
      inspect: vi.fn().mockResolvedValue({
        documentType: "pdf",
        recoveryStatus: "available",
        sidecarStatus: "current",
        sidecarPath: ".Spec.pdf.doxmind",
      }),
      openExternally: vi.fn().mockResolvedValue(undefined),
      reveal: vi.fn().mockResolvedValue(undefined),
      exportRecovery: vi.fn().mockResolvedValue(undefined),
    };

    renderAttachment(pdfFile, services);

    expect(services.inspect).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Check legacy recovery" }));
    expect(await screen.findByText("Legacy doXmind edits found")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Export recovery report" }));
    expect(services.exportRecovery).toHaveBeenCalledWith(pdfFile);
  });
});
