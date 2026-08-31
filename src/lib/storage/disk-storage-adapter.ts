import type {
  AttachmentInspection,
  AttachmentRecoveryRead,
  DocumentContent,
  DocumentHandle,
  DocumentMeta,
  DocumentOutlineItem,
  FolderRelocationInput,
  FolderRelocationResult,
  WorkspaceDocumentType,
  MarkdownSearchOptions,
  MarkdownSearchResults,
  PageRelocationInput,
  PageRelocationResult,
  PageRecoveryInspection,
  PageRecoveryRead,
  StorageAdapter,
  StorageCreateInput,
  StorageImportInput,
  StorageWriteInput,
  WorkspaceEntry,
  WorkspaceEntryKind,
  WorkspaceAssetImportInput,
  WorkspaceAssetImportResult,
  WorkspaceAssetRead,
  WorkspaceIndexEntry,
  WorkspaceIndexQuery,
} from "./types";
import { ImportError } from "./types";
import { getExcludedScanDirs } from "@/stores/workspace-settings-store";
import { entriesToWorkspaceIndex } from "./search";
import { apiUrl } from "@/lib/api/base";
import { perfAsync } from "@/lib/perf";
import { hasDesktopBridge, invokeDesktop, isElectronRenderer } from "@/lib/native-shell";

export type DesktopInvoker = <T>(command: string, payload: Record<string, unknown>) => Promise<T>;

export interface DiskStorageAdapterOptions {
  root?: string | null;
  invoke?: DesktopInvoker;
}

interface WorkspaceScanResultDto {
  root: string;
  documents: WorkspaceDocumentDto[];
  // Optional: the browser-development FastAPI scan omits both, and then the tree keeps its old
  // document-only, folder-inferred shape rather than losing rows.
  folders?: Array<{ path: string }>;
  assets?: WorkspaceAssetDto[];
}

interface WorkspaceAssetDto {
  path: string;
  name: string;
}

interface WorkspaceDocumentDto {
  id: string;
  idSource: "frontmatter" | "path";
  path: string;
  name: string;
  title?: string | null;
  documentType?: WorkspaceDocumentType;
  favorite?: boolean | null;
  aliases?: string[] | null;
}

// `doc_move` is an Attachment-only compatibility command. Pages and folders
// cross the topology-aware relocation Interfaces below instead.
type MoveResultDto = { kind: "document" } & WorkspaceDocumentDto;

interface DocReadResultDto {
  markdown: string;
  revision?: string | null;
  meta: DocumentMeta;
  outline?: DocumentOutlineItem[];
}

interface PageRelocationResultDto {
  document: WorkspaceDocumentDto;
  revision: string;
  writes: Array<{ path: string; revision: string }>;
}

interface FolderRelocationResultDto {
  path: string;
  writes: Array<{ path: string; revision: string }>;
}

interface MarkdownSearchResultDto {
  id?: string;
  path: string;
  name?: string | null;
  title?: string | null;
  matches: Array<{
    line: number;
    preview: string;
  }>;
}

export class DiskStorageAdapter implements StorageAdapter {
  readonly mode = "disk" as const;

  private root: string | null;
  private readonly invoke: DesktopInvoker;

  constructor(options: DiskStorageAdapterOptions = {}) {
    this.root = options.root ?? null;
    this.invoke = options.invoke ?? invokeWorkspace;
  }

  setRoot(root: string | null): void {
    this.root = root;
  }

  async list(): Promise<WorkspaceEntry[]> {
    const root = this.requireRoot();
    const result = await this.invoke<WorkspaceScanResultDto>("workspace_scan", {
      root,
      excludeDirs: getExcludedScanDirs(),
    });
    this.root = result.root;
    return entriesFromScan(result);
  }

  async read(handle: DocumentHandle): Promise<DocumentContent> {
    const docType = handle.documentType ?? documentTypeFromPath(requireHandlePath(handle));
    if (docType !== "markdown") {
      throw new Error("Page read supports Markdown only; use attachment inspection instead");
    }

    const result = await perfAsync(
      "doxmind.adapter.docRead",
      () =>
        this.invoke<DocReadResultDto>("doc_read", {
          root: this.requireRoot(),
          path: requireHandlePath(handle),
        }),
      { path: requireHandlePath(handle) }
    );
    const meta = normalizePageMeta(result.meta, handle.id);
    return {
      handle: this.handleFromRead(handle),
      name: basename(handle.path || handle.relPath || meta.title || "Untitled.md"),
      markdown: result.markdown,
      revision: result.revision,
      meta,
      outline: result.outline ?? [],
      documentType: docType,
      updatedAt: meta.updated || new Date().toISOString(),
    };
  }

  async readAsset(path: string): Promise<WorkspaceAssetRead> {
    return this.invoke<WorkspaceAssetRead>("workspace_read_asset", {
      root: this.requireRoot(),
      path,
    });
  }

  async importAsset(input: WorkspaceAssetImportInput): Promise<WorkspaceAssetImportResult> {
    return this.invoke<WorkspaceAssetImportResult>("workspace_import_asset", {
      root: this.requireRoot(),
      name: input.name,
      bytes: input.bytes,
      ...(input.destinationDir === undefined ? {} : { destinationDir: input.destinationDir }),
    });
  }

  async inspectAttachment(handle: DocumentHandle): Promise<AttachmentInspection> {
    return this.invoke<AttachmentInspection>("workspace_inspect_attachment", {
      root: this.requireRoot(),
      path: requireHandlePath(handle),
    });
  }

  async inspectPageRecovery(handle: DocumentHandle): Promise<PageRecoveryInspection> {
    return this.invoke<PageRecoveryInspection>("workspace_inspect_page_recovery", {
      root: this.requireRoot(),
      path: requireHandlePath(handle),
    });
  }

  async readPageRecovery(handle: DocumentHandle): Promise<PageRecoveryRead> {
    return this.invoke<PageRecoveryRead>("workspace_read_page_recovery", {
      root: this.requireRoot(),
      path: requireHandlePath(handle),
    });
  }

  async readAttachmentRecovery(handle: DocumentHandle): Promise<AttachmentRecoveryRead | null> {
    return this.invoke<AttachmentRecoveryRead | null>("workspace_read_attachment_recovery", {
      root: this.requireRoot(),
      path: requireHandlePath(handle),
    });
  }

  async write(handle: DocumentHandle, content: StorageWriteInput): Promise<DocumentContent> {
    const docType = handle.documentType ?? documentTypeFromPath(requireHandlePath(handle));
    if (docType !== "markdown") {
      throw new Error("Page write supports Markdown only; open attachments externally instead");
    }

    // Page persistence is Markdown-only. The returned Markdown remains the
    // sole active in-memory Page state.
    const payload: Record<string, unknown> = {};
    if (content.markdown !== undefined) payload.markdown = content.markdown;
    if (content.name !== undefined) payload.name = content.name;
    if (content.meta !== undefined) payload.meta = content.meta;
    if (content.expectedRevision !== undefined) {
      payload.expectedRevision = content.expectedRevision;
    }

    const result = await this.invoke<DocReadResultDto>("doc_write_workspace", {
      root: this.requireRoot(),
      path: requireHandlePath(handle),
      payload,
    });

    const nextHandle = this.handleFromRead(handle);
    const meta = normalizePageMeta(result.meta, handle.id);
    return {
      handle: nextHandle,
      name: basename(handle.path || handle.relPath || meta.title || "Untitled.md"),
      markdown: result.markdown,
      revision: result.revision,
      meta,
      outline: result.outline ?? [],
      documentType: handle.documentType ?? documentTypeFromPath(requireHandlePath(handle)),
      updatedAt: meta.updated || new Date().toISOString(),
    };
  }

  async create(input: StorageCreateInput): Promise<WorkspaceEntry> {
    const kind = input.kind ?? "document";
    if (kind === "asset") throw new Error(ASSET_READ_ONLY);
    if (kind === "folder") {
      const path = childPath(input.parent, input.name);
      await this.invoke<void>("workspace_create_folder", {
        root: this.requireRoot(),
        path,
      });
      return folderEntryFromPath(path);
    }

    // Reject stale callers compiled against the old binary-create contract.
    // Imported attachments use importExternal; primary creation is Page-only.
    const legacyInput = input as StorageCreateInput & {
      documentType?: WorkspaceDocumentType;
      binary?: Uint8Array;
    };
    if (
      (legacyInput.documentType && legacyInput.documentType !== "markdown") ||
      legacyInput.binary
    ) {
      throw new Error(
        "Workspace creation supports Markdown pages only; import attachments instead"
      );
    }

    const path = ensureMarkdownExtension(childPath(input.parent, input.name));
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const meta: DocumentMeta = {
      ...input.content?.meta,
      id,
      title: stripMarkdownExtension(basename(path)),
      created: now,
      updated: now,
    };
    const document = await this.invoke<WorkspaceDocumentDto>("doc_create", {
      root: this.requireRoot(),
      payload: {
        path,
        markdown: input.content?.markdown ?? "",
        meta,
        ...(input.replaceExisting && { replaceExisting: true }),
      },
    });
    return entryFromDocument(document);
  }

  async importExternal(input: StorageImportInput): Promise<WorkspaceEntry> {
    if (!input.srcPath && !input.bytes) {
      throw new ImportError("no-source", "importExternal requires either srcPath or bytes");
    }
    if (!/\.(md|markdown|pdf|xlsx|csv)$/i.test(input.name)) {
      throw new ImportError(
        "bad-extension",
        `only .md, .markdown, .pdf, .xlsx, .csv are supported for external import: ${input.name}`
      );
    }
    if (input.mode === "replace" && !/\.(md|markdown)$/i.test(input.name)) {
      throw new ImportError(
        "replace-not-allowed",
        `replace is available only for Markdown Pages: ${input.name}`
      );
    }
    const destFolder = input.parent ? requireHandlePath(input.parent) : "";
    const payload: Record<string, unknown> = {
      root: this.requireRoot(),
      name: input.name,
      destFolder,
      mode: input.mode ?? "create",
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

  async relocatePage(
    handle: DocumentHandle,
    relocation: PageRelocationInput
  ): Promise<PageRelocationResult> {
    const oldPath = requireHandlePath(handle);
    const docType = handle.documentType ?? documentTypeFromPath(oldPath);
    if (docType !== "markdown") {
      throw new Error("Page relocation supports Markdown only");
    }
    const result = await this.invoke<PageRelocationResultDto>("workspace_relocate_page", {
      root: this.requireRoot(),
      oldPath,
      newPath: relocation.newPath,
      expectedRevision: relocation.expectedRevision,
      checks: relocation.checks,
      ...(relocation.movedMarkdown !== undefined && {
        movedMarkdown: relocation.movedMarkdown,
      }),
      writes: relocation.writes,
    });
    return {
      entry: entryFromDocument(result.document),
      revision: result.revision,
      writes: result.writes,
    };
  }

  async relocateFolder(
    handle: DocumentHandle,
    relocation: FolderRelocationInput
  ): Promise<FolderRelocationResult> {
    if (handle.kind !== "folder") {
      throw new Error("Folder relocation requires a folder handle");
    }
    return this.invoke<FolderRelocationResultDto>("workspace_relocate_folder", {
      root: this.requireRoot(),
      oldPath: requireHandlePath(handle),
      newPath: relocation.newPath,
      checks: relocation.checks,
      writes: relocation.writes,
    });
  }

  async renameAttachment(handle: DocumentHandle, name: string): Promise<WorkspaceEntry> {
    const currentPath = requireHandlePath(handle);
    assertNotAsset(handle);
    if (handle.kind === "folder") {
      throw new Error("Folder rename must use relocateFolder so Page links remain valid");
    }
    if ((handle.documentType ?? documentTypeFromPath(currentPath)) === "markdown") {
      throw new Error("Page rename must use relocatePage so Page links remain valid");
    }
    const newPath = siblingPath(currentPath, renameLeafPreservingExtension(currentPath, name));
    if (newPath === currentPath) {
      return entryFromDocument({
        id: handle.id,
        idSource: handle.id.startsWith("path:") ? "path" : "frontmatter",
        path: currentPath,
        name: basename(currentPath),
        title: stripMarkdownExtension(basename(currentPath)),
      });
    }
    const document = await this.invoke<WorkspaceDocumentDto>("doc_rename", {
      root: this.requireRoot(),
      oldPath: currentPath,
      newPath,
    });
    return entryFromDocument(document);
  }

  async moveAttachment(
    handle: DocumentHandle,
    parent: DocumentHandle | null
  ): Promise<WorkspaceEntry> {
    const currentPath = requireHandlePath(handle);
    assertNotAsset(handle);
    if (handle.kind === "folder") {
      throw new Error("Folder move must use relocateFolder so Page links remain valid");
    }
    if ((handle.documentType ?? documentTypeFromPath(currentPath)) === "markdown") {
      throw new Error("Page move must use relocatePage so Page links remain valid");
    }
    const newPath = childPath(parent, basename(currentPath));
    if (newPath === currentPath) {
      return entryFromDocument({
        id: handle.id,
        idSource: handle.id.startsWith("path:") ? "path" : "frontmatter",
        path: currentPath,
        name: basename(currentPath),
        title: stripMarkdownExtension(basename(currentPath)),
      });
    }
    const result = await this.invoke<MoveResultDto>("doc_move", {
      root: this.requireRoot(),
      oldPath: currentPath,
      newPath,
    });
    return entryFromDocument(result);
  }

  async delete(handle: DocumentHandle): Promise<void> {
    assertNotAsset(handle);
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

    const fileIdSet = options.fileIds ? new Set(options.fileIds) : null;
    const results = await this.invoke<MarkdownSearchResultDto[]>("workspace_markdown_search", {
      root: this.requireRoot(),
      query: normalizedQuery,
      limit: options.limit,
    });

    return {
      results: results
        .flatMap((result) => {
          const fileId = result.id ?? result.path;
          if (fileIdSet && !fileIdSet.has(fileId)) return [];
          const firstMatch = result.matches[0];
          const name = result.name ?? result.title ?? basename(result.path);
          return [
            {
              id: `${fileId}:${firstMatch?.line ?? 0}`,
              content: firstMatch?.preview ?? result.title ?? name,
              metadata: {
                fileId,
                name,
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

  private handleFromRead(handle: DocumentHandle): DocumentHandle {
    const relPath = handle.relPath ?? handle.path ?? null;
    return {
      ...handle,
      mode: "disk",
      // The scan resolves duplicate authored ids to deterministic path ids.
      // A body read must never promote that safe handle back to the duplicate.
      id: handle.id,
      kind: "document",
      documentType: handle.documentType ?? documentTypeFromPath(relPath ?? ""),
      path: relPath,
      relPath,
    };
  }
}

function normalizePageMeta(meta: DocumentMeta, fallbackId: string): DocumentMeta {
  return { ...meta, id: validPageId(meta.id) ?? fallbackId };
}

function validPageId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id || null;
}

async function invokeWorkspace<T>(command: string, payload: Record<string, unknown>): Promise<T> {
  if (!hasDesktopBridge()) {
    if (process.env.NODE_ENV === "production" || isElectronRenderer()) {
      throw new Error("Electron desktop bridge unavailable; refusing browser HTTP fallback");
    }
    if (command === "workspace_import_asset") {
      throw new Error("Image asset import requires the Electron desktop app");
    }
    return invokeWorkspaceHttp<T>(command, payload);
  }

  // Once a desktop bridge exists, every command error is authoritative. In
  // particular, revision conflicts must reach the editor unchanged so it can
  // pause saving and protect both versions instead of retrying an unrelated
  // localhost transport.
  return invokeDesktop<T>(command, payload);
}

async function invokeWorkspaceHttp<T>(
  command: string,
  payload: Record<string, unknown>
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
      const detail = body?.detail;
      // FastAPI HTTPException(detail=...) accepts either a string or a
      // structured dict. Preserve structured details instead of collapsing
      // them to "[object Object]".
      if (typeof detail === "string") {
        message = detail;
      } else if (detail && typeof detail === "object") {
        message = JSON.stringify(detail);
      } else if (typeof detail === "number" || typeof detail === "boolean") {
        // FastAPI permits any JSON-serializable detail; preserve scalar values
        // verbatim so a body like {detail: 42} or {detail: true} doesn't get
        // silently dropped to the generic command-failed message.
        message = String(detail);
      } else if (body?.error?.message) {
        message = body.error.message;
      }
    } catch {
      // Keep the generic message when the local browser-development service
      // cannot return JSON.
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

const ENTRY_KIND_RANK: Record<WorkspaceEntryKind, number> = { folder: 0, document: 1, asset: 2 };

function entriesFromScan(result: WorkspaceScanResultDto): WorkspaceEntry[] {
  const folders = new Map<string, WorkspaceEntry>();
  const entries: WorkspaceEntry[] = [];

  // Real directories, when the scan reports them. This is the only thing that keeps an empty
  // folder — or one holding nothing but images — in the tree across a rescan.
  for (const folder of result.folders ?? []) {
    const clean = trimSlashes(folder.path);
    if (clean && !folders.has(clean)) folders.set(clean, folderEntryFromPath(clean));
  }

  const rememberAncestors = (path: string) => {
    const parts = path.split("/").filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      const folderPath = parts.slice(0, i).join("/");
      if (!folders.has(folderPath)) folders.set(folderPath, folderEntryFromPath(folderPath));
    }
  };

  for (const doc of result.documents) {
    rememberAncestors(doc.path);
    entries.push(entryFromDocument(doc));
  }
  for (const asset of result.assets ?? []) {
    rememberAncestors(asset.path);
    entries.push(entryFromAsset(asset));
  }

  return [...folders.values(), ...entries].sort((a, b) => {
    if (a.parent?.id !== b.parent?.id)
      return (a.parent?.id || "").localeCompare(b.parent?.id || "");
    if (a.kind !== b.kind) return ENTRY_KIND_RANK[a.kind] - ENTRY_KIND_RANK[b.kind];
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
    // The file tree shows the filename — the on-disk source of truth the user
    // renames. Preferring the frontmatter `title` here made renames silently
    // revert: rename only moves the file, never rewrites `title`, so the
    // post-rename DTO refresh re-read the stale title (e.g. "Untitled-N").
    name: stripDocumentExtension(doc.name),
    parent: parentPath ? folderHandle(parentPath) : null,
    position: 0,
    createdAt: now,
    updatedAt: now,
    preview: doc.title || "",
    wordCount: 0,
    documentType: doc.documentType ?? documentTypeFromPath(doc.path),
    isFavorite: doc.favorite ?? false,
    aliases: Array.isArray(doc.aliases) ? doc.aliases : undefined,
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

function entryFromAsset(asset: WorkspaceAssetDto): WorkspaceEntry {
  const parentPath = dirname(asset.path);
  const now = new Date().toISOString();
  return {
    handle: assetHandle(asset.path),
    kind: "asset",
    // Verbatim, extension included: a file tree has to show `diagram.png`, not `diagram`.
    name: asset.name,
    parent: parentPath ? folderHandle(parentPath) : null,
    position: 0,
    createdAt: now,
    updatedAt: now,
    preview: "",
    wordCount: 0,
    isFavorite: false,
  };
}

function assetHandle(path: string): DocumentHandle {
  const clean = trimSlashes(path);
  return {
    mode: "disk",
    id: `asset:${clean}`,
    kind: "asset",
    path: clean,
    relPath: clean,
  };
}

// Every write command below rejects a path outside DOCUMENT_EXTENSIONS anyway; failing here says
// why, instead of surfacing "Unsupported workspace document type" from the type sniffer.
const ASSET_READ_ONLY = "Workspace files are read-only in doXmind; open or reveal them instead";

function assertNotAsset(handle: DocumentHandle): void {
  if (handle.kind === "asset") throw new Error(ASSET_READ_ONLY);
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

// A document rename changes only the base name; the file keeps its original
// type. The new name may arrive with the wrong extension (the sidebar's display
// name has none, so callers default it to ".md") — strip whatever document
// extension came in and re-apply the source file's, so an attachment can never
// be collapsed into a .md.
function renameLeafPreservingExtension(currentPath: string, name: string): string {
  const sourceExt =
    basename(currentPath).match(/\.(md|markdown|pdf|xlsx|xlsm|csv|html?)$/i)?.[0] ?? ".md";
  return `${stripDocumentExtension(basename(name))}${sourceExt}`;
}

function stripMarkdownExtension(name: string): string {
  return name.replace(/\.(md|markdown)$/i, "");
}

function stripDocumentExtension(name: string): string {
  return name.replace(/\.(md|markdown|pdf|xlsx|xlsm|csv|html?)$/i, "");
}

function documentTypeFromPath(path: string): WorkspaceDocumentType {
  if (/\.(md|markdown)$/i.test(path)) return "markdown";
  if (/\.pdf$/i.test(path)) return "pdf";
  if (/\.(xlsx|xlsm|csv)$/i.test(path)) return "excel";
  if (/\.html?$/i.test(path)) return "html";
  throw new Error(`Unsupported workspace document type: ${path}`);
}
