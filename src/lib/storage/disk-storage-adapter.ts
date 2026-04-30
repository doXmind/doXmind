import type {
  DocumentContent,
  DocumentHandle,
  DocumentMeta,
  StorageAdapter,
  StorageCreateInput,
  StorageWriteInput,
  WorkspaceEntry,
} from "./types";

export interface DiskStorageAdapterOptions {
  root?: string | null;
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
  hasSidecar: boolean;
}

interface DocReadResultDto {
  html: string;
  markdown: string;
  meta: DocumentMeta;
  extras?: unknown;
  source: "sidecar" | "markdown" | "empty";
}

export class DiskStorageAdapter implements StorageAdapter {
  readonly mode = "disk" as const;

  private root: string | null;

  constructor(options: DiskStorageAdapterOptions = {}) {
    this.root = options.root ?? null;
  }

  setRoot(root: string | null): void {
    this.root = root;
  }

  async list(): Promise<WorkspaceEntry[]> {
    const root = this.requireRoot();
    const result = await invokeTauri<WorkspaceScanResultDto>("workspace_scan", { root });
    this.root = result.root;
    return entriesFromDocuments(result.documents);
  }

  async read(handle: DocumentHandle): Promise<DocumentContent> {
    const result = await invokeTauri<DocReadResultDto>("doc_read", {
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
      updatedAt: result.meta.updated || new Date().toISOString(),
    };
  }

  async write(handle: DocumentHandle, content: StorageWriteInput): Promise<DocumentContent> {
    const existing = await this.read(handle);
    const meta = normalizeWriteMeta(handle, existing, content);
    const markdown = content.markdown ?? existing.markdown ?? "";
    const html = content.html ?? existing.html ?? "";

    await invokeTauri<void>("doc_write_workspace", {
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
      await invokeTauri<void>("workspace_create_folder", {
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
    const document = await invokeTauri<WorkspaceDocumentDto>("doc_create", {
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
    if (handle.kind === "folder") {
      await invokeTauri<void>("workspace_rename_folder", {
        root: this.requireRoot(),
        oldPath: currentPath,
        newPath,
      });
      return folderEntryFromPath(newPath);
    }

    const document = await invokeTauri<WorkspaceDocumentDto>("doc_rename", {
      root: this.requireRoot(),
      oldPath: currentPath,
      newPath,
    });
    return entryFromDocument(document);
  }

  async move(handle: DocumentHandle, parent: DocumentHandle | null): Promise<WorkspaceEntry> {
    const currentPath = requireHandlePath(handle);
    const newPath = childPath(parent, basename(currentPath));
    if (handle.kind === "folder") {
      await invokeTauri<void>("workspace_rename_folder", {
        root: this.requireRoot(),
        oldPath: currentPath,
        newPath,
      });
      return folderEntryFromPath(newPath);
    }

    const document = await invokeTauri<WorkspaceDocumentDto>("doc_move", {
      root: this.requireRoot(),
      oldPath: currentPath,
      newPath,
    });
    return entryFromDocument(document);
  }

  async delete(handle: DocumentHandle): Promise<void> {
    if (handle.kind === "folder") {
      await invokeTauri<void>("workspace_delete_folder", {
        root: this.requireRoot(),
        path: requireHandlePath(handle),
      });
      return;
    }

    await invokeTauri<void>("doc_delete", {
      root: this.requireRoot(),
      path: requireHandlePath(handle),
    });
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
      path: relPath,
      relPath,
    };
  }
}

async function invokeTauri<T>(command: string, payload: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, payload);
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
      path: doc.path,
      relPath: doc.path,
    },
    kind: "document",
    name: doc.name,
    parent: parentPath ? folderHandle(parentPath) : null,
    position: 0,
    createdAt: now,
    updatedAt: now,
    preview: doc.title || "",
    wordCount: 0,
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
