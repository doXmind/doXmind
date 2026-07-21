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

const SOURCE_HASH = "a".repeat(64);

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

function pdfRecoveryServices(
  exportPdf: AttachmentWorkspaceServices["exportPdf"]
): AttachmentWorkspaceServices {
  return {
    inspect: vi.fn().mockResolvedValue({
      documentType: "pdf",
      recoveryStatus: "available",
      sidecarStatus: "current",
      sidecarPath: ".Spec.pdf.doxmind",
      recoverySources: [
        { source: "sidecar", recoveryStatus: "available", sidecarStatus: "current" },
      ],
      recommendedSource: "sidecar",
    }),
    readRecovery: vi.fn().mockResolvedValue({
      documentType: "pdf",
      source: "sidecar",
      sidecarStatus: "current",
      sourceHash: SOURCE_HASH,
      editorState: { version: 1 },
    }),
    readBinary: vi.fn().mockResolvedValue(new Uint8Array([1])),
    exportPdf,
    exportExcel: vi.fn(),
    hashBinary: vi.fn().mockResolvedValue(SOURCE_HASH),
    download: vi.fn(),
    openExternally: vi.fn().mockResolvedValue(undefined),
    reveal: vi.fn().mockResolvedValue(undefined),
  };
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
        recoverySources: [
          {
            source: "sidecar",
            recoveryStatus: "none",
            sidecarStatus: "missing",
          },
          {
            source: "backup",
            recoveryStatus: "none",
            sidecarStatus: "missing",
          },
        ],
        recommendedSource: null,
      }),
      readRecovery: vi.fn(),
      readBinary: vi.fn(),
      exportPdf: vi.fn(),
      exportExcel: vi.fn(),
      download: vi.fn(),
      openExternally: vi.fn().mockResolvedValue(undefined),
      reveal: vi.fn().mockResolvedValue(undefined),
    };

    renderAttachment(pdfFile, services);

    expect(await screen.findByText("PDF attachment")).toBeInTheDocument();
    expect(screen.getByText(/read-only in doXmind/i)).toBeInTheDocument();
    expect(screen.queryByText(/legacy recovery evidence found/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open externally" }));
    await user.click(screen.getByRole("button", { name: "Reveal in Finder" }));

    await waitFor(() => {
      expect(services.openExternally).toHaveBeenCalledWith(pdfFile);
      expect(services.reveal).toHaveBeenCalledWith(pdfFile);
    });
    expect(services.readRecovery).not.toHaveBeenCalled();
    expect(services.readBinary).not.toHaveBeenCalled();
  });

  it("shows manual recovery guidance when any legacy candidate is unknown", async () => {
    const services = pdfRecoveryServices(vi.fn().mockResolvedValue(new Uint8Array([2])));
    services.inspect = vi.fn().mockResolvedValue({
      documentType: "pdf",
      recoveryStatus: "available",
      sidecarStatus: "current",
      sidecarPath: ".Spec.pdf.doxmind",
      recoverySources: [
        { source: "sidecar", recoveryStatus: "available", sidecarStatus: "current" },
        { source: "backup", recoveryStatus: "unknown", sidecarStatus: "unreadable" },
      ],
      recommendedSource: "sidecar",
    });

    renderAttachment(pdfFile, services);

    expect(await screen.findByText("Recovery status needs attention")).toBeInTheDocument();
    expect(
      screen.getByText(/keep the source, main sidecar, backup, and lock file/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Attempt PDF recovery" })).toBeInTheDocument();
  });

  it("exports the recommended recovery source without mounting a legacy editor", async () => {
    const user = userEvent.setup();
    const services: AttachmentWorkspaceServices = {
      inspect: vi.fn().mockResolvedValue({
        documentType: "pdf",
        recoveryStatus: "available",
        sidecarStatus: "current",
        sidecarPath: ".Spec.pdf.doxmind",
        recoverySources: [
          {
            source: "backup",
            recoveryStatus: "available",
            sidecarStatus: "legacy",
          },
        ],
        recommendedSource: "backup",
      }),
      readRecovery: vi.fn().mockResolvedValue({
        documentType: "pdf",
        source: "backup",
        sidecarStatus: "legacy",
        sourceHash: SOURCE_HASH,
        editorState: { version: 1, edits: { "p0-t0": { text: "Recovered" } } },
      }),
      readBinary: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      exportPdf: vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6])),
      exportExcel: vi.fn(),
      hashBinary: vi.fn().mockResolvedValue(SOURCE_HASH),
      download: vi.fn(),
      openExternally: vi.fn().mockResolvedValue(undefined),
      reveal: vi.fn().mockResolvedValue(undefined),
    };

    renderAttachment(pdfFile, services);

    expect(await screen.findByText("Legacy recovery evidence found")).toBeInTheDocument();
    expect(screen.getByText(/did not bind edits to one exact file version/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Attempt PDF recovery" }));

    await waitFor(() => {
      expect(services.readRecovery).toHaveBeenCalledWith(pdfFile, "backup");
      expect(services.readBinary).toHaveBeenCalledWith(pdfFile);
      expect(services.exportPdf).toHaveBeenCalledWith(
        new Uint8Array([1, 2, 3]),
        expect.objectContaining({ version: 1 })
      );
      expect(services.download).toHaveBeenCalledWith(
        new Uint8Array([4, 5, 6]),
        "Spec recovered.pdf",
        "application/pdf"
      );
    });
  });

  it("requires an explicit source choice when both the main sidecar and backup are recoverable", async () => {
    const user = userEvent.setup();
    const services: AttachmentWorkspaceServices = {
      inspect: vi.fn().mockResolvedValue({
        documentType: "pdf",
        recoveryStatus: "available",
        sidecarStatus: "current",
        sidecarPath: ".Spec.pdf.doxmind",
        recoverySources: [
          { source: "sidecar", recoveryStatus: "available", sidecarStatus: "current" },
          { source: "backup", recoveryStatus: "available", sidecarStatus: "legacy" },
        ],
        recommendedSource: null,
      }),
      readRecovery: vi.fn().mockResolvedValue({
        documentType: "pdf",
        source: "backup",
        sidecarStatus: "legacy",
        sourceHash: SOURCE_HASH,
        editorState: { version: 1 },
      }),
      readBinary: vi.fn().mockResolvedValue(new Uint8Array([1])),
      exportPdf: vi.fn().mockResolvedValue(new Uint8Array([2])),
      exportExcel: vi.fn(),
      hashBinary: vi.fn().mockResolvedValue(SOURCE_HASH),
      download: vi.fn(),
      openExternally: vi.fn().mockResolvedValue(undefined),
      reveal: vi.fn().mockResolvedValue(undefined),
    };

    renderAttachment(pdfFile, services);

    expect(await screen.findByText(/choose which one to try/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Attempt PDF recovery" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Attempt main sidecar" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Attempt backup" }));

    await waitFor(() => {
      expect(services.readRecovery).toHaveBeenCalledWith(pdfFile, "backup");
    });
  });

  it("fails closed when a two-source inspection has no valid recommendation", async () => {
    const user = userEvent.setup();
    const services = pdfRecoveryServices(vi.fn().mockResolvedValue(new Uint8Array([2])));
    services.inspect = vi.fn().mockResolvedValue({
      documentType: "pdf",
      recoveryStatus: "available",
      sidecarStatus: "current",
      sidecarPath: ".Spec.pdf.doxmind",
      recoverySources: [
        { source: "sidecar", recoveryStatus: "available", sidecarStatus: "current" },
        { source: "backup", recoveryStatus: "available", sidecarStatus: "legacy" },
      ],
      recommendedSource: undefined as unknown as null,
    });

    renderAttachment(pdfFile, services);

    expect(await screen.findByText(/choose which one to try/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Attempt PDF recovery" })).not.toBeInTheDocument();
    expect(services.readRecovery).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Attempt main sidecar" }));
    await waitFor(() => expect(services.readRecovery).toHaveBeenCalledWith(pdfFile, "sidecar"));
  });

  it("uses the recommended source directly when both candidates contain the same recovery", async () => {
    const user = userEvent.setup();
    const services: AttachmentWorkspaceServices = {
      inspect: vi.fn().mockResolvedValue({
        documentType: "pdf",
        recoveryStatus: "available",
        sidecarStatus: "current",
        sidecarPath: ".Spec.pdf.doxmind",
        recoverySources: [
          { source: "sidecar", recoveryStatus: "available", sidecarStatus: "current" },
          { source: "backup", recoveryStatus: "available", sidecarStatus: "legacy" },
        ],
        recommendedSource: "sidecar",
      }),
      readRecovery: vi.fn().mockResolvedValue({
        documentType: "pdf",
        source: "sidecar",
        sidecarStatus: "current",
        sourceHash: SOURCE_HASH,
        editorState: { version: 1 },
      }),
      readBinary: vi.fn().mockResolvedValue(new Uint8Array([1])),
      exportPdf: vi.fn().mockResolvedValue(new Uint8Array([2])),
      exportExcel: vi.fn(),
      hashBinary: vi.fn().mockResolvedValue(SOURCE_HASH),
      download: vi.fn(),
      openExternally: vi.fn().mockResolvedValue(undefined),
      reveal: vi.fn().mockResolvedValue(undefined),
    };

    renderAttachment(pdfFile, services);

    await screen.findByText("Legacy recovery evidence found");
    expect(screen.queryByText(/choose which copy/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Attempt PDF recovery" }));

    await waitFor(() => {
      expect(services.readRecovery).toHaveBeenCalledWith(pdfFile, "sidecar");
    });
  });

  it("shows recovery export progress and completion", async () => {
    const user = userEvent.setup();
    let finishExport!: (bytes: Uint8Array) => void;
    const services = pdfRecoveryServices(
      vi.fn(
        () =>
          new Promise<Uint8Array>((resolve) => {
            finishExport = resolve;
          })
      )
    );
    renderAttachment(pdfFile, services);

    const button = await screen.findByRole("button", { name: "Attempt PDF recovery" });
    await user.click(button);
    await waitFor(() => expect(button).toBeDisabled());

    finishExport(new Uint8Array([2]));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Unverified recovery copy downloaded"
    );
    expect(button).toBeEnabled();
  });

  it("surfaces strict export errors and never downloads a partial recovery", async () => {
    const user = userEvent.setup();
    const services = pdfRecoveryServices(
      vi.fn().mockRejectedValue(new Error("Strict recovery export failed"))
    );
    renderAttachment(pdfFile, services);

    const button = await screen.findByRole("button", { name: "Attempt PDF recovery" });
    await user.click(button);

    expect(await screen.findByRole("alert")).toHaveTextContent("Strict recovery export failed");
    expect(services.download).not.toHaveBeenCalled();
    expect(button).toBeEnabled();
  });

  it.each([
    ["csv", false],
    ["xlsm", true],
  ])("exports a %s recovery as .xlsx", async (extension, expectsMacroWarning) => {
    const user = userEvent.setup();
    const file: FileItem = {
      ...pdfFile,
      id: `path:budget.${extension}`,
      name: "Budget",
      documentType: "excel",
      storageHandle: {
        ...pdfFile.storageHandle!,
        id: `path:budget.${extension}`,
        documentType: "excel",
        path: `Finance/Budget.${extension}`,
        relPath: `Finance/Budget.${extension}`,
      },
    };
    const exported = new Blob(["xlsx"]);
    const services: AttachmentWorkspaceServices = {
      inspect: vi.fn().mockResolvedValue({
        documentType: "excel",
        recoveryStatus: "available",
        sidecarStatus: "current",
        sidecarPath: `.Budget.${extension}.doxmind`,
        recoverySources: [
          { source: "sidecar", recoveryStatus: "available", sidecarStatus: "current" },
        ],
        recommendedSource: "sidecar",
      }),
      readRecovery: vi.fn().mockResolvedValue({
        documentType: "excel",
        source: "sidecar",
        sidecarStatus: "current",
        sourceHash: SOURCE_HASH,
        editorState: { version: 1, cells: { "sheet-0!0,0": { value: "Recovered" } } },
      }),
      readBinary: vi.fn().mockResolvedValue(new Uint8Array([1])),
      exportPdf: vi.fn(),
      exportExcel: vi.fn().mockResolvedValue(exported),
      hashBinary: vi.fn().mockResolvedValue(SOURCE_HASH),
      download: vi.fn(),
      openExternally: vi.fn().mockResolvedValue(undefined),
      reveal: vi.fn().mockResolvedValue(undefined),
    };

    renderAttachment(file, services);

    await screen.findByText("Legacy recovery evidence found");
    if (expectsMacroWarning) {
      expect(screen.getByText(/does not include XLSM macros/i)).toBeInTheDocument();
    } else {
      expect(screen.queryByText(/does not include XLSM macros/i)).not.toBeInTheDocument();
    }
    await user.click(screen.getByRole("button", { name: "Attempt spreadsheet recovery" }));

    await waitFor(() => {
      expect(services.exportExcel).toHaveBeenCalledWith(
        new Uint8Array([1]),
        expect.objectContaining({ version: 1 }),
        `Budget.${extension}`
      );
      expect(services.download).toHaveBeenCalledWith(
        exported,
        "Budget recovered.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
    });
  });

  it("refuses recovery when current bytes mismatch the historical cache hash", async () => {
    const user = userEvent.setup();
    const services = pdfRecoveryServices(vi.fn().mockResolvedValue(new Uint8Array([2])));
    services.hashBinary = vi.fn().mockResolvedValue("b".repeat(64));
    renderAttachment(pdfFile, services);

    await user.click(await screen.findByRole("button", { name: "Attempt PDF recovery" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The attachment does not match the recovery cache"
    );
    expect(services.exportPdf).not.toHaveBeenCalled();
    expect(services.download).not.toHaveBeenCalled();
  });
});
