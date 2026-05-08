import type {
  CorrelationReport,
  DocumentContent,
  DocumentHandle,
  DocumentMeta,
  ExcelDocStateRead,
  ExcelEditorState,
  PdfDocStateRead,
  PdfEditorState,
  WorkspaceDocumentType,
  MarkdownSearchOptions,
  MarkdownSearchResults,
  StorageAdapter,
  StorageCreateInput,
  StorageImportInput,
  StorageWriteInput,
  WorkspaceEntry,
  WorkspaceIndexEntry,
  WorkspaceIndexQuery,
} from "./types";
import { ImportError } from "./types";
import { entriesToWorkspaceIndex } from "./search";
import { apiUrl } from "@/lib/api/base";
import { perfAsync } from "@/lib/perf";
import { unwrapCjkMath, unwrapMathInTableCells } from "@/lib/markdown";

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
  icon?: string | null;
  cover?: string | null;
  coverPosition?: number | null;
  favorite?: boolean | null;
}

// Polymorphic return shape for `doc_move`. The Tauri command and the
// browser-dev fallback both tag the result with `kind` so the frontend
// narrows correctly per source type — see #66 for the consolidation.
type MoveResultDto =
  | ({ kind: "document" } & WorkspaceDocumentDto)
  | { kind: "folder"; path: string };

interface DocReadResultDto {
  html: string;
  markdown: string;
  meta: DocumentMeta;
  extras?: unknown;
  source: "sidecar" | "markdown" | "empty";
  correlation?: CorrelationReport | null;
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
    const docType = handle.documentType ?? documentTypeFromPath(requireHandlePath(handle));
    if (docType === "pdf") {
      throw new Error("PDF documents are binary; use readBinary instead");
    }
    if (docType === "excel") {
      throw new Error("Excel documents are binary; use readBinary instead");
    }

    const result = await perfAsync(
      "doxmind.adapter.docRead",
      () =>
        this.invoke<DocReadResultDto>("doc_read", {
          path: this.absolutePath(handle),
        }),
      { path: requireHandlePath(handle) }
    );
    return {
      handle: this.handleFromRead(handle, result),
      name: basename(handle.path || handle.relPath || result.meta.title || "Untitled.md"),
      html: unwrapCjkMath(unwrapMathInTableCells(result.html)),
      markdown: result.markdown,
      meta: result.meta,
      extras: result.extras,
      source: result.source,
      documentType: "markdown",
      updatedAt: result.meta.updated || new Date().toISOString(),
      correlation: result.correlation ?? null,
    };
  }

  async statBinary(handle: DocumentHandle): Promise<{ mtimeNs: string; size: number } | null> {
    try {
      return await this.invoke<{ mtimeNs: string; size: number }>("workspace_stat_binary", {
        root: this.requireRoot(),
        path: requireHandlePath(handle),
      });
    } catch {
      // The HTTP fallback (browser dev) may not implement stat. Returning
      // null means "can't tell, assume cache is valid"; cache hit proceeds.
      return null;
    }
  }

  async readBinary(handle: DocumentHandle): Promise<Uint8Array> {
    // The Tauri command returns `tauri::ipc::Response` which surfaces here
    // as an `ArrayBuffer` — that's the fast path (raw binary IPC, no JSON).
    // The HTTP fallback (`invokeWorkspaceHttp`) hits a FastAPI endpoint that
    // still returns a JSON `number[]`; we accept either shape.
    const result = await perfAsync(
      "doxmind.adapter.readBinary",
      () =>
        this.invoke<ArrayBuffer | number[] | Uint8Array>("workspace_read_binary", {
          root: this.requireRoot(),
          path: requireHandlePath(handle),
        }),
      { path: requireHandlePath(handle) }
    );
    if (result instanceof Uint8Array) return result;
    if (result instanceof ArrayBuffer) return new Uint8Array(result);
    return new Uint8Array(result);
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

  async readExcelEditorState(handle: DocumentHandle): Promise<ExcelEditorState | null> {
    return this.invoke<ExcelEditorState | null>("workspace_read_excel_editor_state", {
      root: this.requireRoot(),
      path: requireHandlePath(handle),
    });
  }

  async writeExcelEditorState(handle: DocumentHandle, state: ExcelEditorState): Promise<void> {
    await this.invoke<void>("workspace_write_excel_editor_state", {
      root: this.requireRoot(),
      path: requireHandlePath(handle),
      payload: state,
    });
  }

  async readPdfDocState(handle: DocumentHandle): Promise<PdfDocStateRead | null> {
    return this.invoke<PdfDocStateRead | null>("workspace_read_pdf_doc_state", {
      root: this.requireRoot(),
      path: requireHandlePath(handle),
    });
  }

  async writePdfParsedCache(
    handle: DocumentHandle,
    sourceHash: string,
    parsed: unknown
  ): Promise<void> {
    await this.invoke<void>("workspace_write_pdf_parsed_cache", {
      root: this.requireRoot(),
      path: requireHandlePath(handle),
      sourceHash,
      parsed,
    });
  }

  async readExcelDocState(handle: DocumentHandle): Promise<ExcelDocStateRead | null> {
    return this.invoke<ExcelDocStateRead | null>("workspace_read_excel_doc_state", {
      root: this.requireRoot(),
      path: requireHandlePath(handle),
    });
  }

  async writeExcelParsedCache(
    handle: DocumentHandle,
    sourceHash: string,
    parsed: unknown
  ): Promise<void> {
    await this.invoke<void>("workspace_write_excel_parsed_cache", {
      root: this.requireRoot(),
      path: requireHandlePath(handle),
      sourceHash,
      parsed,
    });
  }

  async write(handle: DocumentHandle, content: StorageWriteInput): Promise<DocumentContent> {
    // Partial payload: only include keys the caller actually wants to update.
    // Meta-only writes (cover/icon/etc.) must NOT send empty html/markdown,
    // or the server will overwrite the body with "" and wipe the document.
    const payload: Record<string, unknown> = {};
    if (content.html !== undefined) payload.html = content.html;
    if (content.markdown !== undefined) payload.markdown = content.markdown;
    if (content.name !== undefined) payload.name = content.name;
    if (content.meta !== undefined) payload.meta = content.meta;
    if (content.extras !== undefined) payload.extras = content.extras;

    const result = await this.invoke<DocReadResultDto>("doc_write_workspace", {
      root: this.requireRoot(),
      path: requireHandlePath(handle),
      payload,
    });

    const nextHandle = this.handleFromRead(handle, result);
    return {
      handle: nextHandle,
      name: basename(handle.path || handle.relPath || result.meta.title || "Untitled.md"),
      html: result.html,
      markdown: result.markdown,
      meta: result.meta,
      extras: result.extras,
      source: result.source,
      documentType: "markdown",
      updatedAt: result.meta.updated || new Date().toISOString(),
      correlation: result.correlation ?? null,
    };
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

    const documentType =
      input.documentType ??
      (/\.pdf$/i.test(input.name)
        ? "pdf"
        : /\.(xlsx|xlsm)$/i.test(input.name)
          ? "excel"
          : "markdown");

    if (documentType === "pdf") {
      if (!input.binary || input.binary.byteLength === 0) {
        throw new Error("Creating a PDF requires non-empty binary bytes");
      }
      const path = ensurePdfExtension(childPath(input.parent, input.name));
      // Tauri's IPC serializes Uint8Array as a JSON number array — that's how
      // the existing `workspace_read_binary` command returns bytes too. The
      // HTTP fallback (`/api/workspace/invoke`) re-uses the same shape via
      // JSON, so a plain array works for both transports.
      const document = await this.invoke<WorkspaceDocumentDto>("doc_create_pdf", {
        root: this.requireRoot(),
        path,
        bytes: Array.from(input.binary),
      });
      return entryFromDocument(document);
    }

    if (documentType === "excel") {
      if (!input.binary || input.binary.byteLength === 0) {
        throw new Error("Creating an Excel workbook requires non-empty binary bytes");
      }
      const path = ensureExcelExtension(childPath(input.parent, input.name));
      const document = await this.invoke<WorkspaceDocumentDto>("doc_create_excel", {
        root: this.requireRoot(),
        path,
        bytes: Array.from(input.binary),
      });
      return entryFromDocument(document);
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

  async importExternal(input: StorageImportInput): Promise<WorkspaceEntry> {
    if (!input.srcPath && !input.bytes) {
      throw new ImportError("no-source", "importExternal requires either srcPath or bytes");
    }
    if (!/\.(md|pdf|xlsx)$/i.test(input.name)) {
      throw new ImportError(
        "bad-extension",
        `only .md, .pdf, .xlsx are supported for external import: ${input.name}`
      );
    }
    const destFolder = input.parent ? requireHandlePath(input.parent) : "";
    const payload: Record<string, unknown> = {
      root: this.requireRoot(),
      name: input.name,
      destFolder,
      mode: "create",
    };
    if (input.srcPath) payload.srcPath = input.srcPath;
    if (input.bytes) payload.bytes = Array.from(input.bytes);
    try {
      const document = await this.invoke<WorkspaceDocumentDto>("doc_import_external", payload);
      return entryFromDocument(document);
    } catch (error) {
      // Translate the backend collision error into a typed ImportError so the
      // sidebar layer can render the right toast (and #69 can later branch on
      // the code to open the conflict modal).
      const message = error instanceof Error ? error.message : String(error);
      if (/already exists/i.test(message) || /destination_exists/i.test(message)) {
        throw new ImportError("destination-exists", message);
      }
      throw new ImportError("unknown", message);
    }
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
    // `doc_move` is polymorphic — it handles both documents (returns a doc
    // DTO with metadata for in-place refresh) and folders (returns just the
    // new path; metadata is rebuilt by the next scan). Renames keep using the
    // dedicated rename commands because in-place rename has different
    // semantics from cross-parent move at the UI layer.
    if (handle.kind === "folder") {
      const result = await this.invoke<MoveResultDto>("doc_move", {
        root: this.requireRoot(),
        oldPath: currentPath,
        newPath,
      });
      // The Tauri/server backend may return either shape; we only care that
      // the destination path matches what we asked for.
      const destinationPath = result.kind === "folder" ? result.path : result.path;
      return folderEntryFromPath(destinationPath);
    }

    const result = await this.invoke<MoveResultDto>("doc_move", {
      root: this.requireRoot(),
      oldPath: currentPath,
      newPath,
    });
    if (result.kind === "folder") {
      // Defensive: should never happen for document handles, but guard the
      // narrowing so a backend regression surfaces here rather than breaking
      // entry refresh downstream.
      throw new Error(`doc_move returned folder result for document handle: ${currentPath}`);
    }
    return entryFromDocument(result);
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
    isFavorite: doc.favorite ?? false,
    icon: doc.icon ?? null,
    coverImageUrl: doc.cover ?? null,
    coverPosition: doc.coverPosition ?? 0.5,
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

function ensurePdfExtension(name: string): string {
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

function ensureExcelExtension(name: string): string {
  return /\.(xlsx|xlsm)$/i.test(name) ? name : `${name}.xlsx`;
}

function stripMarkdownExtension(name: string): string {
  return name.replace(/\.(md|markdown)$/i, "");
}

function stripDocumentExtension(name: string): string {
  return name.replace(/\.(md|markdown|pdf|xlsx|xlsm)$/i, "");
}

function documentTypeFromPath(path: string): WorkspaceDocumentType {
  if (/\.pdf$/i.test(path)) return "pdf";
  if (/\.(xlsx|xlsm)$/i.test(path)) return "excel";
  return "markdown";
}
