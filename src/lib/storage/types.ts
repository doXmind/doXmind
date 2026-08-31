export type WorkspaceMode = "disk";

// An `asset` is a workspace file doXmind lists but never opens: not a Page, not an Attachment
// workspace. It exists so the tree can show what is actually on disk — images, `.canvas`, `.base`
// — with reveal and open-externally as its only actions.
export type WorkspaceEntryKind = "document" | "folder" | "asset";
export type WorkspacePageType = "markdown";
export type WorkspaceAttachmentType = "pdf" | "excel" | "html";
/** File-format discriminator retained for attachment scanning and legacy compatibility. */
export type WorkspaceDocumentType = WorkspacePageType | WorkspaceAttachmentType;

export type AttachmentRecoveryStatus = "none" | "available" | "unknown";
export type AttachmentSidecarStatus = "missing" | "legacy" | "current" | "unreadable";

/** Result of a strictly read-only legacy-recovery inspection. */
export interface AttachmentInspection {
  documentType: WorkspaceAttachmentType;
  recoveryStatus: AttachmentRecoveryStatus;
  sidecarStatus: AttachmentSidecarStatus;
  sidecarPath: string;
}

/** Exact legacy editor payload read through a strictly zero-write path. */
export interface AttachmentRecoveryRead {
  editor: PdfEditorState | ExcelEditorState | null;
}

export type PageRecoveryStatus = "none" | "available";

/** Read-only inventory of legacy artifacts beside one Markdown Page. */
export interface PageRecoveryInspection {
  recoveryStatus: PageRecoveryStatus;
  artifacts: string[];
}

/** Exact bytes of every inventoried Page recovery artifact. */
export interface PageRecoveryRead {
  artifacts: Array<{
    path: string;
    bytes: number[];
  }>;
}

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
  tags?: string[] | null;
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

export interface PdfEditorState {
  version: 1 | 2;
  edits?: Record<string, { text: string }>;
  textEdits?: Record<
    string,
    {
      pageIndex: number;
      text: string;
      originalText: string;
      x: number;
      y: number;
      width: number;
      height: number;
      fontSize: number;
      originalFontSize?: number;
      fontName?: string;
      fontFamily?: string;
      color?: string;
      bold?: boolean;
      italic?: boolean;
      styleRanges?: PdfTextStyleRange[];
    }
  >;
  /**
   * v2 paragraph-level edits keyed by stable paragraph id (e.g. "p0-b3").
   *
   * Historical paragraph-level edit schema retained so recovery reports can
   * serialize old sidecar payloads without losing fields.
   */
  paragraphEdits?: Record<
    string,
    {
      pageIndex: number;
      text: string;
      originalText: string;
      bbox: { x: number; y: number; width: number; height: number };
      fontSize: number;
      fontFamily?: string;
      color?: string;
      bold?: boolean;
      italic?: boolean;
      textAlign?: "left" | "center" | "right";
      styleRanges?: PdfTextStyleRange[];
      deleted?: boolean;
    }
  >;
  freeText?: Array<{
    id: string;
    pageIndex: number;
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize: number;
    fontFamily?: string;
    color?: string;
    bold?: boolean;
    italic?: boolean;
    textAlign?: "left" | "center" | "right";
    styleRanges?: PdfTextStyleRange[];
  }>;
  highlights?: Array<{
    id: string;
    pageIndex: number;
    x: number;
    y: number;
    width: number;
    height: number;
    color?: string;
    opacity?: number;
  }>;
}

export interface PdfTextStyleRange {
  start: number;
  end: number;
  color?: string;
  highlightColor?: string;
  bold?: boolean;
  italic?: boolean;
}

/**
 * Historical `excel_editor` sidecar payload. The shape remains explicit so a
 * recovery report can preserve every old field; no mounted spreadsheet editor
 * consumes or writes it.
 */
export interface ExcelEditorState {
  version: 1;
  /** Sheet id of the tab the user had focused last. */
  activeSheetId?: string;
  /**
   * Sparse cell-level edits keyed by `"${sheetId}!${row},${col}"`. `value`
   * holds the user-facing string; `formula` (when present) takes precedence
   * during recalculation. `null` value clears the cell.
   */
  cells?: Record<
    string,
    {
      value?: string | number | boolean | null;
      formula?: string | null;
      numberFormat?: string;
      style?: ExcelCellStyle;
    }
  >;
  /** Optional row height overrides keyed by `"${sheetId}!${row}"`. */
  rowHeights?: Record<string, number>;
  /** Optional column width overrides keyed by `"${sheetId}!${col}"`. */
  colWidths?: Record<string, number>;
  /**
   * Structural operations the removed exporter replayed against the original
   * spreadsheet.
   */
  ops?: ExcelStructuralOp[];
  /**
   * Workbook-level operations: add / rename / duplicate / delete sheets.
   * Replayed *before* per-sheet `ops` so that sheet-id targets resolved by
   * the cell/structural-op phases match the post-mutation tabs.
   */
  workbookOps?: ExcelWorkbookOp[];
  /**
   * Per-sheet column filters: when a column entry is present the user has
   * checked a subset of its display values; rows whose cell in that
   * column doesn't appear in the list are hidden. Keys are
   * `${sheetId}!${col}`; values are the *visible* display strings.
   */
  filters?: Record<string, string[]>;
  /** Per-sheet flag: shows the filter ▾ button on column headers. */
  filterMode?: Record<string, boolean>;
  /**
   * Per-sheet freeze settings. `row` rows / `col` columns are pinned to
   * the top-left of the viewport and don't scroll with the rest of the
   * sheet. Keys are sheet ids; missing entry = no freeze.
   */
  frozen?: Record<string, { row: number; col: number }>;
  /**
   * Cell-level data validation rules. Keyed by `${sheetId}!${row},${col}`.
   * Currently only "list" validation is supported — the cell becomes a
   * dropdown picker over the listed values.
   */
  validations?: Record<string, ExcelDataValidation>;
  /**
   * Cell-level notes / comments keyed by `${sheetId}!${row},${col}`.
   */
  comments?: Record<string, ExcelCellComment>;
  /**
   * Per-sheet conditional-formatting rules in the historical editor schema.
   */
  conditionalFormats?: Record<string, ExcelConditionalFormatRule[]>;
}

export interface ExcelCellComment {
  text: string;
  author?: string;
  /** ISO timestamp of last edit. Surfaced in the popover header. */
  updatedAt?: string;
}

export type ExcelConditionalFormatCondition =
  | { kind: "cellValue"; op: "gt" | "lt" | "gte" | "lte" | "eq" | "neq"; value: number | string }
  | { kind: "between"; min: number; max: number; inclusive?: boolean }
  | {
      kind: "containsText";
      text: string;
      mode: "contains" | "notContains" | "startsWith" | "endsWith";
      caseSensitive?: boolean;
    }
  | { kind: "duplicate" }
  | { kind: "unique" }
  | { kind: "blank" }
  | { kind: "notBlank" }
  | {
      kind: "colorScale";
      min: { value?: number; color: string };
      mid?: { value?: number; color: string };
      max: { value?: number; color: string };
    };

export interface ExcelConditionalFormatRule {
  id: string;
  /** Inclusive range over which the rule applies, in post-op coordinates. */
  range: { top: number; left: number; bottom: number; right: number };
  condition: ExcelConditionalFormatCondition;
  /** For non-color-scale rules. Applied on top of the cell's base style. */
  style?: Pick<
    ExcelCellStyle,
    "bold" | "italic" | "underline" | "strikethrough" | "color" | "background"
  >;
}

export interface ExcelDataValidation {
  type: "list";
  /** Allowed display values, in order. */
  values: string[];
}

export type ExcelWorkbookOp =
  | { type: "addSheet"; sheetId: string; name: string; afterSheetId?: string | null }
  | { type: "renameSheet"; sheetId: string; name: string }
  | { type: "duplicateSheet"; sourceSheetId: string; sheetId: string; name: string }
  | { type: "deleteSheet"; sheetId: string };

export type ExcelStructuralOp =
  | { type: "insertRow"; sheetId: string; before: number; count: number }
  | { type: "deleteRow"; sheetId: string; index: number; count: number }
  | { type: "insertCol"; sheetId: string; before: number; count: number }
  | { type: "deleteCol"; sheetId: string; index: number; count: number }
  | {
      type: "mergeCells";
      sheetId: string;
      top: number;
      left: number;
      bottom: number;
      right: number;
    }
  | {
      type: "unmergeCells";
      sheetId: string;
      top: number;
      left: number;
      bottom: number;
      right: number;
    };

export type ExcelBorderLineStyle = "thin" | "medium" | "thick" | "double" | "dashed" | "dotted";

export interface ExcelBorderSide {
  style: ExcelBorderLineStyle;
  color?: string;
}

/**
 * Sparse per-side border config in the historical editor schema.
 */
export interface ExcelBorderConfig {
  top?: ExcelBorderSide;
  right?: ExcelBorderSide;
  bottom?: ExcelBorderSide;
  left?: ExcelBorderSide;
}

export interface ExcelCellStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  color?: string;
  background?: string;
  textAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  /** Legacy two-state wrap toggle retained for lossless recovery. */
  wrapText?: boolean;
  /**
   * Long-text behaviour. `clip` (default) truncates with ellipsis at the
   * cell boundary; `wrap` breaks lines inside the cell; `overflow` lets
   * the text spill outside the cell into adjacent (empty) space, mirroring
   * Sheets / Excel's "Overflow" option.
   */
  textOverflow?: "clip" | "wrap" | "overflow";
  fontSize?: number;
  fontFamily?: string;
  /** Counter-clockwise rotation in degrees, e.g. 0, 45, 90. */
  rotation?: number;
  /** Hyperlink URL — renders the cell as an underlined link. */
  hyperlink?: string;
  border?: ExcelBorderConfig;
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
  inspectPageRecovery(handle: DocumentHandle): Promise<PageRecoveryInspection>;
  readPageRecovery(handle: DocumentHandle): Promise<PageRecoveryRead>;
  inspectAttachment(handle: DocumentHandle): Promise<AttachmentInspection>;
  readAttachmentRecovery?(handle: DocumentHandle): Promise<AttachmentRecoveryRead | null>;
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
