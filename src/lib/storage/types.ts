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
  html: string;
  markdown: string | null;
  meta?: DocumentMeta;
  extras?: unknown;
  source?: "sidecar" | "markdown" | "empty";
  documentType?: WorkspaceDocumentType;
  updatedAt: string;
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
}

export type ExcelStructuralOp =
  | { type: "insertRow"; sheetId: string; before: number; count: number }
  | { type: "deleteRow"; sheetId: string; index: number; count: number }
  | { type: "insertCol"; sheetId: string; before: number; count: number }
  | { type: "deleteCol"; sheetId: string; index: number; count: number };

export interface ExcelCellStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  background?: string;
  textAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  fontSize?: number;
  fontFamily?: string;
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

export interface StorageAdapter {
  readonly mode: WorkspaceMode;

  list(parent?: DocumentHandle | null): Promise<WorkspaceEntry[]>;
  read(handle: DocumentHandle): Promise<DocumentContent>;
  write(handle: DocumentHandle, content: StorageWriteInput): Promise<DocumentContent>;
  readBinary?(handle: DocumentHandle): Promise<Uint8Array>;
  readPdfEditorState?(handle: DocumentHandle): Promise<PdfEditorState | null>;
  writePdfEditorState?(handle: DocumentHandle, state: PdfEditorState): Promise<void>;
  readExcelEditorState?(handle: DocumentHandle): Promise<ExcelEditorState | null>;
  writeExcelEditorState?(handle: DocumentHandle, state: ExcelEditorState): Promise<void>;
  create(input: StorageCreateInput): Promise<WorkspaceEntry>;
  rename(handle: DocumentHandle, name: string): Promise<WorkspaceEntry>;
  move(handle: DocumentHandle, parent: DocumentHandle | null): Promise<WorkspaceEntry>;
  delete(handle: DocumentHandle): Promise<void>;
  queryWorkspaceIndex?(query?: WorkspaceIndexQuery): Promise<WorkspaceIndexEntry[]>;
  searchMarkdown?(query: string, options?: MarkdownSearchOptions): Promise<MarkdownSearchResults>;
}
