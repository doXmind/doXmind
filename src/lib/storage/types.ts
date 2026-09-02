export type WorkspaceMode = "disk";

// An `asset` is a workspace file doXmind lists but never opens: not a Page, not an Attachment
// workspace. It exists so the tree can show what is actually on disk — images, `.canvas`, `.base`
// — with reveal and open-externally as its only actions.
export type WorkspaceEntryKind = "document" | "folder" | "asset";
export type WorkspacePageType = "markdown";
export type WorkspaceAttachmentType = "pdf" | "excel" | "html";
/** File-format discriminator retained for attachment scanning and legacy compatibility. */
export type WorkspaceDocumentType = WorkspacePageType | WorkspaceAttachmentType;

/** Workspace-confined bytes for a local Markdown image projection. */
export interface WorkspaceAssetRead {
  path: string;
  mime: string;
  base64: string;
}

/** Raster bytes to import into a workspace-confined directory. */
export interface WorkspaceAssetImportInput {
  name: string;
  bytes: Uint8Array;
  destinationDir?: string;
}

export interface WorkspaceAssetImportResult {
  path: string;
  mime: string;
}

export interface DocumentHandle {
  mode: WorkspaceMode;
  id: string;
  kind?: WorkspaceEntryKind;
  documentType?: WorkspaceDocumentType;
  path?: string | null;
  relPath?: string | null;
}

export interface DocumentContent {
  handle: DocumentHandle;
  name: string;
  /** Canonical Page state. All views are derived from this Markdown string. */
  markdown: string;
  /** Hash of the complete on-disk Page used for optimistic concurrency. */
  revision?: string | null;
  meta?: DocumentMeta;
  outline?: DocumentOutlineItem[];
  documentType?: WorkspaceDocumentType;
  updatedAt: string;
}

export interface DocumentOutlineItem {
  id: string;
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
}

export interface DocumentMeta {
  id: string;
  title?: string | null;
  aliases?: string[] | null;
  favorite?: boolean | null;
  created?: string | null;
  updated?: string | null;
  [key: string]: unknown;
}

export interface WorkspaceEntry {
  handle: DocumentHandle;
  kind: WorkspaceEntryKind;
  name: string;
  parent: DocumentHandle | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  preview?: string;
  wordCount?: number;
  documentType?: WorkspaceDocumentType;
  isFavorite?: boolean;
  /** Frontmatter aliases, carried by the scan so Wiki Links resolve without opening the Page. */
  aliases?: string[];
}

export interface StorageWriteInput {
  markdown?: string | null;
  name?: string;
  /** Partial frontmatter patch; omitted keys remain byte-for-byte untouched. */
  meta?: Partial<DocumentMeta>;
  expectedRevision?: string | null;
}

export interface PageRelocationWrite {
  path: string;
  expectedRevision: string;
  markdown: string;
}

export interface PageRevisionCheck {
  path: string;
  expectedRevision: string;
}

export interface PageRelocationInput {
  newPath: string;
  expectedRevision: string;
  /** Complete read snapshot used to reject stale link-repair plans before mutation. */
  checks: PageRevisionCheck[];
  /** Omit when moving the Page does not change its own relative links. */
  movedMarkdown?: string;
  writes: PageRelocationWrite[];
}

export interface PageRelocationResult {
  entry: WorkspaceEntry;
  revision: string;
  writes: Array<{ path: string; revision: string }>;
}

export interface FolderRelocationWrite {
  sourcePath: string;
  destinationPath: string;
  expectedRevision: string;
  markdown: string;
}

export interface FolderRelocationInput {
  newPath: string;
  /** Complete Page topology snapshot used to reject stale plans before mutation. */
  checks: PageRevisionCheck[];
  writes: FolderRelocationWrite[];
}

export interface FolderRelocationResult {
  path: string;
  writes: Array<{ path: string; revision: string }>;
}

export interface StorageCreateInput {
  name: string;
  kind?: WorkspaceEntryKind;
  parent?: DocumentHandle | null;
  content?: StorageWriteInput;
  /**
   * Overwrite an existing file at the destination. Only set it when the user
   * has already consented to replacing that exact path — the native Save
   * panel's own "…already exists. Replace?" prompt. Left unset (the default)
   * creation refuses to touch an occupied destination.
   */
  replaceExisting?: boolean;
}

export interface StorageImportInput {
  /** Filename including extension. Must end in `.md`, `.pdf`, `.xlsx`, or `.csv`. */
  name: string;
  /** Destination folder (or null for workspace root). */
  parent: DocumentHandle | null;
  /** Absolute source path supplied by Electron; preferred over bytes. */
  srcPath?: string;
  /** Raw bytes — used in browser dev mode where HTML5 DnD only exposes File objects. */
  bytes?: Uint8Array;
  /**
   * Import mode. `"create"` (the default) refuses to overwrite. `"replace"`
   * overwrites the user file at the destination.
   */
  mode?: "create" | "replace";
}

/** Discriminator for `ImportError.code` so callers can react without string-matching. */
export type ImportErrorCode =
  "destination-exists" | "bad-extension" | "no-source" | "replace-not-allowed" | "unknown";

export class ImportError extends Error {
  readonly code: ImportErrorCode;
  constructor(code: ImportErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ImportError";
  }
}

export interface WorkspaceIndexQuery {
  query?: string;
  limit?: number;
  includeFolders?: boolean;
}

export interface WorkspaceIndexEntry {
  handle: DocumentHandle;
  id: string;
  kind: WorkspaceEntryKind;
  name: string;
  title: string;
  path?: string | null;
  parent: DocumentHandle | null;
  preview?: string;
  updatedAt: string;
}

export interface MarkdownSearchOptions {
  fileIds?: string[];
  limit?: number;
  signal?: AbortSignal;
  /**
   * Parsed query operators. Serializable by construction — a compiled RegExp cannot cross the
   * bridge, so a regex term travels as its source and flags and is recompiled on the far side.
   */
  criteria?: {
    groups: Array<
      Array<{
        field: "content" | "file" | "path" | "tag";
        value: string;
        negated: boolean;
        regexSource?: string;
        regexFlags?: string;
      }>
    >;
  };
}

export interface MarkdownSearchHit {
  /** 1-based line within the Page body — frontmatter is not part of the editor's document. */
  line: number;
  preview: string;
}

export interface MarkdownSearchResult {
  id: string;
  content: string;
  metadata: {
    fileId: string;
    name?: string;
    path?: string | null;
    start?: number;
    end?: number;
    chunkIndex?: number;
  };
  score?: number;
  /** Every hit the backend sent for this Page, capped; `content` is the first one's preview. */
  matches?: MarkdownSearchHit[];
  /** Hits found, which can exceed `matches.length` when the previews were capped. */
  matchCount?: number;
}

export interface MarkdownSearchResults {
  results: MarkdownSearchResult[];
}

export interface StorageAdapter {
  readonly mode: WorkspaceMode;

  list(parent?: DocumentHandle | null): Promise<WorkspaceEntry[]>;
  read(handle: DocumentHandle): Promise<DocumentContent>;
  readAsset(path: string): Promise<WorkspaceAssetRead>;
  importAsset(input: WorkspaceAssetImportInput): Promise<WorkspaceAssetImportResult>;
  write(handle: DocumentHandle, content: StorageWriteInput): Promise<DocumentContent>;
  create(input: StorageCreateInput): Promise<WorkspaceEntry>;
  /**
   * Copy a file from outside the workspace into it, always-copy semantics —
   * the source on disk is left intact. Used by sidebar external DnD (#67).
   * Collisions surface as a typed error; collision RESOLUTION (Replace /
   * Keep both / Skip) is the #69 deliverable, not implemented here.
   */
  importExternal?(input: StorageImportInput): Promise<WorkspaceEntry>;
  relocatePage(
    handle: DocumentHandle,
    relocation: PageRelocationInput
  ): Promise<PageRelocationResult>;
  relocateFolder(
    handle: DocumentHandle,
    relocation: FolderRelocationInput
  ): Promise<FolderRelocationResult>;
  renameAttachment(handle: DocumentHandle, name: string): Promise<WorkspaceEntry>;
  moveAttachment(handle: DocumentHandle, parent: DocumentHandle | null): Promise<WorkspaceEntry>;
  delete(handle: DocumentHandle): Promise<void>;
  queryWorkspaceIndex?(query?: WorkspaceIndexQuery): Promise<WorkspaceIndexEntry[]>;
  searchMarkdown?(query: string, options?: MarkdownSearchOptions): Promise<MarkdownSearchResults>;
}
