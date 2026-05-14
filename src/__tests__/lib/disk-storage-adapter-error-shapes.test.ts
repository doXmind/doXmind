import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { DiskStorageAdapter } from "@/lib/storage";
import { isReadOnlyDocumentError } from "@/lib/storage/read-only-error";

const baseHandle = {
  mode: "disk" as const,
  id: "doc-1",
  documentType: "excel" as const,
  path: "/workspace/Budget.xlsx",
  storageHandle: { kind: "disk" as const, root: "/workspace", path: "Budget.xlsx" },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("DiskStorageAdapter HTTP fallback error shapes", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockRejectedValue(new Error("tauri unavailable in tests"));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("propagates a string detail verbatim", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(400, { detail: "raw text reason" }))
    );
    const adapter = new DiskStorageAdapter({ root: "/workspace" });
    await expect(
      adapter.writeExcelEditorState(baseHandle, { version: 1, activeSheetId: "a" })
    ).rejects.toThrowError(/raw text reason/);
  });

  it("preserves the discriminator in a structured dict detail so isReadOnlyDocumentError can match", async () => {
    // This is the production wire shape that round-4 codex found broken
    // before c1c59c9: FastAPI's `raise HTTPException(409, detail={code: ..., ...})`
    // used to collapse to "[object Object]" through the adapter and hide
    // the discriminator from the read-only matcher.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(409, {
          detail: {
            code: "document_read_only",
            path: "/Users/foo/Bar.xlsx",
            recovery: "unset DOXMIND_SIDECAR_MIGRATE or set it to 1",
          },
        })
      )
    );
    const adapter = new DiskStorageAdapter({ root: "/workspace" });

    let captured: unknown;
    await adapter
      .writeExcelEditorState(baseHandle, { version: 1, activeSheetId: "a" })
      .catch((err) => {
        captured = err;
      });
    expect(captured).toBeInstanceOf(Error);
    expect(isReadOnlyDocumentError(captured)).toBe(true);
  });

  it("preserves scalar number details so the failure isn't silently dropped to the generic message", async () => {
    // Codex round-5 caught this regression vs c1c59c9: before adding the
    // scalar branch, `{detail: 42}` fell through every typeof check and
    // got dropped to "Workspace command failed: <command>".
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(400, { detail: 42 }))
    );
    const adapter = new DiskStorageAdapter({ root: "/workspace" });
    await expect(
      adapter.writeExcelEditorState(baseHandle, { version: 1, activeSheetId: "a" })
    ).rejects.toThrowError(/\b42\b/);
  });

  it("preserves scalar boolean details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(400, { detail: true }))
    );
    const adapter = new DiskStorageAdapter({ root: "/workspace" });
    await expect(
      adapter.writeExcelEditorState(baseHandle, { version: 1, activeSheetId: "a" })
    ).rejects.toThrowError(/\btrue\b/);
  });
});
