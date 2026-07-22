import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { DiskStorageAdapter, type DesktopInvoker } from "@/lib/storage/disk-storage-adapter";
import type { DesktopBridge } from "@/lib/native-shell";
import type { DocumentContent, StorageWriteInput } from "@/lib/storage";
import type { FileItem } from "@/types";

describe("DiskStorageAdapter Markdown-only Page writes", () => {
  it("exposes no HTML or extras fields on the Page write contract", () => {
    expectTypeOf<StorageWriteInput>().not.toHaveProperty("html");
    expectTypeOf<StorageWriteInput>().not.toHaveProperty("extras");
    expectTypeOf<DocumentContent>().not.toHaveProperty("html");
    expectTypeOf<DocumentContent>().not.toHaveProperty("editorHtml");
    expectTypeOf<DocumentContent>().not.toHaveProperty("browsingHtml");
    expectTypeOf<DocumentContent>().not.toHaveProperty("recoveryStatus");
    expectTypeOf<DocumentContent>().not.toHaveProperty("artifacts");
    expectTypeOf<FileItem>().not.toHaveProperty("contentMarkdown");
  });

  it("sends only canonical Markdown state to the Page write command", async () => {
    const result = {
      markdown: "Body",
      revision: "sha256:new",
      meta: { id: "page-1" },
      outline: [],
    };
    const invoke = vi.fn(async <T>() => result as T) as DesktopInvoker & ReturnType<typeof vi.fn>;
    const adapter = new DiskStorageAdapter({ root: "/vault", invoke });

    const written = await adapter.write(
      { mode: "disk", id: "page-1", kind: "document", path: "Page.md" },
      {
        markdown: "Body",
        meta: { id: "page-1" },
        expectedRevision: "sha256:old",
      }
    );

    expect(invoke).toHaveBeenCalledWith("doc_write_workspace", {
      root: "/vault",
      path: "Page.md",
      payload: {
        markdown: "Body",
        meta: { id: "page-1" },
        expectedRevision: "sha256:old",
      },
    });
    expect(written.markdown).toBe("Body");
    expect(Object.keys(written)).not.toEqual(
      expect.arrayContaining(["html", "editorHtml", "browsingHtml", "extras", "correlation"])
    );
  });

  it("reads a local image through the workspace-confined read-only command", async () => {
    const asset = { path: "assets/pixel.png", mime: "image/png", base64: "iVBORw0KGgo=" };
    const invoke = vi.fn(async <T>() => asset as T) as DesktopInvoker & ReturnType<typeof vi.fn>;
    const adapter = new DiskStorageAdapter({ root: "/vault", invoke });

    await expect(adapter.readAsset("assets/pixel.png")).resolves.toEqual(asset);
    expect(invoke).toHaveBeenCalledWith("workspace_read_asset", {
      root: "/vault",
      path: "assets/pixel.png",
    });
  });

  it("imports local image bytes through the workspace-confined asset command", async () => {
    const imported = { path: "media/pixel.png", mime: "image/png" };
    const invoke = vi.fn(async <T>() => imported as T) as DesktopInvoker & ReturnType<typeof vi.fn>;
    const adapter = new DiskStorageAdapter({ root: "/vault", invoke });
    const bytes = new Uint8Array([137, 80, 78, 71]);

    await expect(
      adapter.importAsset({
        name: "pixel.png",
        bytes,
        destinationDir: "media",
      })
    ).resolves.toEqual(imported);
    expect(invoke).toHaveBeenCalledWith("workspace_import_asset", {
      root: "/vault",
      name: "pixel.png",
      bytes,
      destinationDir: "media",
    });
    expect(invoke.mock.calls[0]?.[1].bytes).toBe(bytes);
  });

  it("uses the Electron desktop bridge as the authoritative default invoker", async () => {
    const asset = { path: "assets/pixel.png", mime: "image/png", base64: "iVBORw0KGgo=" };
    const desktopInvoke = vi.fn(async () => asset);
    window.__DOXMIND_DESKTOP__ = {
      platform: "macos",
      invoke: desktopInvoke as unknown as DesktopBridge["invoke"],
      listen: () => () => {},
      getPathForFile: () => null,
    };

    try {
      const adapter = new DiskStorageAdapter({ root: "/vault" });
      await expect(adapter.readAsset("assets/pixel.png")).resolves.toEqual(asset);
      expect(desktopInvoke).toHaveBeenCalledWith("workspace_read_asset", {
        root: "/vault",
        path: "assets/pixel.png",
      });
    } finally {
      delete window.__DOXMIND_DESKTOP__;
    }
  });

  it("fails desktop-only asset import before the browser-development HTTP fallback", async () => {
    delete window.__DOXMIND_DESKTOP__;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    try {
      const adapter = new DiskStorageAdapter({ root: "/vault" });
      await expect(
        adapter.importAsset({
          name: "pixel.png",
          bytes: new Uint8Array([137, 80, 78, 71]),
        })
      ).rejects.toThrow("Image asset import requires the Electron desktop app");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails closed when an Electron renderer starts without its desktop bridge", async () => {
    delete window.__DOXMIND_DESKTOP__;
    const userAgent = vi
      .spyOn(window.navigator, "userAgent", "get")
      .mockReturnValue("Mozilla/5.0 doXmind Electron/42.4.0");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    try {
      const adapter = new DiskStorageAdapter({ root: "/vault" });
      await expect(adapter.readAsset("assets/pixel.png")).rejects.toThrow(
        "Electron desktop bridge unavailable"
      );
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      userAgent.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("maps a Page relocation plan onto one revision-checked workspace transaction", async () => {
    const invokeResult = {
      document: {
        id: "page-1",
        idSource: "frontmatter" as const,
        path: "Archive/Roadmap.md",
        name: "Roadmap.md",
        title: "Roadmap",
        documentType: "markdown" as const,
      },
      revision: "sha256:moved",
      writes: [{ path: "Notes/Daily.md", revision: "sha256:daily-new" }],
    };
    const invoke = vi.fn(async <T>() => invokeResult as T) as DesktopInvoker &
      ReturnType<typeof vi.fn>;
    const adapter = new DiskStorageAdapter({ root: "/vault", invoke });

    const relocated = await adapter.relocatePage(
      {
        mode: "disk",
        id: "page-1",
        kind: "document",
        documentType: "markdown",
        relPath: "Notes/Target.md",
      },
      {
        newPath: "Archive/Roadmap.md",
        expectedRevision: "sha256:target-old",
        checks: [
          { path: "Notes/Daily.md", expectedRevision: "sha256:daily-old" },
          { path: "Notes/Target.md", expectedRevision: "sha256:target-old" },
        ],
        movedMarkdown: "# Roadmap\n",
        writes: [
          {
            path: "Notes/Daily.md",
            expectedRevision: "sha256:daily-old",
            markdown: "[[../Archive/Roadmap]]\n",
          },
        ],
      }
    );

    expect(invoke).toHaveBeenCalledWith("workspace_relocate_page", {
      root: "/vault",
      oldPath: "Notes/Target.md",
      newPath: "Archive/Roadmap.md",
      expectedRevision: "sha256:target-old",
      checks: [
        { path: "Notes/Daily.md", expectedRevision: "sha256:daily-old" },
        { path: "Notes/Target.md", expectedRevision: "sha256:target-old" },
      ],
      movedMarkdown: "# Roadmap\n",
      writes: [
        {
          path: "Notes/Daily.md",
          expectedRevision: "sha256:daily-old",
          markdown: "[[../Archive/Roadmap]]\n",
        },
      ],
    });
    expect(relocated.entry.handle).toMatchObject({
      id: "page-1",
      relPath: "Archive/Roadmap.md",
    });
    expect(relocated.revision).toBe("sha256:moved");
    expect(relocated.writes).toEqual(invokeResult.writes);
  });

  it("maps a Folder relocation plan without exposing recovery state", async () => {
    const invokeResult = {
      path: "Archive/Notes",
      writes: [
        { path: "Archive/Notes/Target.md", revision: "sha256:target-new" },
        { path: "Daily.md", revision: "sha256:daily-new" },
      ],
    };
    const invoke = vi.fn(async <T>() => invokeResult as T) as DesktopInvoker &
      ReturnType<typeof vi.fn>;
    const adapter = new DiskStorageAdapter({ root: "/vault", invoke });

    const relocated = await adapter.relocateFolder(
      { mode: "disk", id: "folder:Notes", kind: "folder", relPath: "Notes" },
      {
        newPath: "Archive/Notes",
        checks: [
          { path: "Daily.md", expectedRevision: "sha256:daily" },
          { path: "Notes/Target.md", expectedRevision: "sha256:target" },
        ],
        writes: [
          {
            sourcePath: "Notes/Target.md",
            destinationPath: "Archive/Notes/Target.md",
            expectedRevision: "sha256:target",
            markdown: "[[../../../Daily]]\n",
          },
          {
            sourcePath: "Daily.md",
            destinationPath: "Daily.md",
            expectedRevision: "sha256:daily",
            markdown: "[[Archive/Notes/Target]]\n",
          },
        ],
      }
    );

    expect(invoke).toHaveBeenCalledWith("workspace_relocate_folder", {
      root: "/vault",
      oldPath: "Notes",
      newPath: "Archive/Notes",
      checks: [
        { path: "Daily.md", expectedRevision: "sha256:daily" },
        { path: "Notes/Target.md", expectedRevision: "sha256:target" },
      ],
      writes: [
        {
          sourcePath: "Notes/Target.md",
          destinationPath: "Archive/Notes/Target.md",
          expectedRevision: "sha256:target",
          markdown: "[[../../../Daily]]\n",
        },
        {
          sourcePath: "Daily.md",
          destinationPath: "Daily.md",
          expectedRevision: "sha256:daily",
          markdown: "[[Archive/Notes/Target]]\n",
        },
      ],
    });
    expect(relocated).toEqual(invokeResult);
    expect(Object.keys(relocated)).not.toContain("sidecars");
  });

  it("prevents the generic rename/move seam from bypassing Page and Folder relocation", async () => {
    const invoke = vi.fn() as DesktopInvoker & ReturnType<typeof vi.fn>;
    const adapter = new DiskStorageAdapter({ root: "/vault", invoke });

    await expect(
      adapter.renameAttachment(
        {
          mode: "disk",
          id: "page-1",
          kind: "document",
          documentType: "markdown",
          relPath: "Page.md",
        },
        "Renamed.md"
      )
    ).rejects.toThrow("relocatePage");
    await expect(
      adapter.moveAttachment(
        { mode: "disk", id: "folder:Notes", kind: "folder", relPath: "Notes" },
        null
      )
    ).rejects.toThrow("relocateFolder");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps the scan-resolved path identity when authored frontmatter ids collide", async () => {
    const result = {
      markdown: "Body",
      revision: "sha256:read",
      meta: { id: "copied-page", title: "Copy" },
      outline: [],
    };
    const invoke = vi.fn(async <T>() => result as T) as DesktopInvoker & ReturnType<typeof vi.fn>;
    const adapter = new DiskStorageAdapter({ root: "/vault", invoke });
    const content = await adapter.read({
      mode: "disk",
      id: "path:resolved-copy",
      kind: "document",
      documentType: "markdown",
      path: "Copy.md",
      relPath: "Copy.md",
    });

    expect(content.handle.id).toBe("path:resolved-copy");
    expect(content.meta?.id).toBe("copied-page");
    expect(invoke).toHaveBeenCalledWith("doc_read", {
      root: "/vault",
      path: "Copy.md",
    });
  });

  it("imports .markdown Pages through the native command boundary", async () => {
    const invoke = vi.fn(
      async <T>() =>
        ({
          id: "path:Knowledge.markdown",
          idSource: "path",
          path: "Knowledge.markdown",
          name: "Knowledge.markdown",
          documentType: "markdown",
        }) as T
    ) as DesktopInvoker & ReturnType<typeof vi.fn>;
    const adapter = new DiskStorageAdapter({ root: "/vault", invoke });

    const imported = await adapter.importExternal!({
      name: "Knowledge.markdown",
      parent: null,
      bytes: new Uint8Array([35, 32, 75, 110, 111, 119, 108, 101, 100, 103, 101, 10]),
    });

    expect(invoke).toHaveBeenCalledWith("doc_import_external", {
      root: "/vault",
      name: "Knowledge.markdown",
      destFolder: "",
      mode: "create",
      bytes: [35, 32, 75, 110, 111, 119, 108, 101, 100, 103, 101, 10],
    });
    expect(imported.documentType).toBe("markdown");
  });

  it("reads legacy attachment recovery through the dedicated zero-write command", async () => {
    const state = { version: 1 as const, highlights: [{ id: "h1" }] };
    const invoke = vi.fn(async <T>() => ({ editor: state }) as T) as DesktopInvoker &
      ReturnType<typeof vi.fn>;
    const adapter = new DiskStorageAdapter({ root: "/vault", invoke });

    const recovery = await adapter.readAttachmentRecovery!({
      mode: "disk",
      id: "path:Spec.pdf",
      kind: "document",
      documentType: "pdf",
      path: "Spec.pdf",
      relPath: "Spec.pdf",
    });

    expect(recovery).toEqual({ editor: state });
    expect(invoke).toHaveBeenCalledWith("workspace_read_attachment_recovery", {
      root: "/vault",
      path: "Spec.pdf",
    });
  });

  it("inspects Page recovery through a seam independent from the Page DTO", async () => {
    const result = {
      recoveryStatus: "available" as const,
      artifacts: ["Notes/.Page.doxmind", "Notes/.Page.doxmind.lock"],
    };
    const invoke = vi.fn(async <T>() => result as T) as DesktopInvoker & ReturnType<typeof vi.fn>;
    const adapter = new DiskStorageAdapter({ root: "/vault", invoke });

    const inspection = await adapter.inspectPageRecovery({
      mode: "disk",
      id: "page-1",
      kind: "document",
      documentType: "markdown",
      path: "Notes/Page.md",
      relPath: "Notes/Page.md",
    });

    expect(inspection).toEqual(result);
    expect(invoke).toHaveBeenCalledWith("workspace_inspect_page_recovery", {
      root: "/vault",
      path: "Notes/Page.md",
    });
  });

  it("reads Page recovery as exact raw artifact bytes", async () => {
    const result = {
      artifacts: [
        { path: ".Page.doxmind", bytes: [0, 255, 96] },
        { path: ".Page.doxmind.lock", bytes: [] },
      ],
    };
    const invoke = vi.fn(async <T>() => result as T) as DesktopInvoker & ReturnType<typeof vi.fn>;
    const adapter = new DiskStorageAdapter({ root: "/vault", invoke });

    const recovery = await adapter.readPageRecovery({
      mode: "disk",
      id: "page-1",
      kind: "document",
      documentType: "markdown",
      path: "Page.md",
      relPath: "Page.md",
    });

    expect(recovery).toEqual(result);
    expect(invoke).toHaveBeenCalledWith("workspace_read_page_recovery", {
      root: "/vault",
      path: "Page.md",
    });
  });
});
