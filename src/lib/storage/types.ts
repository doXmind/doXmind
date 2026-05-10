export type WorkspaceMode = "disk";

export type WorkspaceEntryKind = "document" | "folder";
export type WorkspaceDocumentType = "markdown" | "pdf" | "excel";

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
  /** Backward-compatible alias for editorHtml. */
  html: string;
  editorHtml: string;
  browsingHtml: string;
  markdown: string | null;
  meta?: DocumentMeta;
  extras?: unknown;
  source?: "sidecar" | "markdown" | "empty";
  sourceState?: DocumentSourceState;
  outline?: DocumentOutlineItem[];
  browsingRendererVersion?: string;
  documentType?: WorkspaceDocumentType;
  updatedAt: string;
  /**
   * Block-correlation report from the backend. `null` means no correlator
   * ran (e.g. older clients or non-markdown reads); an empty
   * `{events: [], blocking: false}` means the correlator ran cleanly.
   * Frontend callers can ignore this field — future UI work will surface
   * it. See `docs/adr/0004-custom-block-registry-split-and-correlation.md`.
   */
  correlation?: CorrelationReport | null;
}

export type DocumentSourceState =
  | "sidecar_fresh"
  | "sidecar_stale"
  | "sidecar_missing"
  | "sidecar_corrupt"
  | "empty";

export interface DocumentOutlineItem {
  id: string;
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
}

export type CorrelationEventKind = "orphan" | "duplicate" | "new";

export type HowHandled = "errored" | "discarded" | "created_empty" | "kept" | "skipped" | "deduped";

export interface CorrelationEvent {
  kind: CorrelationEventKind;
  block_type: string;
  id: string;
  how_handled: HowHandled;
  detail: Record<string, unknown>;
}

export interface CorrelationReport {
  events: CorrelationEvent[];
  blocking: boolean;
}

export interface DocumentMeta {
  id: string;
  title?: string | null;
  icon?: string | null;
  favorite?: boolean | null;
  cover?: string | null;
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
  icon?: string | null;
  coverImageUrl?: string | null;
  coverPosition?: number;
}

export interface StorageWriteInput {
  html?: string;
  markdown?: string | null;
  name?: string;
  meta?: DocumentMeta;
  extras?: unknown;
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
   * Populated by the PyMuPDF-backed parse-blocks endpoint. Preserves the
   * original block geometry + lines so export can redact-and-rewrite cleanly.
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
 * Excel editor sidecar state. Stored under the `excel_editor` key in the
 * `.doxmind` sidecar that lives next to the `.xlsx` file. The `.xlsx` itself
 * remains the portable source of truth — `edits` are applied lazily on top of
 * the parsed workbook and flushed back to the binary on export.
 *
 * The `cells` map is keyed by `"${sheetId}!${row},${col}"` (zero-based) so the
 * shape matches the JSON cell model returned by `/api/excel/parse-workbook`.
 * Empty diff slots can simply be omitted; the renderer falls back to the
 * parsed value.
 *
 * Cell coordinates are always interpreted in *post-op* space — i.e. the
 * frontend transforms existing cell keys when a structural op is appended,
 * so the renderer and the backend exporter agree on what `(row, col)` means
 * after `ops` have been replayed.
 */
export interface ExcelEditorState {
  version: 1;
  /** Sheet id of the tab the user had focused last. Restored on reopen. */
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
   * Structural operations applied since the workbook was parsed. Replayed
   * in order on export so openpyxl's `insert_rows` / `delete_rows` /
   * `insert_cols` / `delete_cols` can re-create the user's structural
   * changes against the original `.xlsx`.
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
   * Cell-level notes / comments. Keyed by `${sheetId}!${row},${col}`. The
   * renderer draws a small triangle indicator on the corner of the cell
   * and shows the text on hover; the backend round-trips them through
   * `openpyxl.comments.Comment` so they survive an export.
   */
  comments?: Record<string, ExcelCellComment>;
  /**
   * Per-sheet conditional-formatting rules. Evaluated by the renderer on
   * top of the cell's static style; first matching rule wins (rules
   * earlier in the list take precedence). Round-tripped into openpyxl
   * `ConditionalFormatting` blocks on export.
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
 * Sparse per-side border config. A missing side falls back to the renderer's
 * default gridline (or the parsed-cell border underneath); the picker
 * computes the *full desired* config per cell so the wholesale replace done
 * by `applyCellUpdates` matches the user's intent.
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
  /** Legacy two-state wrap toggle — superseded by `textOverflow` but
   *  kept so older sidecars don't visually drift on reopen. */
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
   * For PDF documents only. When provided, the adapter writes the bytes
   * verbatim instead of going through the Markdown sidecar pipeline.
   */
  documentType?: WorkspaceDocumentType;
  binary?: Uint8Array;
}

export interface StorageImportInput {
  /** Filename including extension. Must end in `.md`, `.pdf`, or `.xlsx`. */
  name: string;
  /** Destination folder (or null for workspace root). */
  parent: DocumentHandle | null;
  /** Absolute source path on disk. Tauri provides this; preferred over bytes. */
  srcPath?: string;
  /** Raw bytes — used in browser dev mode where HTML5 DnD only exposes File objects. */
  bytes?: Uint8Array;
  /**
   * Import mode. `"create"` (the default) refuses to overwrite. `"replace"`
   * (added in #69) overwrites the user file at the destination but leaves the
   * hidden `.doxmind` sidecar untouched — the next open trips the Salvage
   * path, which is the right behavior because at the FS level a Replace is
   * indistinguishable from an external edit.
   */
  mode?: "create" | "replace";
}

/** Discriminator for `ImportError.code` so callers can react without string-matching. */
export type ImportErrorCode = "destination-exists" | "bad-extension" | "no-source" | "unknown";

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
  icon?: string | null;
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

export interface PdfDocStateRead {
  editor: PdfEditorState | null;
  parsedCache: { sourceHash: string; parsed: unknown } | null;
}

export interface ExcelDocStateRead {
  editor: ExcelEditorState | null;
  parsedCache: { sourceHash: string; parsed: unknown } | null;
}

export interface StorageAdapter {
  readonly mode: WorkspaceMode;

  list(parent?: DocumentHandle | null): Promise<WorkspaceEntry[]>;
  read(handle: DocumentHandle): Promise<DocumentContent>;
  write(handle: DocumentHandle, content: StorageWriteInput): Promise<DocumentContent>;
  readBinary?(handle: DocumentHandle): Promise<Uint8Array>;
  /**
   * Cheap (mtime, size) probe for cache invalidation. Used by the PDF/Excel
   * workspace switch caches so that external edits to the source binary
   * surface on the next open. Returns null if the underlying transport
   * doesn't support stat (e.g. browser HTTP fallback). mtime is a decimal
   * string of nanoseconds-since-epoch because Number can't hold ns precision.
   */
  statBinary?(handle: DocumentHandle): Promise<{ mtimeNs: string; size: number } | null>;
  readPdfEditorState?(handle: DocumentHandle): Promise<PdfEditorState | null>;
  writePdfEditorState?(handle: DocumentHandle, state: PdfEditorState): Promise<void>;
  /** Combined sidecar read for PDF open: editor state + parsed-blocks cache. */
  readPdfDocState?(handle: DocumentHandle): Promise<PdfDocStateRead | null>;
  writePdfParsedCache?(handle: DocumentHandle, sourceHash: string, parsed: unknown): Promise<void>;
  readExcelEditorState?(handle: DocumentHandle): Promise<ExcelEditorState | null>;
  writeExcelEditorState?(handle: DocumentHandle, state: ExcelEditorState): Promise<void>;
  /** Combined sidecar read for Excel open: editor state + parsed-workbook cache. */
  readExcelDocState?(handle: DocumentHandle): Promise<ExcelDocStateRead | null>;
  writeExcelParsedCache?(
    handle: DocumentHandle,
    sourceHash: string,
    parsed: unknown
  ): Promise<void>;
  create(input: StorageCreateInput): Promise<WorkspaceEntry>;
  /**
   * Copy a file from outside the workspace into it, always-copy semantics —
   * the source on disk is left intact. Used by sidebar external DnD (#67).
   * Collisions surface as a typed error; collision RESOLUTION (Replace /
   * Keep both / Skip) is the #69 deliverable, not implemented here.
   */
  importExternal?(input: StorageImportInput): Promise<WorkspaceEntry>;
  rename(handle: DocumentHandle, name: string): Promise<WorkspaceEntry>;
  move(handle: DocumentHandle, parent: DocumentHandle | null): Promise<WorkspaceEntry>;
  delete(handle: DocumentHandle): Promise<void>;
  queryWorkspaceIndex?(query?: WorkspaceIndexQuery): Promise<WorkspaceIndexEntry[]>;
  searchMarkdown?(query: string, options?: MarkdownSearchOptions): Promise<MarkdownSearchResults>;
}
