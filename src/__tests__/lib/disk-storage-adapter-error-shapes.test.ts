import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

import { DiskStorageAdapter } from "@/lib/storage";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("DiskStorageAdapter HTTP fallback error shapes", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockRejectedValue(new Error("desktop unavailable in tests"));
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
    await expect(adapter.readAsset("assets/diagram.png")).rejects.toThrowError(/raw text reason/);
  });

  it("preserves structured error details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(409, {
          detail: {
            code: "asset_outside_workspace",
            path: "/Users/foo/diagram.png",
            recovery: "keep Markdown image sources inside the workspace",
          },
        })
      )
    );
    const adapter = new DiskStorageAdapter({ root: "/workspace" });

    await expect(adapter.readAsset("assets/diagram.png")).rejects.toThrowError(
      /asset_outside_workspace/
    );
  });

  it("preserves scalar number details so the failure isn't silently dropped to the generic message", async () => {
    // Codex round-5 caught this regression vs c1c59c9: before adding the
    // scalar branch, `{detail: 42}` fell through every typeof check and
    // got dropped to "Workspace command failed: <command>".
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { detail: 42 })));
    const adapter = new DiskStorageAdapter({ root: "/workspace" });
    await expect(adapter.readAsset("assets/diagram.png")).rejects.toThrowError(/\b42\b/);
  });

  it("preserves scalar boolean details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { detail: true })));
    const adapter = new DiskStorageAdapter({ root: "/workspace" });
    await expect(adapter.readAsset("assets/diagram.png")).rejects.toThrowError(/\btrue\b/);
  });

  it("never replaces a native command error with an HTTP fallback error", async () => {
    const conflict = new Error(
      "page_revision_conflict: expected sha256:old, actual sha256:new for Page.md"
    );
    invokeMock.mockRejectedValueOnce(conflict);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new DiskStorageAdapter({ root: "/workspace", invoke: invokeMock });

    await expect(
      adapter.write(
        {
          mode: "disk",
          id: "page-1",
          kind: "document",
          documentType: "markdown",
          path: "Page.md",
        },
        { markdown: "local edit", expectedRevision: "sha256:old" }
      )
    ).rejects.toBe(conflict);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("DiskStorageAdapter primary creation boundary", () => {
  it("rejects callers using the removed binary document contract", async () => {
    const directInvoke = vi.fn();
    const adapter = new DiskStorageAdapter({ root: "/workspace", invoke: directInvoke });

    await expect(
      adapter.create({
        name: "Blank.pdf",
        kind: "document",
        documentType: "pdf",
        binary: new Uint8Array([1]),
      } as never)
    ).rejects.toThrow("Workspace creation supports Markdown pages only");

    expect(directInvoke).not.toHaveBeenCalled();
  });

  it.each(["Spec.pdf", "Forecast.xlsx", "Data.csv"])(
    "rejects attachment replace before invoking the backend for %s",
    async (name) => {
      const directInvoke = vi.fn();
      const adapter = new DiskStorageAdapter({ root: "/workspace", invoke: directInvoke });

      await expect(
        adapter.importExternal({
          name,
          parent: null,
          bytes: new Uint8Array([1, 2, 3]),
          mode: "replace",
        })
      ).rejects.toMatchObject({ code: "replace-not-allowed" });

      expect(directInvoke).not.toHaveBeenCalled();
    }
  );
});
