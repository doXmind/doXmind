import type {
  DocumentContent,
  DocumentHandle,
  DocumentMeta,
  PdfEditorState,
  WorkspaceDocumentType,
  MarkdownSearchOptions,
  MarkdownSearchResults,
  StorageAdapter,
  StorageCreateInput,
  StorageWriteInput,
  WorkspaceEntry,
  WorkspaceIndexEntry,
  WorkspaceIndexQuery,
} from "./types";
import { entriesToWorkspaceIndex } from "./search";
import { apiUrl } from "@/lib/api/base";

type TauriInvoker = <T>(command: string, payload: Record<string, unknown>) => Promise<T>;

export interface DiskStorageAdapterOptions {
  root?: string | null;
  invoke?: TauriInvoker;
}

interface WorkspaceScanResultDto {
  root: string;
  documents: WorkspaceDocumentDto[];
}

interface WorkspaceDocumentDto {
  id: string;
  idSource: "frontmatter" | "path";
  path: string;
  name: string;
  title?: string | null;
  documentType?: WorkspaceDocumentType;
  hasSidecar: boolean;
}

interface DocReadResultDto {
  html: string;
  markdown: string;
  meta: DocumentMeta;
  extras?: unknown;
  source: "sidecar" | "markdown" | "empty";
}

interface MarkdownSearchResultDto {
  path: string;
  title?: string | null;
  matches: Array<{
    line: number;
    preview: string;
  }>;
}

export class DiskStorageAdapter implements StorageAdapter {
  readonly mode = "disk" as const;

  private root: string | null;
  private readonly invoke: TauriInvoker;

  constructor(options: DiskStorageAdapterOptions = {}) {
    this.root = options.root ?? null;
    this.invoke = options.invoke ?? invokeTauri;
  }

  setRoot(root: string | null): void {
    this.root = root;
  }

  async list(): Promise<WorkspaceEntry[]> {
    const root = this.requireRoot();
    const result = await this.invoke<WorkspaceScanResultDto>("workspace_scan", { root });
    this.root = result.root;
    await this.invoke("workspace_index_rebuild", { root: this.root });
    return entriesFromDocuments(result.documents);
  }

  async read(handle: DocumentHandle): Promise<DocumentContent> {
    if ((handle.documentType ?? documentTypeFromPath(requireHandlePath(handle))) === "pdf") {
      throw new Error("PDF documents are binary; use readBinary instead");
    }

    const result = await this.invoke<DocReadResultDto>("doc_read", {
      path: this.absolutePath(handle),
    });
    return {
      handle: this.handleFromRead(handle, result),
      name: basename(handle.path || handle.relPath || result.meta.title || "Untitled.md"),
      html: result.html,
      markdown: result.markdown,
      meta: result.meta,
      extras: result.extras,
      source: result.source,
      documentType: "markdown",
      updatedAt: result.meta.updated || new Date().toISOString(),
    };
  }

  async readBinary(handle: DocumentHandle): Promise<Uint8Array> {
    const bytes = await this.invoke<number[]>("workspace_read_binary", {
      root: this.requireRoot(),
      path: requireHandlePath(handle),
    });
    return new Uint8Array(bytes);
  }

  async readPdfEditorState(handle: DocumentHandle): Promise<PdfEditorState | null> {
    return this.invoke<PdfEditorState | null>("workspace_read_pdf_editor_state", {
      root: this.requireRoot(),
      path: requireHandlePath(handle),
    });
  }

  async writePdfEditorState(handle: DocumentHandle, state: PdfEditorState): Promise<void> {
    await this.invoke<void>("workspace_write_pdf_editor_state", {
      root: this.requireRoot(),
      path: requireHandlePath(handle),
      payload: state,
    });
  }

  async write(handle: DocumentHandle, content: StorageWriteInput): Promise<DocumentContent> {
    const existing = await this.read(handle);
    const meta = normalizeWriteMeta(handle, existing, content);
    const markdown = content.markdown ?? existing.markdown ?? "";
    const html = content.html ?? existing.html ?? "";

    await this.invoke<void>("doc_write_workspace", {
      root: this.requireRoot(),
      path: requireHandlePath(handle),
      payload: {
        html,
        markdown,
        meta,
        extras: content.extras ?? existing.extras ?? null,
      },
    });

    return this.read({ ...handle, id: meta.id });
  }

  async create(input: StorageCreateInput): Promise<WorkspaceEntry> {
    const kind = input.kind ?? "document";
    if (kind === "folder") {
      const path = childPath(input.parent, input.name);
      await this.invoke<void>("workspace_create_folder", {
        root: this.requireRoot(),
        path,
      });
      return folderEntryFromPath(path);
    }

    const path = ensureMarkdownExtension(childPath(input.parent, input.name));
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const meta: DocumentMeta = {
      id,
      title: stripMarkdownExtension(basename(path)),
      created: now,
      updated: now,
    };
    const document = await this.invoke<WorkspaceDocumentDto>("doc_create", {
      root: this.requireRoot(),
      payload: {
        path,
        html: input.content?.html ?? "",
        markdown: input.content?.markdown ?? "",
        meta,
        extras: null,
      },
    });
    return entryFromDocument(document);
  }

  async rename(handle: DocumentHandle, name: string): Promise<WorkspaceEntry> {
    const currentPath = requireHandlePath(handle);
    const newPath = siblingPath(
      currentPath,
      handle.kind === "folder" ? name : ensureMarkdownExtension(name)
    );
    if (newPath === currentPath) {
      return handle.kind === "folder"
        ? folderEntryFromPath(currentPath)
        : entryFromDocument({
            id: handle.id,
            idSource: handle.id.startsWith("path:") ? "path" : "frontmatter",
            path: currentPath,
            name: basename(currentPath),
            title: stripMarkdownExtension(basename(currentPath)),
            hasSidecar: false,
          });
    }
    if (handle.kind === "folder") {
      await this.invoke<void>("workspace_rename_folder", {
        root: this.requireRoot(),
        oldPath: currentPath,
        newPath,
      });
      return folderEntryFromPath(newPath);
    }

    const document = await this.invoke<WorkspaceDocumentDto>("doc_rename", {
      root: this.requireRoot(),
      oldPath: currentPath,
      newPath,
    });
    return entryFromDocument(document);
  }

  async move(handle: DocumentHandle, parent: DocumentHandle | null): Promise<WorkspaceEntry> {
    const currentPath = requireHandlePath(handle);
    const newPath = childPath(parent, basename(currentPath));
    if (newPath === currentPath) {
      return handle.kind === "folder"
        ? folderEntryFromPath(currentPath)
        : entryFromDocument({
            id: handle.id,
            idSource: handle.id.startsWith("path:") ? "path" : "frontmatter",
            path: currentPath,
            name: basename(currentPath),
            title: stripMarkdownExtension(basename(currentPath)),
            hasSidecar: false,
          });
    }
    if (handle.kind === "folder") {
      await this.invoke<void>("workspace_rename_folder", {
        root: this.requireRoot(),
        oldPath: currentPath,
        newPath,
      });
      return folderEntryFromPath(newPath);
    }

    const document = await this.invoke<WorkspaceDocumentDto>("doc_move", {
      root: this.requireRoot(),
      oldPath: currentPath,
      newPath,
    });
    return entryFromDocument(document);
  }

  async delete(handle: DocumentHandle): Promise<void> {
    if (handle.kind === "folder") {
      await this.invoke<void>("workspace_delete_folder", {
        root: this.requireRoot(),
        path: requireHandlePath(handle),
      });
      return;
    }

    await this.invoke<void>("doc_delete", {
      root: this.requireRoot(),
      path: requireHandlePath(handle),
    });
  }

  async queryWorkspaceIndex(query: WorkspaceIndexQuery = {}): Promise<WorkspaceIndexEntry[]> {
    return entriesToWorkspaceIndex(await this.list(), query);
  }

  async searchMarkdown(
    query: string,
    options: MarkdownSearchOptions = {}
  ): Promise<MarkdownSearchResults> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return { results: [] };

    const entries = await this.list();
    const entriesByPath = new Map(
      entries
        .filter((entry) => entry.kind === "document")
        .map((entry) => [entry.handle.relPath ?? entry.handle.path ?? "", entry])
    );
    const fileIdSet = options.fileIds ? new Set(options.fileIds) : null;
    const results = await this.invoke<MarkdownSearchResultDto[]>("workspace_markdown_search", {
      root: this.requireRoot(),
      query: normalizedQuery,
      limit: options.limit,
    });

    return {
      results: results
        .flatMap((result) => {
          const entry = entriesByPath.get(result.path);
          if (!entry || (fileIdSet && !fileIdSet.has(entry.handle.id))) return [];
          const firstMatch = result.matches[0];
          return [
            {
              id: `${entry.handle.id}:${firstMatch?.line ?? 0}`,
              content: firstMatch?.preview ?? result.title ?? entry.name,
              metadata: {
                fileId: entry.handle.id,
                name: entry.name,
                path: result.path,
                chunkIndex: firstMatch?.line,
              },
              score: 1,
            },
          ];
        })
        .slice(0, options.limit ?? 50),
    };
  }

  private requireRoot(): string {
    if (!this.root) {
      throw new Error("No disk workspace is open");
    }
    return this.root;
  }

  private absolutePath(handle: DocumentHandle): string {
    const relPath = requireHandlePath(handle);
    return joinPath(this.requireRoot(), relPath);
  }

  private handleFromRead(handle: DocumentHandle, result: DocReadResultDto): DocumentHandle {
    const relPath = handle.relPath ?? handle.path ?? null;
    return {
      ...handle,
      mode: "disk",
      id: result.meta.id || handle.id,
      kind: "document",
      documentType: "markdown",
      path: relPath,
      relPath,
    };
  }
}

async function invokeTauri<T>(command: string, payload: Record<string, unknown>): Promise<T> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(command, payload);
  } catch (error) {
    return invokeWorkspaceHttp<T>(command, payload, error);
  }
}

async function invokeWorkspaceHttp<T>(
  command: string,
  payload: Record<string, unknown>,
  tauriError: unknown
): Promise<T> {
  const response = await fetch(apiUrl("/api/workspace/invoke"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, payload }),
  });

  if (!response.ok) {
    let message = `Workspace command failed: ${command}`;
    try {
      const body = await response.json();
      message = body?.detail || body?.error?.message || message;
    } catch {
      // Keep the generic message when the local sidecar cannot return JSON.
    }
    const fallback = tauriError instanceof Error ? `; Tauri: ${tauriError.message}` : "";
    throw new Error(`${message}${fallback}`);
  }

  return response.json() as Promise<T>;
}

function entriesFromDocuments(documents: WorkspaceDocumentDto[]): WorkspaceEntry[] {
  const folders = new Map<string, WorkspaceEntry>();
  const entries: WorkspaceEntry[] = [];

  for (const doc of documents) {
    const parts = doc.path.split("/").filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      const folderPath = parts.slice(0, i).join("/");
      if (!folders.has(folderPath)) {
        folders.set(folderPath, folderEntryFromPath(folderPath));
      }
    }
    entries.push(entryFromDocument(doc));
  }

  return [...folders.values(), ...entries].sort((a, b) => {
    if (a.parent?.id !== b.parent?.id)
      return (a.parent?.id || "").localeCompare(b.parent?.id || "");
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function entryFromDocument(doc: WorkspaceDocumentDto): WorkspaceEntry {
  const parentPath = dirname(doc.path);
  const now = new Date().toISOString();
  return {
    handle: {
      mode: "disk",
      id: doc.id,
      kind: "document",
      documentType: doc.documentType ?? documentTypeFromPath(doc.path),
      path: doc.path,
      relPath: doc.path,
    },
    kind: "document",
    name: doc.title || stripDocumentExtension(doc.name),
    parent: parentPath ? folderHandle(parentPath) : null,
    position: 0,
    createdAt: now,
    updatedAt: now,
    preview: doc.title || "",
    wordCount: 0,
    documentType: doc.documentType ?? documentTypeFromPath(doc.path),
    isFavorite: false,
    icon: null,
    coverImageUrl: null,
    coverPosition: 0.5,
  };
}

function folderEntryFromPath(path: string): WorkspaceEntry {
  const clean = trimSlashes(path);
  const parentPath = dirname(clean);
  const now = new Date().toISOString();
  return {
    handle: folderHandle(clean),
    kind: "folder",
    name: basename(clean),
    parent: parentPath ? folderHandle(parentPath) : null,
    position: 0,
    createdAt: now,
    updatedAt: now,
    preview: "",
    wordCount: 0,
    isFavorite: false,
    icon: null,
    coverImageUrl: null,
    coverPosition: 0.5,
  };
}

function folderHandle(path: string): DocumentHandle {
  const clean = trimSlashes(path);
  return {
    mode: "disk",
    id: `folder:${clean}`,
    kind: "folder",
    path: clean,
    relPath: clean,
  };
}

function normalizeWriteMeta(
  handle: DocumentHandle,
  existing: DocumentContent,
  content: StorageWriteInput
): DocumentMeta {
  const id = handle.id.startsWith("path:") ? crypto.randomUUID() : handle.id;
  return {
    ...(existing.meta || {}),
    ...(content.meta || {}),
    id,
    title:
      content.name ??
      content.meta?.title ??
      existing.meta?.title ??
      stripMarkdownExtension(existing.name),
    updated: new Date().toISOString(),
  };
}

function requireHandlePath(handle: DocumentHandle): string {
  const path = handle.relPath || handle.path;
  if (!path) throw new Error("Disk document handle is missing a path");
  return trimSlashes(path);
}

function childPath(parent: DocumentHandle | null | undefined, name: string): string {
  const cleanName = trimSlashes(name);
  if (!parent) return cleanName;
  return `${requireHandlePath(parent)}/${cleanName}`;
}

function siblingPath(path: string, name: string): string {
  const parent = dirname(path);
  return parent ? `${parent}/${trimSlashes(name)}` : trimSlashes(name);
}

function joinPath(root: string, relPath: string): string {
  return `${root.replace(/\/+$/, "")}/${trimSlashes(relPath)}`;
}

function dirname(path: string): string {
  const parts = trimSlashes(path).split("/");
  parts.pop();
  return parts.join("/");
}

function basename(path: string): string {
  return trimSlashes(path).split("/").filter(Boolean).pop() || "";
}

function trimSlashes(path: string): string {
  return path.replace(/^\/+|\/+$/g, "");
}

function ensureMarkdownExtension(name: string): string {
  return /\.(md|markdown)$/i.test(name) ? name : `${name}.md`;
}

function stripMarkdownExtension(name: string): string {
  return name.replace(/\.(md|markdown)$/i, "");
}

function stripDocumentExtension(name: string): string {
  return name.replace(/\.(md|markdown|pdf)$/i, "");
}

function documentTypeFromPath(path: string): WorkspaceDocumentType {
  return /\.pdf$/i.test(path) ? "pdf" : "markdown";
}
