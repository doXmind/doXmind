/**
 * Folder import — recurse a user-picked local directory and convert every
 * supported file into a doxmind document, preserving the directory tree
 * as nested doxmind folders.
 *
 * Source files arrive as a normalized list of `{file, relPath}` entries
 * where `relPath` is "rootDir/sub/.../filename.ext". Two callers produce
 * this list:
 *   - The folder picker (`<input webkitdirectory>`) — relPath comes from
 *     each File's `webkitRelativePath`.
 *   - Drag-and-drop of a folder — relPath is built by walking the
 *     dropped FileSystemDirectoryEntry tree (see fileEntriesFromDataTransfer).
 *
 * The supported extensions match the server's ALLOWED_EXTENSIONS in
 * server/api/import_file.py — anything else is silently skipped (per
 * product decision, no UI prompt).
 */

const SUPPORTED_EXT = /\.(pdf|docx|pptx|md|markdown)$/i;
const CONCURRENCY = 8;

export interface FolderImportEntry {
  file: File;
  /** Slash-separated path relative to the picked/dropped root, including the filename. */
  relPath: string;
}

export interface FolderImportProgress {
  /** Total files that will be sent to the server (skipped not counted here). */
  total: number;
  /** Imports finished — both successes and failures. */
  done: number;
  succeeded: number;
  failed: number;
  /** Files filtered out before upload because the extension isn't supported. */
  skipped: number;
  /** File currently being processed by any worker (for the spinner label). */
  currentFileName: string | null;
  /** Top-level folder name the user picked (sanitized). */
  rootFolderName: string;
  /** True once all work has settled (or aborted). */
  isComplete: boolean;
  /** True if cancellation was requested via the AbortSignal. */
  cancelled: boolean;
}

export interface FolderImportOptions {
  entries: FolderImportEntry[];
  /** doxmind folder id to import into; null = root. */
  parentId: string | null;
  createFolder: (name: string, parentId: string | null) => Promise<string>;
  importFile: (file: File, parentId: string | null) => Promise<string>;
  onProgress: (p: FolderImportProgress) => void;
  signal?: AbortSignal;
}

/**
 * Strip filesystem-reserved and control characters from a folder/path
 * segment. Local OS folder names can contain anything technically valid
 * on disk; we map those to a safe-ish doxmind name. Falls back to
 * "Untitled" if the result is empty after stripping.
 */
function sanitizeName(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").trim();
  return cleaned || "Untitled";
}

/**
 * Convert a FileList from `<input webkitdirectory>` into the normalized
 * entry shape. Each File's `webkitRelativePath` already starts with the
 * picked folder's name, so we can use it directly.
 */
export function entriesFromFileList(files: FileList): FolderImportEntry[] {
  return Array.from(files).map((file) => ({ file, relPath: file.webkitRelativePath }));
}

/**
 * Read a DataTransfer (from a drop event) into normalized entries.
 * Walks any directory entries via the WebKit FileSystem API. Plain file
 * drops yield entries with relPath = filename only (no parent dir).
 *
 * Returns null when the drop contains no FileSystem entries (drag from
 * an unsupported source). The caller should fall back to the simple
 * single-file flow in that case.
 */
export async function entriesFromDataTransfer(
  dt: DataTransfer
): Promise<FolderImportEntry[] | null> {
  if (!dt.items || dt.items.length === 0) return null;

  // webkitGetAsEntry is non-standard but supported in WKWebView/Chromium.
  // Pull entries up front because DataTransferItemList is invalidated
  // once async work yields control.
  const rawEntries: FileSystemEntry[] = [];
  for (let i = 0; i < dt.items.length; i++) {
    const item = dt.items[i];
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) rawEntries.push(entry);
  }
  if (rawEntries.length === 0) return null;

  const out: FolderImportEntry[] = [];
  for (const entry of rawEntries) {
    await collectEntry(entry, "", out);
  }
  return out;
}

async function collectEntry(
  entry: FileSystemEntry,
  parentPath: string,
  out: FolderImportEntry[]
): Promise<void> {
  const here = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await fileFromEntry(entry as FileSystemFileEntry);
    out.push({ file, relPath: here });
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries yields up to ~100 entries per call; loop until empty.
    while (true) {
      const batch = await readBatch(reader);
      if (batch.length === 0) break;
      for (const child of batch) await collectEntry(child, here, out);
    }
  }
}

function fileFromEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

function readBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    reader.readEntries(resolve, reject);
  });
}

export async function importLocalFolder(opts: FolderImportOptions): Promise<FolderImportProgress> {
  const { entries, parentId, createFolder, importFile, onProgress, signal } = opts;

  // Partition entries into supported (will upload) and skipped.
  const supported: FolderImportEntry[] = [];
  let skipped = 0;
  for (const e of entries) {
    if (SUPPORTED_EXT.test(e.file.name)) supported.push(e);
    else skipped++;
  }

  // Derive root folder name from the first entry's relPath. If the drop
  // was just loose files (no enclosing directory), relPath is just the
  // filename — fall back to "Imported".
  const probe = entries[0]?.relPath ?? "";
  const probeFirstSeg = probe.split("/")[0];
  const hasRootDir = probe.includes("/");
  const rootFolderName = sanitizeName(hasRootDir ? probeFirstSeg : "Imported");

  const progress: FolderImportProgress = {
    total: supported.length,
    done: 0,
    succeeded: 0,
    failed: 0,
    skipped,
    currentFileName: null,
    rootFolderName,
    isComplete: false,
    cancelled: false,
  };
  onProgress({ ...progress });

  // Collect every directory path that needs to exist in doxmind so that
  // each supported file has a parent folder to land in. We include the
  // root segment too (so the import shows up as a top-level folder named
  // after what the user picked, even when importing into doxmind root).
  const dirSet = new Set<string>();
  for (const e of supported) {
    const parts = e.relPath.split("/");
    parts.pop(); // drop the filename
    for (let i = 0; i < parts.length; i++) {
      dirSet.add(parts.slice(0, i + 1).join("/"));
    }
  }
  // Sort by depth so parents are created before children — createFolder
  // needs the parent's doxmind id to exist.
  const dirs = Array.from(dirSet).sort((a, b) => a.split("/").length - b.split("/").length);

  // Map "rootDir/sub/.../seg" -> doxmind folder id.
  const dirToId = new Map<string, string>();
  for (const dir of dirs) {
    if (signal?.aborted) {
      progress.cancelled = true;
      progress.isComplete = true;
      onProgress({ ...progress });
      return progress;
    }
    const parts = dir.split("/");
    const segName = sanitizeName(parts[parts.length - 1]);
    const parentDir = parts.slice(0, -1).join("/");
    const parentDoxmindId = parentDir ? (dirToId.get(parentDir) ?? null) : parentId;
    try {
      const id = await createFolder(segName, parentDoxmindId);
      dirToId.set(dir, id);
    } catch {
      // If a folder fails to create, skip files inside it — they have
      // nowhere to land. Mark them as failed below when they're picked
      // up by a worker.
      dirToId.set(dir, "__FAILED__");
    }
  }

  // Parallel upload pool.
  let cursor = 0;
  async function worker() {
    while (cursor < supported.length) {
      if (signal?.aborted) return;
      const idx = cursor++;
      const e = supported[idx];
      const parts = e.relPath.split("/");
      parts.pop();
      const dirPath = parts.join("/");
      const target = dirPath ? dirToId.get(dirPath) : parentId;

      progress.currentFileName = e.file.name;
      onProgress({ ...progress });

      if (target === "__FAILED__" || target === undefined) {
        progress.failed++;
      } else {
        try {
          await importFile(e.file, target ?? parentId);
          progress.succeeded++;
        } catch {
          progress.failed++;
        }
      }
      progress.done++;
      onProgress({ ...progress });
    }
  }

  const workerCount = Math.max(1, Math.min(CONCURRENCY, supported.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  progress.cancelled = signal?.aborted ?? false;
  progress.isComplete = true;
  progress.currentFileName = null;
  onProgress({ ...progress });
  return progress;
}
