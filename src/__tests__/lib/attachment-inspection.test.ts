import { describe, expect, it, vi } from "vitest";
import { DiskStorageAdapter } from "@/lib/storage/disk-storage-adapter";
import type { DocumentHandle } from "@/lib/storage/types";

describe("attachment inspection", () => {
  it("uses the read-only per-attachment command", async () => {
    const inspection = {
      documentType: "pdf" as const,
      recoveryStatus: "available" as const,
      sidecarStatus: "legacy" as const,
      sidecarPath: ".Spec.pdf.doxmind",
      recoverySources: [
        {
          source: "sidecar" as const,
          recoveryStatus: "available" as const,
          sidecarStatus: "legacy" as const,
        },
      ],
      recommendedSource: "sidecar" as const,
    };
    const invoke = vi.fn().mockResolvedValue(inspection);
    const adapter = new DiskStorageAdapter({ root: "/workspace", invoke });
    const handle: DocumentHandle = {
      mode: "disk",
      id: "path:spec",
      kind: "document",
      documentType: "pdf",
      path: "Research/Spec.pdf",
      relPath: "Research/Spec.pdf",
    };

    await expect(adapter.inspectAttachment(handle)).resolves.toEqual(inspection);
    expect(invoke).toHaveBeenCalledWith("workspace_inspect_attachment", {
      root: "/workspace",
      path: "Research/Spec.pdf",
    });
  });

  it("reads the exact legacy recovery payload without using an attachment editor reader", async () => {
    const recovery = {
      editor: { version: 1 as const, edits: { "p0-t0": { text: "Recovered" } } },
    };
    const invoke = vi.fn().mockResolvedValue(recovery);
    const adapter = new DiskStorageAdapter({ root: "/workspace", invoke });
    const handle: DocumentHandle = {
      mode: "disk",
      id: "path:spec",
      kind: "document",
      documentType: "pdf",
      path: "Research/Spec.pdf",
      relPath: "Research/Spec.pdf",
    };

    await expect(adapter.readAttachmentRecovery(handle)).resolves.toEqual(recovery);
    expect(invoke).toHaveBeenCalledWith("workspace_read_attachment_recovery", {
      root: "/workspace",
      path: "Research/Spec.pdf",
    });
    expect(invoke.mock.calls.flat().join(" ")).not.toMatch(
      /workspace_(?:read|write)_(?:pdf|excel)/
    );
  });

  it("keeps attachments out of the Page read contract", async () => {
    const invoke = vi.fn();
    const adapter = new DiskStorageAdapter({ root: "/workspace", invoke });
    const handle: DocumentHandle = {
      mode: "disk",
      id: "path:reference",
      kind: "document",
      documentType: "html",
      path: "reference.html",
      relPath: "reference.html",
    };

    await expect(adapter.read(handle)).rejects.toThrow(
      "Page read supports Markdown only; use attachment inspection instead"
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps attachments out of the Page write contract", async () => {
    const invoke = vi.fn();
    const adapter = new DiskStorageAdapter({ root: "/workspace", invoke });
    const handle: DocumentHandle = {
      mode: "disk",
      id: "path:reference",
      kind: "document",
      documentType: "html",
      path: "reference.html",
      relPath: "reference.html",
    };

    await expect(adapter.write(handle, { markdown: "changed" })).rejects.toThrow(
      "Page write supports Markdown only; open attachments externally instead"
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});
