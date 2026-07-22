import { describe, expect, it, vi } from "vitest";

import { buildWorkspacePageCatalog } from "@/lib/workspace-page-catalog";
import type {
  DocumentContent,
  DocumentHandle,
  StorageAdapter,
  WorkspaceDocumentType,
  WorkspaceEntry,
} from "@/lib/storage";

const NOW = "2026-07-22T00:00:00.000Z";

function entry(
  id: string,
  path: string,
  kind: WorkspaceEntry["kind"] = "document",
  documentType?: WorkspaceDocumentType
): WorkspaceEntry {
  return {
    handle: {
      mode: "disk",
      id,
      kind,
      documentType,
      path,
      relPath: path,
    },
    kind,
    name: path.split("/").at(-1) ?? path,
    parent: null,
    position: 0,
    createdAt: NOW,
    updatedAt: NOW,
    documentType,
  };
}

function content(
  source: WorkspaceEntry,
  markdown: string,
  meta: Record<string, unknown>,
  revision: string | null = null
): DocumentContent {
  return {
    handle: source.handle,
    name: source.name,
    markdown,
    revision,
    meta: { id: source.handle.id, ...meta },
    documentType: source.documentType,
    updatedAt: NOW,
  };
}

describe("buildWorkspacePageCatalog", () => {
  it("reads only Markdown Pages and projects portable v1 properties deterministically", async () => {
    const beta = entry("runtime-beta", "Notes/Beta.markdown", "document", "markdown");
    const alpha = entry("runtime-alpha", "Alpha.md");
    const attachment = entry("attachment", "Spec.pdf", "document", "pdf");
    const disguisedSidecar = entry("sidecar", "Alpha.doxmind.md", "document", "markdown");
    const folder = entry("folder", "Notes", "folder");
    const documents = new Map<string, DocumentContent>([
      [
        beta.handle.id,
        content(
          beta,
          "# Beta\r\n",
          {
            id: "page-beta",
            title: "  Product Beta  ",
            aliases: [" Beta ", "", 7],
            status: "doing",
            priority: 2,
            published: false,
            topics: ["local", "markdown"],
            invalidNumber: Number.NaN,
            object: { nested: true },
            mixed: ["local", 2],
            nil: null,
            "bad key": "ignored",
          },
          "rev-beta"
        ),
      ],
      [
        alpha.handle.id,
        content(alpha, "Alpha body\n", {
          id: "runtime-alpha",
          tags: ["one", "two"],
          estimate: 0,
          archived: true,
        }),
      ],
    ]);
    const list = vi.fn(async () => [beta, attachment, folder, disguisedSidecar, alpha]);
    const read = vi.fn(async (handle: DocumentHandle) => {
      const document = documents.get(handle.id);
      if (!document) throw new Error(`unexpected read: ${handle.id}`);
      return document;
    });
    const adapter = { list, read } satisfies Pick<StorageAdapter, "list" | "read">;

    await expect(buildWorkspacePageCatalog(adapter)).resolves.toEqual({
      pages: [
        {
          id: "runtime-alpha",
          path: "Alpha.md",
          title: "Alpha",
          aliases: [],
          properties: { archived: true, estimate: 0, tags: ["one", "two"] },
          markdown: "Alpha body\n",
          revision: null,
        },
        {
          id: "runtime-beta",
          path: "Notes/Beta.markdown",
          title: "Product Beta",
          aliases: ["Beta"],
          properties: {
            priority: 2,
            published: false,
            status: "doing",
            title: "  Product Beta  ",
            topics: ["local", "markdown"],
          },
          markdown: "# Beta\r\n",
          revision: "rev-beta",
        },
      ],
    });
    expect(list).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls.map(([handle]) => handle.id).sort()).toEqual([
      "runtime-alpha",
      "runtime-beta",
    ]);
  });

  it("fails explicitly when a listed Page has no workspace-relative path", async () => {
    const page = entry("missing-path", "Fallback.md", "document", "markdown");
    page.handle.path = null;
    page.handle.relPath = null;
    const adapter = {
      list: vi.fn(async () => [page]),
      read: vi.fn(async () => content(page, "body", { id: "page-id" })),
    } satisfies Pick<StorageAdapter, "list" | "read">;

    await expect(buildWorkspacePageCatalog(adapter)).rejects.toThrow(
      "Workspace Page is missing a workspace-relative path: missing-path"
    );
    expect(adapter.read).not.toHaveBeenCalled();
  });
});
