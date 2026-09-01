"use strict";

/**
 * Electron's local workspace data plane.
 *
 * The public surface is one async dispatcher with the same command names as
 * the renderer's StorageAdapter. Markdown source is the complete Page state;
 * this module never reads Page HTML from, or writes, a `.doxmind` sidecar.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  capturePageSnapshot,
  listPageSnapshots,
  readPageSnapshot,
} = require("./page-snapshots");
const { TextDecoder } = require("node:util");

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
const DOCUMENT_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".pdf",
  ".xlsx",
  ".xlsm",
  ".csv",
  ".html",
  ".htm",
]);
const IGNORED_SCAN_DIRS = new Set([
  ".doxmind",
  ".git",
  "node_modules",
  "target",
  ".next",
  "out",
  "dist",
  "build",
]);
const PAGE_PROPERTY_KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const PAGE_LIST_METADATA_KEYS = new Set(["tags", "aliases"]);
const IMAGE_ASSET_MIME = new Map([
  [".apng", "image/apng"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".bmp", "image/bmp"],
  [".ico", "image/x-icon"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
]);
const MAX_IMAGE_ASSET_BYTES = 20 * 1024 * 1024;
// Preserve a UTF-8 BOM as U+FEFF so it remains part of the exact Page prefix.
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const NATIVE_WORKSPACE_COMMANDS = new Set([
  "workspace_scan",
  "workspace_markdown_search",
  "page_snapshot_list",
  "page_snapshot_read",
  "doc_read",
  "workspace_read_asset",
  "workspace_import_asset",
  "doc_copy_source",
  "doc_write_workspace",
  "doc_create",
  "doc_rename",
  "doc_move",
  "workspace_relocate_page",
  "workspace_relocate_folder",
  "doc_delete",
  "workspace_create_folder",
  "workspace_delete_folder",
  "doc_import_external",
  "workspace_inspect_page_recovery",
  "workspace_read_page_recovery",
  "workspace_inspect_attachment",
  "workspace_read_attachment_recovery",
]);

function createNativeWorkspaceDispatcher(options = {}) {
  const renamePath =
    options.renamePath || ((source, destination) => fsp.rename(source, destination));
  const writePageBytes = options.writePageBytes || ((target, bytes) => atomicWrite(target, bytes));
  const beforePageReplace = options.beforePageReplace;
  const trashItem =
    options.trashItem ||
    (async () => {
      throw new Error("OS Trash is unavailable for native workspace deletion");
    });

  return async function dispatchNativeWorkspace(command, payload = {}) {
    switch (command) {
      case "workspace_scan":
        return workspaceScan(payload.root, payload.excludeDirs);
      case "page_snapshot_list":
        return listPageSnapshots(
          await resolveExistingWorkspacePath(
            await canonicalWorkspaceRoot(payload.root),
            String(payload.path || "")
          )
        );
      case "page_snapshot_read": {
        const snapshot = await readPageSnapshot(
          await resolveExistingWorkspacePath(
            await canonicalWorkspaceRoot(payload.root),
            String(payload.path || "")
          ),
          payload.id
        );
        // A snapshot is the whole file, frontmatter included, but a Page write takes a body
        // and re-attaches the Page's own frontmatter. Split it here, with the same splitter
        // the writer uses, so restoring cannot write the frontmatter a second time.
        return { ...snapshot, body: splitPageSource(snapshot.markdown).body };
      }
      case "workspace_markdown_search":
        return workspaceMarkdownSearch(
          payload.root,
          payload.query,
          payload.limit,
          payload.criteria
        );
      case "doc_read":
        return readWorkspacePage(payload.root, payload.path);
      case "workspace_read_asset":
        return readWorkspaceAsset(payload.root, payload.path);
      case "workspace_import_asset":
        return importWorkspaceAsset(
          payload.root,
          payload.name,
          payload.bytes,
          payload.destinationDir
        );
      case "doc_copy_source":
        return copyWorkspacePageSource(payload.root, payload.path, payload.destination);
      case "doc_write_workspace":
        return writeWorkspacePage(
          payload.root,
          payload.path,
          payload.payload || {},
          beforePageReplace
        );
      case "doc_create":
        return createWorkspacePage(payload.root, payload.payload || {});
      case "doc_rename":
        return moveAttachmentPair(payload.root, payload.oldPath, payload.newPath, renamePath);
      case "doc_move":
        return moveAttachment(payload.root, payload.oldPath, payload.newPath, renamePath);
      case "workspace_relocate_page":
        return relocatePage(payload.root, payload, renamePath, writePageBytes);
      case "workspace_relocate_folder":
        return relocateFolder(payload.root, payload, renamePath, writePageBytes);
      case "doc_delete":
        return deleteDocument(payload.root, payload.path, trashItem);
      case "workspace_create_folder":
        return createFolder(payload.root, payload.path);
      case "workspace_delete_folder":
        return deleteFolder(payload.root, payload.path, trashItem);
      case "doc_import_external":
        return importExternal(payload);
      case "workspace_inspect_page_recovery":
        return inspectPageRecovery(payload.root, payload.path);
      case "workspace_read_page_recovery":
        return readPageRecovery(payload.root, payload.path);
      case "workspace_inspect_attachment":
        return inspectAttachment(payload.root, payload.path);
      case "workspace_read_attachment_recovery":
        return readAttachmentRecovery(payload.root, payload.path);
      default:
        throw new Error(`unsupported native workspace command: ${command}`);
    }
  };
}

async function workspaceScan(rootValue, excludeDirs) {
  const root = await canonicalWorkspaceRoot(rootValue);
  const ignored = new Set([...IGNORED_SCAN_DIRS, ...sanitizeExcludeDirs(excludeDirs)]);
  const out = { documents: [], folders: [], assets: [] };
  await walkWorkspace(root, root, out, ignored, false);
  const { documents, folders, assets } = out;
  resolveDuplicatePageIds(documents);
  documents.sort((left, right) => {
    const byName = left.name.toLowerCase().localeCompare(right.name.toLowerCase());
    return byName || left.path.localeCompare(right.path);
  });
  const byPath = (left, right) => left.path.localeCompare(right.path);
  folders.sort(byPath);
  assets.sort(byPath);
  return { root, documents, folders, assets };
}

function resolveDuplicatePageIds(documents) {
  const counts = new Map();
  for (const document of documents) {
    if (document.documentType === "markdown" && document.idSource === "frontmatter") {
      counts.set(document.id, (counts.get(document.id) || 0) + 1);
    }
  }
  for (const document of documents) {
    if (document.idSource === "frontmatter" && counts.get(document.id) > 1) {
      document.id = stablePathId(document.path);
      document.idSource = "path";
    }
  }
}

/**
 * Walk the workspace once, collecting Pages/Attachments, real directories, and every other file.
 *
 * Folders used to be inferred from the paths of the documents inside them, so an empty one — or one
 * holding only images — vanished from the sidebar while still sitting on disk. Files outside
 * `DOCUMENT_EXTENSIONS` were dropped outright, which hid `assets/`, the directory doXmind's own
 * image paste writes into, along with the `.canvas` and `.base` files of an imported vault.
 *
 * `hidden` tracks whether any ancestor segment starts with a dot. Descent still follows dot
 * directories, because `.github/README.md` has always been reachable; only the new folder and
 * asset rows skip them, so the tree does not fill up with dotfiles.
 */
async function walkWorkspace(root, current, out, ignored, hidden) {
  const entries = await fsp.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const absolute = path.join(current, entry.name);
    const isDotted = entry.name.startsWith(".");
    if (entry.isDirectory()) {
      if (ignored.has(entry.name)) continue;
      if (!hidden && !isDotted) out.folders.push({ path: relativePath(root, absolute) });
      await walkWorkspace(root, absolute, out, ignored, hidden || isDotted);
      continue;
    }
    if (!entry.isFile() || isHiddenSidecarName(entry.name)) continue;
    if (DOCUMENT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      out.documents.push(await scanDocumentDto(root, absolute));
      continue;
    }
    if (!hidden && !isDotted) {
      out.assets.push({ path: relativePath(root, absolute), name: entry.name });
    }
  }
}

/** User-supplied directory names to skip. Plain names only — no paths, no globs, no patterns. */
function sanitizeExcludeDirs(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((name) => typeof name === "string")
    .map((name) => name.trim())
    .filter((name) => name && name !== "." && name !== ".." && !/[/\\]/.test(name));
}

async function scanDocumentDto(root, absolute) {
  try {
    return await documentDtoForPath(root, absolute);
  } catch (error) {
    // One undecodable Page must not hide every healthy Page in the workspace.
    // The scan falls back to path identity; `doc_read` still refuses the bytes.
    if (error?.code !== "ERR_PAGE_NOT_UTF8") throw error;
    const relPath = relativePath(root, absolute);
    const extension = path.extname(absolute).toLowerCase();
    return {
      id: stablePathId(relPath),
      idSource: "path",
      path: relPath,
      name: path.basename(absolute),
      title: path.basename(absolute, extension),
      documentType: documentTypeForExtension(extension),
    };
  }
}

/**
 * The inline `#tag`s of a Page body.
 *
 * The second implementation of one grammar: this is CommonJS in the main process and cannot import
 * `src/lib/tags.ts`. `tests/fixtures/page-tag-contract.json` is what keeps the two honest.
 *
 * Fenced regions, inline code and link destinations are masked first, so a `#` inside them is not
 * a tag — the same exclusions the renderer's projection makes structurally.
 */
function inlineTagsInBody(body) {
  if (!body) return [];
  const masked = body
    .replace(/^```[\s\S]*?^```/gm, (run) => " ".repeat(run.length))
    .replace(/`[^`\r\n]*`/g, (run) => " ".repeat(run.length))
    .replace(/\[\[[^\]\r\n]*\]\]/g, (run) => " ".repeat(run.length))
    .replace(/\]\([^)\r\n]*\)/g, (run) => " ".repeat(run.length));
  const found = [];
  const pattern = /(^|[\s(（【[「])#([\p{L}\p{N}_\-/]+)/gu;
  for (const match of masked.matchAll(pattern)) {
    const name = match[2];
    if (!/[^\p{Nd}/]/u.test(name)) continue;
    if (name.startsWith("/") || name.endsWith("/") || name.includes("//")) continue;
    found.push(name);
  }
  return found;
}

async function documentDtoForPath(root, absolute) {
  const relPath = relativePath(root, absolute);
  const extension = path.extname(absolute).toLowerCase();
  const documentType = documentTypeForExtension(extension);
  let id = stablePathId(relPath);
  let idSource = "path";
  let title = path.basename(absolute, extension);
  let meta = {};
  let body = "";
  if (documentType === "markdown") {
    const raw = await readUtf8(absolute);
    const split = splitPageSource(raw);
    body = split.body;
    meta = pageMetaProjection(split.meta);
    const sourceId = portablePageId(meta.id);
    if (sourceId) {
      id = sourceId;
      idSource = "frontmatter";
    }
    if (typeof meta.title === "string" && meta.title.trim()) title = meta.title;
  }
  const dto = {
    id,
    idSource,
    path: relPath,
    name: path.basename(absolute),
    title,
    documentType,
  };
  for (const key of ["icon", "cover", "favorite"]) {
    if (meta[key] !== undefined && meta[key] !== null) dto[key] = meta[key];
  }
  if (meta.cover_position !== undefined && meta.cover_position !== null) {
    dto.coverPosition = meta.cover_position;
  }
  // Aliases ride the scan because they are how a Wiki Link resolves. Resolution runs against the
  // whole workspace, not the open Page, so leaving them behind meant `[[Alias]]` could only ever
  // work for a Page the session had already opened — in a fresh window every alias link was dead.
  if (Array.isArray(meta.aliases) && meta.aliases.every((value) => typeof value === "string")) {
    dto.aliases = meta.aliases;
  }
  // Frontmatter tags and the inline `#tag`s in the body, which is what a tag pane counts and what
  // `tag:` searches. Absent rather than empty, so a Page with no tags stays the shape it was.
  const tags = [
    ...(Array.isArray(meta.tags) ? meta.tags.filter((value) => typeof value === "string") : []),
    ...inlineTagsInBody(body),
  ];
  if (tags.length) dto.tags = [...new Set(tags)];
  return dto;
}

async function readPage(absolute) {
  const rawBytes = await fsp.readFile(absolute);
  const raw = decodeUtf8(rawBytes, absolute);
  const split = splitPageSource(raw);
  const markdown = split.body;
  return {
    markdown,
    revision: revisionForBytes(rawBytes),
    meta: pageMetaProjection(split.meta),
    outline: outlineFromMarkdown(markdown),
  };
}

async function readWorkspacePage(rootValue, relPath) {
  const root = await canonicalWorkspaceRoot(rootValue);
  ensureMarkdownPath(relPath);
  return readPage(await resolveExistingWorkspacePath(root, relPath));
}

async function readWorkspaceAsset(rootValue, relPath) {
  const root = await canonicalWorkspaceRoot(rootValue);
  const parts = validateRelativePath(relPath);
  const normalizedPath = parts.join("/");
  const mime = IMAGE_ASSET_MIME.get(path.extname(normalizedPath).toLowerCase());
  if (!mime) throw new Error(`unsupported local image type: ${relPath}`);
  await ensureNoSymlinkPathComponents(root, parts, relPath);
  const absolute = await resolveExistingWorkspacePath(root, normalizedPath);
  const stat = await fsp.stat(absolute);
  if (!stat.isFile()) throw new Error(`image asset is not a file: ${relPath}`);
  if (stat.size <= 0 || stat.size > MAX_IMAGE_ASSET_BYTES) {
    throw new Error(`image asset must be between 1 byte and ${MAX_IMAGE_ASSET_BYTES} bytes`);
  }
  const bytes = await fsp.readFile(absolute);
  if (!imageBytesMatchMime(bytes, mime)) {
    throw new Error(`image asset content does not match image type: ${relPath}`);
  }
  return { path: normalizedPath, mime, base64: bytes.toString("base64") };
}

async function importWorkspaceAsset(rootValue, nameValue, bytesValue, destinationDirValue) {
  const root = await canonicalWorkspaceRoot(rootValue);
  const name = validateImageAssetName(nameValue);
  const mime = IMAGE_ASSET_MIME.get(path.extname(name).toLowerCase());
  const bytes = bytesFromPayload(bytesValue, "image asset");
  if (bytes.length <= 0 || bytes.length > MAX_IMAGE_ASSET_BYTES) {
    throw new Error(`image asset must be between 1 byte and ${MAX_IMAGE_ASSET_BYTES} bytes`);
  }
  if (!imageBytesMatchMime(bytes, mime)) {
    throw new Error(`image asset content does not match image type: ${name}`);
  }

  const destinationDir = destinationDirValue ?? "assets";
  const destinationParts = validateRelativePath(destinationDir);
  await ensureImageAssetDirectory(root, destinationParts);

  const extension = path.extname(name);
  const stem = name.slice(0, -extension.length);
  for (let attempt = 1; ; attempt += 1) {
    const candidateName = attempt === 1 ? name : `${stem} (${attempt})${extension}`;
    const relative = [...destinationParts, candidateName].join("/");
    const absolute = await resolveWorkspacePathForWrite(root, relative);
    try {
      await writeExclusiveImageAsset(absolute, bytes);
      return { path: relative, mime };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = await lstatIfPresent(absolute);
      if (existing?.isSymbolicLink()) {
        throw new Error(`symbolic-link image asset destinations are not allowed: ${relative}`);
      }
    }
  }
}

async function ensureImageAssetDirectory(root, parts) {
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    let stat = await lstatIfPresent(current);
    if (!stat) {
      try {
        await fsp.mkdir(current);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
      stat = await fsp.lstat(current);
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`symbolic-link image asset destinations are not allowed: ${parts.join("/")}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`image asset destination is not a directory: ${parts.join("/")}`);
    }
    ensureWithinRoot(root, await fsp.realpath(current));
  }
}

function validateImageAssetName(nameValue) {
  if (typeof nameValue !== "string" || !nameValue.trim()) {
    throw new Error("image asset name is required");
  }
  if (nameValue.includes("\0") || /[\\/]/.test(nameValue)) {
    throw new Error(`image asset name must be a file name: ${nameValue}`);
  }
  if (/[?#\u0000-\u001f\u007f]/.test(nameValue)) {
    throw new Error(
      `image asset name cannot be represented by a Markdown image destination: ${nameValue}`
    );
  }
  const extension = path.extname(nameValue).toLowerCase();
  if (!IMAGE_ASSET_MIME.has(extension) || !path.basename(nameValue, extension)) {
    throw new Error(`unsupported local image type: ${nameValue}`);
  }
  return nameValue;
}

async function writeExclusiveImageAsset(target, bytes) {
  let handle;
  let created = false;
  try {
    handle = await fsp.open(target, "wx", 0o600);
    created = true;
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    await handle?.close().catch(() => {});
    handle = null;
    if (created) await fsp.unlink(target).catch(() => {});
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function ensureNoSymlinkPathComponents(root, parts, relPath) {
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    const stat = await fsp.lstat(current).catch((error) => {
      if (error?.code === "ENOENT") throw new Error(`workspace path does not exist: ${relPath}`);
      throw error;
    });
    if (stat.isSymbolicLink()) {
      throw new Error(`symbolic-link image assets are not allowed: ${relPath}`);
    }
  }
}

function imageBytesMatchMime(bytes, mime) {
  if (mime === "image/png" || mime === "image/apng") {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  }
  if (mime === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mime === "image/gif") {
    return bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6));
  }
  if (mime === "image/bmp") {
    return bytes.length >= 2 && bytes.toString("ascii", 0, 2) === "BM";
  }
  if (mime === "image/x-icon") {
    return bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]));
  }
  if (mime === "image/webp") {
    return (
      bytes.length >= 12 &&
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP"
    );
  }
  if (mime === "image/avif") {
    const brand = bytes.length >= 12 ? bytes.toString("ascii", 8, 12) : "";
    return (
      bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp" && /^(avif|avis)$/.test(brand)
    );
  }
  return false;
}

async function copyWorkspacePageSource(rootValue, relPath, destinationValue) {
  const root = await canonicalWorkspaceRoot(rootValue);
  ensureMarkdownPath(relPath);
  const source = await resolveExistingWorkspacePath(root, relPath);
  const destinationText = String(destinationValue || "");
  if (!path.isAbsolute(destinationText)) {
    throw new Error("Markdown source copy destination must be an absolute path");
  }
  ensureMarkdownPath(destinationText);
  const destination = path.resolve(destinationText);
  const destinationState = await lstatIfPresent(destination);
  if (destinationState) throw new Error(`export target already exists: ${destination}`);
  const parentState = await fsp.lstat(path.dirname(destination));
  if (!parentState.isDirectory() || parentState.isSymbolicLink()) {
    throw new Error(
      `export destination parent must be a real directory: ${path.dirname(destination)}`
    );
  }

  const bytes = await fsp.readFile(source);
  await atomicWrite(destination, bytes, { exclusive: true });
  return { path: destination, bytes: bytes.length };
}

async function writeWorkspacePage(rootValue, relPath, payload, beforePageReplace) {
  const root = await canonicalWorkspaceRoot(rootValue);
  ensureMarkdownPath(relPath);
  const absolute = await resolveWorkspacePathForWrite(root, relPath);
  let existingBytes = null;
  let split = { prefix: null, body: "", meta: {} };
  try {
    existingBytes = await fsp.readFile(absolute);
    split = splitPageSource(decodeUtf8(existingBytes, absolute));
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
  }
  const actualRevision = existingBytes ? revisionForBytes(existingBytes) : null;
  if (payload.expectedRevision != null && payload.expectedRevision !== actualRevision) {
    throw new Error(
      `page_revision_conflict: expected ${payload.expectedRevision}, actual ${actualRevision || "missing"} for ${absolute}`
    );
  }
  if (payload.markdown !== undefined && typeof payload.markdown !== "string") {
    throw new Error("Page markdown must be a string");
  }
  const markdown = payload.markdown === undefined ? split.body : payload.markdown;
  let metaPatch = payload.meta && typeof payload.meta === "object" ? { ...payload.meta } : null;
  if (existingBytes && metaPatch) {
    // Page identity is owned by the existing source. Callers commonly include
    // the current handle id in metadata updates; treating that as a patch
    // would rewrite a hand-authored valid/invalid `id` scalar.
    delete metaPatch.id;
  } else if (!existingBytes && (!metaPatch || !portablePageId(metaPatch.id))) {
    metaPatch = { ...(metaPatch || {}), id: crypto.randomUUID() };
  }
  const prefix = patchFrontmatterPrefix(split.prefix, metaPatch);
  const nextBytes = Buffer.from(`${prefix ?? ""}${markdown}`, "utf8");
  // The state *before* this write, so an accidental overwrite has something to come back to.
  // Only the ordinary Page write snapshots: link-repair writes go through `writePageBytes`, and
  // deletion is already covered by the OS Trash.
  if (existingBytes && !existingBytes.equals(nextBytes)) {
    await capturePageSnapshot(absolute, existingBytes);
  }
  await atomicWrite(absolute, nextBytes, {
    expectedRevision: payload.expectedRevision,
    beforeReplace: beforePageReplace,
  });
  return readPage(absolute);
}

async function createWorkspacePage(rootValue, payload) {
  const root = await canonicalWorkspaceRoot(rootValue);
  const relPath = String(payload.path || "");
  ensureMarkdownPath(relPath);
  const absolute = await resolveWorkspacePathForWrite(root, relPath);
  // Creation refuses to overwrite unless the caller already collected the
  // user's consent for this exact destination — the native Save panel asks
  // "replace?" itself and only returns a path once the user said yes. Every
  // other create path keeps the default refusal.
  const replaceExisting = payload.replaceExisting === true;
  const existing = await lstatIfPresent(absolute);
  if (existing && !(replaceExisting && existing.isFile())) {
    throw new Error(`document already exists: ${relPath}`);
  }
  const meta = payload.meta && typeof payload.meta === "object" ? { ...payload.meta } : {};
  const pageId = String(meta.id || crypto.randomUUID());
  if (!pageId.trim() || !/^[A-Za-z0-9._:-]+$/.test(pageId)) {
    throw new Error("page id contains unsupported characters");
  }
  meta.id = pageId;
  const prefix = patchFrontmatterPrefix(null, meta);
  const markdown = String(payload.markdown || "");
  await atomicWrite(
    absolute,
    Buffer.from(`${prefix}${markdown}`, "utf8"),
    replaceExisting ? {} : { exclusive: true }
  );
  const scan = await workspaceScan(root);
  const created = scan.documents.find(
    (document) => document.path === normalizeRelativePath(relPath)
  );
  if (!created) throw new Error(`created Page missing from refreshed scan: ${relPath}`);
  return created;
}

async function moveDocumentPair(rootValue, oldRelPath, newRelPath, renamePath) {
  const root = await canonicalWorkspaceRoot(rootValue);
  ensureSameDocumentExtension(oldRelPath, newRelPath);
  const source = await resolveExistingWorkspacePath(root, oldRelPath);
  const sourceStat = await fsp.stat(source);
  if (!sourceStat.isFile()) throw new Error(`document is not a file: ${oldRelPath}`);
  // Validate the post-move DTO inputs before mutating any path. In particular,
  // an invalid UTF-8 Page must fail while every source-family member is still
  // at its original location.
  await documentDtoForPath(root, source);
  const destination = await resolveWorkspacePathForWrite(root, newRelPath);
  // A case-only rename on a case-insensitive filesystem sees the moved
  // Attachment itself at the destination; only a different entry collides.
  if (fs.existsSync(destination) && !(await isSameFilesystemEntry(source, destination))) {
    throw new Error(`destination already exists: ${newRelPath}`);
  }

  const sourceSidecar = sidecarPathFor(source);
  const destinationSidecar = sidecarPathFor(destination);
  const sourceFamily = await sidecarFamilyPaths(source);
  const destinationFamily = await sidecarFamilyPaths(destination);
  if (destinationFamily.length) {
    throw new Error(
      `destination sidecar family already exists: ${destinationFamily
        .map((member) => relativePath(root, member))
        .join(", ")}`
    );
  }

  const movePlan = [
    { source, destination },
    ...sourceFamily.map((member) => ({
      source: member,
      destination: `${destinationSidecar}${path.basename(member).slice(path.basename(sourceSidecar).length)}`,
    })),
  ];
  const createdDirectories = await createMissingParentDirectories(root, path.dirname(destination));
  const moved = [];
  try {
    for (const pair of movePlan) {
      await renamePath(pair.source, pair.destination);
      moved.push(pair);
    }
    return await documentDtoForPath(root, destination);
  } catch (error) {
    const rollbackErrors = [];
    for (const pair of moved.reverse()) {
      try {
        await renamePath(pair.destination, pair.source);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError.message);
      }
    }
    if (!rollbackErrors.length) {
      for (const directory of createdDirectories) {
        await fsp.rmdir(directory).catch(() => {});
      }
      throw new Error(`document move failed and was rolled back: ${error.message}`);
    }
    throw new Error(
      `document move failed and rollback was incomplete: ${error.message}; ${rollbackErrors.join("; ")}`
    );
  }
}

async function moveAttachment(root, oldRelPath, newRelPath, renamePath) {
  const document = await moveAttachmentPair(root, oldRelPath, newRelPath, renamePath);
  return { kind: "document", ...document };
}

async function moveAttachmentPair(rootValue, oldRelPath, newRelPath, renamePath) {
  const root = await canonicalWorkspaceRoot(rootValue);
  const source = await resolveExistingWorkspacePath(root, oldRelPath);
  if ((await fsp.stat(source)).isDirectory()) {
    throw new Error("Folder rename/move must use workspace_relocate_folder");
  }
  if (MARKDOWN_EXTENSIONS.has(path.extname(source).toLowerCase())) {
    throw new Error("Page rename/move must use workspace_relocate_page");
  }
  return moveDocumentPair(root, oldRelPath, newRelPath, renamePath);
}

async function prepareRelocationChecks(root, inputs, operation) {
  if (!Array.isArray(inputs)) throw new Error(`${operation} checks must be an array`);
  const checkedPages = new Map();
  for (const input of inputs) {
    if (!input || typeof input !== "object") throw new Error(`invalid ${operation} check`);
    const relPath = normalizeRelativePath(String(input.path || ""));
    ensureMarkdownPath(relPath);
    if (checkedPages.has(relPath)) throw new Error(`duplicate ${operation} check: ${relPath}`);
    if (typeof input.expectedRevision !== "string" || !input.expectedRevision) {
      throw new Error(`${operation} check requires a revision: ${relPath}`);
    }
    const absolute = await resolveExistingWorkspacePath(root, relPath);
    if (!(await fsp.stat(absolute)).isFile()) throw new Error(`Page is not a file: ${relPath}`);
    const bytes = await fsp.readFile(absolute);
    decodeUtf8(bytes, absolute);
    const revision = revisionForBytes(bytes);
    if (revision !== input.expectedRevision) {
      throw new Error(
        `page_revision_conflict: expected ${input.expectedRevision}, actual ${revision} for ${absolute}`
      );
    }
    checkedPages.set(relPath, { absolute, bytes, revision });
  }
  await assertCompleteRelocationTopology(root, checkedPages, operation);
  return checkedPages;
}

async function assertCompleteRelocationTopology(root, checkedPages, operation) {
  const scan = await workspaceScan(root);
  const currentPages = scan.documents
    .filter((document) => document.documentType === "markdown")
    .map((document) => normalizeRelativePath(document.path));
  const currentSet = new Set(currentPages);
  const missingChecks = currentPages.filter((pagePath) => !checkedPages.has(pagePath));
  const missingPages = [...checkedPages.keys()].filter((pagePath) => !currentSet.has(pagePath));
  if (missingChecks.length || missingPages.length) {
    throw new Error(
      `${operation} topology changed: ` +
        [
          missingChecks.length ? `unplanned Pages ${missingChecks.join(", ")}` : "",
          missingPages.length ? `missing Pages ${missingPages.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("; ")
    );
  }
}

async function revalidateRelocationChecks(root, checkedPages, operation) {
  await assertCompleteRelocationTopology(root, checkedPages, operation);
  for (const [relPath, checked] of checkedPages) {
    const bytes = await fsp.readFile(checked.absolute);
    if (!bytes.equals(checked.bytes)) {
      throw new Error(
        `${operation} check ${relPath} became stale: page_revision_conflict: expected ${checked.revision}, actual ${revisionForBytes(bytes)} for ${checked.absolute}`
      );
    }
  }
}

async function relocatePage(rootValue, payload, renamePath, writePageBytes) {
  const root = await canonicalWorkspaceRoot(rootValue);
  const oldRelPath = normalizeRelativePath(String(payload.oldPath || ""));
  const newRelPath = normalizeRelativePath(String(payload.newPath || ""));
  ensureMarkdownPath(oldRelPath);
  ensureMarkdownPath(newRelPath);
  if (oldRelPath === newRelPath) throw new Error("Page relocation requires a new path");
  if (typeof payload.expectedRevision !== "string" || !payload.expectedRevision) {
    throw new Error("Page relocation requires the moved Page revision");
  }

  const source = await resolveExistingWorkspacePath(root, oldRelPath);
  const sourceStat = await fsp.stat(source);
  if (!sourceStat.isFile()) throw new Error(`Page is not a file: ${oldRelPath}`);
  const sourceBytes = await fsp.readFile(source);
  const sourceRevision = revisionForBytes(sourceBytes);
  if (payload.expectedRevision !== sourceRevision) {
    throw new Error(
      `page_revision_conflict: expected ${payload.expectedRevision}, actual ${sourceRevision} for ${source}`
    );
  }
  await documentDtoForPath(root, source);
  const checkedPages = await prepareRelocationChecks(root, payload.checks, "Page relocation");
  const sourceCheck = checkedPages.get(oldRelPath);
  if (!sourceCheck || sourceCheck.revision !== payload.expectedRevision) {
    throw new Error(
      `Page relocation moved source is missing its matching topology check: ${oldRelPath}`
    );
  }

  const destination = await resolveWorkspacePathForWrite(root, newRelPath);
  // A case-only rename on a case-insensitive filesystem sees the moved Page
  // itself at the destination; only a different entry is a real collision.
  if (fs.existsSync(destination) && !(await isSameFilesystemEntry(source, destination))) {
    throw new Error(`destination already exists: ${newRelPath}`);
  }
  const sourceSidecar = sidecarPathFor(source);
  const destinationSidecar = sidecarPathFor(destination);
  const sourceFamily = await sidecarFamilyPaths(source);
  const destinationFamily = await sidecarFamilyPaths(destination);
  if (destinationFamily.length) {
    throw new Error(
      `destination sidecar family already exists: ${destinationFamily
        .map((member) => relativePath(root, member))
        .join(", ")}`
    );
  }

  if (payload.writes !== undefined && !Array.isArray(payload.writes)) {
    throw new Error("Page relocation writes must be an array");
  }
  if (payload.movedMarkdown !== undefined && typeof payload.movedMarkdown !== "string") {
    throw new Error("Page relocation movedMarkdown must be Markdown");
  }
  const movedWrite =
    payload.movedMarkdown === undefined
      ? null
      : (() => {
          const split = splitPageSource(decodeUtf8(sourceBytes, source));
          const outputBytes = Buffer.from(`${split.prefix ?? ""}${payload.movedMarkdown}`, "utf8");
          return {
            path: newRelPath,
            beforeBytes: sourceBytes,
            afterAbsolute: destination,
            outputBytes,
            outputRevision: revisionForBytes(outputBytes),
          };
        })();
  const seenWritePaths = new Set();
  const writes = [];
  for (const input of payload.writes || []) {
    if (!input || typeof input !== "object") throw new Error("invalid Page relocation write");
    const afterRelPath = normalizeRelativePath(String(input.path || ""));
    ensureMarkdownPath(afterRelPath);
    if (seenWritePaths.has(afterRelPath)) {
      throw new Error(`duplicate Page relocation write: ${afterRelPath}`);
    }
    seenWritePaths.add(afterRelPath);
    if (afterRelPath === oldRelPath || afterRelPath === newRelPath) {
      throw new Error(`moved Page repairs must use movedMarkdown: ${newRelPath}`);
    }
    if (typeof input.expectedRevision !== "string" || !input.expectedRevision) {
      throw new Error(`Page relocation write requires a revision: ${afterRelPath}`);
    }
    if (typeof input.markdown !== "string") {
      throw new Error(`Page relocation write requires Markdown: ${afterRelPath}`);
    }

    const beforeAbsolute = await resolveExistingWorkspacePath(root, afterRelPath);
    const afterAbsolute = beforeAbsolute;
    const beforeStat = await fsp.stat(beforeAbsolute);
    if (!beforeStat.isFile()) throw new Error(`Page is not a file: ${afterRelPath}`);
    const beforeBytes = await fsp.readFile(beforeAbsolute);
    const actualRevision = revisionForBytes(beforeBytes);
    if (input.expectedRevision !== actualRevision) {
      throw new Error(
        `page_revision_conflict: expected ${input.expectedRevision}, actual ${actualRevision} for ${beforeAbsolute}`
      );
    }
    const checked = checkedPages.get(afterRelPath);
    if (!checked || checked.revision !== input.expectedRevision) {
      throw new Error(
        `Page relocation write is missing its matching topology check: ${afterRelPath}`
      );
    }
    const split = splitPageSource(decodeUtf8(beforeBytes, beforeAbsolute));
    const outputBytes = Buffer.from(`${split.prefix ?? ""}${input.markdown}`, "utf8");
    writes.push({
      path: afterRelPath,
      beforeBytes,
      afterAbsolute,
      outputBytes,
      outputRevision: revisionForBytes(outputBytes),
    });
  }

  const movePlan = [
    { source, destination },
    ...sourceFamily.map((member) => ({
      source: member,
      destination: `${destinationSidecar}${path.basename(member).slice(path.basename(sourceSidecar).length)}`,
    })),
  ];
  await revalidateRelocationChecks(root, checkedPages, "Page relocation");
  const createdDirectories = await createMissingParentDirectories(root, path.dirname(destination));
  const moved = [];
  const written = [];
  try {
    for (const pair of movePlan) {
      await renamePath(pair.source, pair.destination);
      moved.push(pair);
    }
    if (movedWrite) {
      await writePageBytes(movedWrite.afterAbsolute, movedWrite.outputBytes);
      written.push(movedWrite);
    }
    for (const write of writes) {
      await writePageBytes(write.afterAbsolute, write.outputBytes);
      written.push(write);
    }
    const document = await documentDtoForPath(root, destination);
    return {
      document,
      revision: movedWrite?.outputRevision ?? sourceRevision,
      writes: writes.map((write) => ({ path: write.path, revision: write.outputRevision })),
    };
  } catch (error) {
    const rollbackErrors = [];
    for (const write of written.reverse()) {
      try {
        const currentBytes = await fsp.readFile(write.afterAbsolute);
        if (revisionForBytes(currentBytes) !== write.outputRevision) {
          rollbackErrors.push(`${write.path}: changed during relocation`);
          continue;
        }
        await writePageBytes(write.afterAbsolute, write.beforeBytes);
      } catch (rollbackError) {
        rollbackErrors.push(`${write.path}: ${rollbackError.message}`);
      }
    }
    for (const pair of moved.reverse()) {
      try {
        await renamePath(pair.destination, pair.source);
      } catch (rollbackError) {
        rollbackErrors.push(`${relativePath(root, pair.destination)}: ${rollbackError.message}`);
      }
    }
    if (!rollbackErrors.length) {
      for (const directory of createdDirectories) await fsp.rmdir(directory).catch(() => {});
      throw new Error(`Page relocation failed and was rolled back: ${error.message}`);
    }
    throw new Error(
      `Page relocation failed and rollback was incomplete: ${error.message}; ${rollbackErrors.join("; ")}`
    );
  }
}

async function relocateFolder(rootValue, payload, renamePath, writePageBytes) {
  const root = await canonicalWorkspaceRoot(rootValue);
  const oldRelPath = normalizeRelativePath(String(payload.oldPath || ""));
  const newRelPath = normalizeRelativePath(String(payload.newPath || ""));
  if (oldRelPath === newRelPath) throw new Error("Folder relocation requires a new path");
  if (newRelPath.startsWith(`${oldRelPath}/`)) {
    throw new Error("Folder cannot be relocated inside itself");
  }
  const source = await resolveExistingWorkspacePath(root, oldRelPath);
  if (!(await fsp.stat(source)).isDirectory()) {
    throw new Error(`folder is not a directory: ${oldRelPath}`);
  }
  const destination = await resolveWorkspacePathForWrite(root, newRelPath);
  // A case-only rename on a case-insensitive filesystem sees the moved folder
  // itself at the destination; only a different entry is a real collision.
  if (fs.existsSync(destination) && !(await isSameFilesystemEntry(source, destination))) {
    throw new Error(`destination already exists: ${newRelPath}`);
  }

  const checkedPages = await prepareRelocationChecks(root, payload.checks, "Folder relocation");

  if (!Array.isArray(payload.writes)) throw new Error("Folder relocation writes must be an array");
  const seenSources = new Set();
  const seenDestinations = new Set();
  const writes = [];
  for (const input of payload.writes) {
    if (!input || typeof input !== "object") throw new Error("invalid Folder relocation write");
    const sourcePath = normalizeRelativePath(String(input.sourcePath || ""));
    const destinationPath = normalizeRelativePath(String(input.destinationPath || ""));
    ensureMarkdownPath(sourcePath);
    ensureMarkdownPath(destinationPath);
    if (seenSources.has(sourcePath))
      throw new Error(`duplicate Folder relocation write: ${sourcePath}`);
    if (seenDestinations.has(destinationPath)) {
      throw new Error(`duplicate Folder relocation destination: ${destinationPath}`);
    }
    seenSources.add(sourcePath);
    seenDestinations.add(destinationPath);
    if (typeof input.expectedRevision !== "string" || !input.expectedRevision) {
      throw new Error(`Folder relocation write requires a revision: ${sourcePath}`);
    }
    if (typeof input.markdown !== "string") {
      throw new Error(`Folder relocation write requires Markdown: ${sourcePath}`);
    }
    const checked = checkedPages.get(sourcePath);
    if (!checked || checked.revision !== input.expectedRevision) {
      throw new Error(
        `Folder relocation write is missing its matching topology check: ${sourcePath}`
      );
    }
    const movedSource = sourcePath === oldRelPath || sourcePath.startsWith(`${oldRelPath}/`);
    const expectedDestination = movedSource
      ? `${newRelPath}${sourcePath.slice(oldRelPath.length)}`
      : sourcePath;
    if (destinationPath !== expectedDestination) {
      throw new Error(
        `Folder relocation write path mismatch: ${sourcePath} -> ${destinationPath}, expected ${expectedDestination}`
      );
    }
    const afterAbsolute = movedSource
      ? path.join(destination, ...sourcePath.slice(oldRelPath.length).split("/").filter(Boolean))
      : checked.absolute;
    const split = splitPageSource(decodeUtf8(checked.bytes, checked.absolute));
    const outputBytes = Buffer.from(`${split.prefix ?? ""}${input.markdown}`, "utf8");
    writes.push({
      sourcePath,
      destinationPath,
      afterAbsolute,
      beforeBytes: checked.bytes,
      outputBytes,
      outputRevision: revisionForBytes(outputBytes),
    });
  }

  await revalidateRelocationChecks(root, checkedPages, "Folder relocation");
  const createdDirectories = await createMissingParentDirectories(root, path.dirname(destination));
  let moved = false;
  const written = [];
  try {
    await renamePath(source, destination);
    moved = true;
    for (const write of writes) {
      await writePageBytes(write.afterAbsolute, write.outputBytes);
      written.push(write);
    }
    return {
      path: newRelPath,
      writes: writes.map((write) => ({
        path: write.destinationPath,
        revision: write.outputRevision,
      })),
    };
  } catch (error) {
    const rollbackErrors = [];
    for (const write of written.reverse()) {
      try {
        const currentBytes = await fsp.readFile(write.afterAbsolute);
        if (revisionForBytes(currentBytes) !== write.outputRevision) {
          rollbackErrors.push(`${write.destinationPath}: changed during relocation`);
          continue;
        }
        await writePageBytes(write.afterAbsolute, write.beforeBytes);
      } catch (rollbackError) {
        rollbackErrors.push(`${write.destinationPath}: ${rollbackError.message}`);
      }
    }
    if (moved) {
      try {
        await renamePath(destination, source);
      } catch (rollbackError) {
        rollbackErrors.push(`${newRelPath}: ${rollbackError.message}`);
      }
    }
    if (!rollbackErrors.length) {
      for (const directory of createdDirectories) await fsp.rmdir(directory).catch(() => {});
      throw new Error(`Folder relocation failed and was rolled back: ${error.message}`);
    }
    throw new Error(
      `folder_relocation_rollback_incomplete: ${error.message}; ${rollbackErrors.join("; ")}`
    );
  }
}

async function deleteDocument(rootValue, relPath, trashItem) {
  const root = await canonicalWorkspaceRoot(rootValue);
  const source = await resolveExistingWorkspacePath(root, relPath);
  const stat = await fsp.stat(source);
  if (!stat.isFile()) throw new Error(`document is not a file: ${relPath}`);
  const extension = path.extname(source).toLowerCase();
  if (!DOCUMENT_EXTENSIONS.has(extension)) {
    throw new Error(`unsupported workspace document: ${relPath}`);
  }
  const sidecar = sidecarPathFor(source);
  const sidecarFamily = await sidecarFamilyPaths(source);
  const sidecarExists = sidecarFamily.includes(sidecar);
  const sidecarRel = sidecarExists ? relativePath(root, sidecar) : null;
  await trashItem(source);
  for (const familyMember of sidecarFamily) {
    try {
      await trashItem(familyMember);
    } catch (error) {
      throw new Error(
        `document moved to Trash but legacy sidecar family trash failed at ${familyMember}: ${error.message}`
      );
    }
  }
  return { path: normalizeRelativePath(relPath), sidecarPath: sidecarRel };
}

async function createFolder(rootValue, relPath) {
  const root = await canonicalWorkspaceRoot(rootValue);
  const destination = await resolveWorkspacePathForWrite(root, relPath);
  if (fs.existsSync(destination)) throw new Error(`folder already exists: ${relPath}`);
  await fsp.mkdir(destination, { recursive: true });
  return null;
}

async function deleteFolder(rootValue, relPath, trashItem) {
  const root = await canonicalWorkspaceRoot(rootValue);
  const source = await resolveExistingWorkspacePath(root, relPath);
  if (!(await fsp.stat(source)).isDirectory()) {
    throw new Error(`folder is not a directory: ${relPath}`);
  }
  await trashItem(source);
  return { path: normalizeRelativePath(relPath), sidecarPath: null };
}

async function importExternal(payload) {
  const root = await canonicalWorkspaceRoot(payload.root);
  const name = String(payload.name || "");
  if (!name.trim()) throw new Error("import name is required");
  if (name !== path.basename(name) || name.includes("\\")) {
    throw new Error(`import name must be a filename: ${name}`);
  }
  const extension = path.extname(name).toLowerCase();
  if (![".md", ".markdown", ".pdf", ".xlsx", ".csv"].includes(extension)) {
    throw new Error(
      `only .md, .markdown, .pdf, .xlsx, .csv are supported for external import: ${name}`
    );
  }
  const mode = String(payload.mode || "create");
  if (!new Set(["create", "replace"]).has(mode)) {
    throw new Error(`unsupported import mode: ${mode}`);
  }
  const folder = payload.destFolder ? normalizeRelativePath(String(payload.destFolder)) : "";
  const relPath = folder ? `${folder}/${name}` : name;
  const destination = await resolveWorkspacePathForWrite(root, relPath);
  const exists = fs.existsSync(destination);
  if (mode === "create" && exists) throw new Error(`destination already exists: ${relPath}`);
  if (mode === "replace" && !exists) {
    throw new Error(`destination does not exist for replace: ${relPath}`);
  }

  let bytes;
  if (payload.bytes !== undefined && payload.bytes !== null) {
    bytes = bytesFromPayload(payload.bytes, "import");
  } else if (typeof payload.srcPath === "string" && payload.srcPath.trim()) {
    const source = path.resolve(payload.srcPath);
    const stat = await fsp.stat(source).catch(() => null);
    if (!stat || !stat.isFile()) throw new Error(`source file does not exist: ${payload.srcPath}`);
    bytes = await fsp.readFile(source);
  } else {
    throw new Error("doc_import_external requires either srcPath or bytes");
  }
  await atomicWrite(destination, bytes, { exclusive: mode === "create" });
  const importedPath = relativePath(root, destination);
  const scan = await workspaceScan(root);
  const imported = scan.documents.find((document) => document.path === importedPath);
  if (!imported) throw new Error(`imported document missing from refreshed scan: ${importedPath}`);
  return imported;
}

async function inspectPageRecovery(rootValue, relPath) {
  const { root, artifacts } = await pageRecoveryFamily(rootValue, relPath);
  return {
    recoveryStatus: artifacts.length ? "available" : "none",
    artifacts: artifacts.map((artifact) => relativePath(root, artifact)),
  };
}

async function readPageRecovery(rootValue, relPath) {
  const { root, artifacts } = await pageRecoveryFamily(rootValue, relPath);
  return {
    artifacts: await Promise.all(
      artifacts.map(async (artifact) => ({
        path: relativePath(root, artifact),
        bytes: [...(await fsp.readFile(artifact))],
      }))
    ),
  };
}

async function pageRecoveryFamily(rootValue, relPath) {
  const root = await canonicalWorkspaceRoot(rootValue);
  ensureMarkdownPath(relPath);
  const source = await resolveExistingWorkspacePath(root, relPath);
  if (!(await fsp.stat(source)).isFile()) throw new Error(`Page path is not a file: ${relPath}`);
  return { root, artifacts: await sidecarFamilyPaths(source) };
}

async function inspectAttachment(rootValue, relPath) {
  const root = await canonicalWorkspaceRoot(rootValue);
  const source = await resolveExistingWorkspacePath(root, relPath);
  const kind = attachmentKind(source);
  const sidecar = sidecarPathFor(source);
  const backup = `${sidecar}.bak`;
  const sidecarState = await attachmentArtifactState(sidecar);
  const backupState = await attachmentArtifactState(backup);
  if (sidecarState === "unsafe") {
    return {
      documentType: kind,
      recoveryStatus: "unknown",
      sidecarStatus: "unreadable",
      sidecarPath: path.basename(sidecar),
    };
  }
  if (sidecarState === "missing") {
    return {
      documentType: kind,
      recoveryStatus: backupState === "missing" ? "none" : "unknown",
      sidecarStatus: "missing",
      sidecarPath: path.basename(sidecar),
    };
  }
  if (kind === "html") {
    return {
      documentType: kind,
      recoveryStatus: "none",
      sidecarStatus: "current",
      sidecarPath: path.basename(sidecar),
    };
  }
  try {
    const state = await loadAttachmentRecoveryState(source, kind);
    let recoveryStatus = recoveryStatusForEditor(kind, state.editor);
    if (recoveryStatus === "none" && backupState !== "missing") recoveryStatus = "unknown";
    return {
      documentType: kind,
      recoveryStatus,
      sidecarStatus: state.format,
      sidecarPath: path.basename(sidecar),
    };
  } catch {
    return {
      documentType: kind,
      recoveryStatus: "unknown",
      sidecarStatus: "unreadable",
      sidecarPath: path.basename(sidecar),
    };
  }
}

async function readAttachmentRecovery(rootValue, relPath) {
  const root = await canonicalWorkspaceRoot(rootValue);
  const source = await resolveExistingWorkspacePath(root, relPath);
  const kind = attachmentKind(source);
  if (kind !== "pdf" && kind !== "excel") {
    throw new Error("attachment recovery requires a PDF or spreadsheet");
  }
  const sidecar = sidecarPathFor(source);
  const artifactState = await attachmentArtifactState(sidecar);
  if (artifactState === "missing") return null;
  if (artifactState === "unsafe") throw new Error(`attachment_recovery_unreadable: ${sidecar}`);
  const recoveryState = await loadAttachmentRecoveryState(source, kind);
  return recoveryState.editor === null ? null : { editor: recoveryState.editor };
}

async function loadAttachmentRecoveryState(source, kind) {
  const sidecar = sidecarPathFor(source);
  let parsed;
  try {
    parsed = JSON.parse(utf8.decode(await readRegularAttachmentArtifact(sidecar)));
  } catch {
    throw new Error(`attachment_recovery_unreadable: ${sidecar}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`attachment_recovery_unreadable: ${sidecar}`);
  }
  const editorKey = `${kind}_editor`;
  const cacheKey = `${kind}_parsed_cache`;
  if (Object.hasOwn(parsed, editorKey) || Object.hasOwn(parsed, cacheKey)) {
    return {
      format: "legacy",
      editor: objectOrNull(parsed[editorKey]),
    };
  }
  if (![1, 2].includes(parsed.version)) {
    throw new Error(`attachment_recovery_unreadable: unsupported sidecar version at ${sidecar}`);
  }
  const blocks = parsed.extras && parsed.extras.blocks;
  if (!blocks || typeof blocks !== "object" || Array.isArray(blocks)) {
    throw new Error(`attachment_recovery_unreadable: missing block slots at ${sidecar}`);
  }
  const slots = Object.values(blocks);
  if (slots.length !== 1 || !slots[0] || typeof slots[0] !== "object" || Array.isArray(slots[0])) {
    throw new Error(`attachment_recovery_unreadable: ambiguous block slots at ${sidecar}`);
  }
  return {
    format: "current",
    editor: objectOrNull(slots[0].editor),
  };
}

function recoveryStatusForEditor(kind, editor) {
  if (editor === null) return "none";
  const viewFields = kind === "pdf" ? new Set(["version"]) : new Set(["version", "activeSheetId"]);
  const editFields =
    kind === "pdf"
      ? new Set(["edits", "textEdits", "paragraphEdits", "freeText", "highlights"])
      : new Set([
          "cells",
          "rowHeights",
          "colWidths",
          "ops",
          "workbookOps",
          "filters",
          "filterMode",
          "frozen",
          "validations",
          "comments",
          "conditionalFormats",
        ]);
  for (const [key, value] of Object.entries(editor)) {
    if (!viewFields.has(key) && !editFields.has(key) && valueIsNonEmpty(value)) return "unknown";
  }
  for (const key of editFields) {
    if (valueIsNonEmpty(editor[key])) return "available";
  }
  return "none";
}

function valueIsNonEmpty(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return true;
  if (typeof value === "string" || Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

function objectOrNull(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

const MARKDOWN_SEARCH_PREVIEWS_PER_PAGE = 50;

/**
 * Re-validate the renderer's parsed criteria here rather than trusting them.
 *
 * The renderer parses because that is where the query string is typed and where a syntax error has
 * to be shown; the matching stays here because this is the only place that already reads every
 * Page. A malformed group is dropped rather than throwing, so a criteria payload can never turn a
 * search into a crash — same posture as `sanitizeExcludeDirs`.
 */
function sanitizeSearchCriteria(value) {
  const groups = Array.isArray(value?.groups) ? value.groups : [];
  const clean = [];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    const terms = [];
    for (const term of group) {
      if (!term || typeof term !== "object") continue;
      const field = term.field;
      if (field !== "content" && field !== "file" && field !== "path" && field !== "tag") continue;
      if (typeof term.value !== "string" || !term.value) continue;
      let regex = null;
      if (typeof term.regexSource === "string" && term.regexSource) {
        // Only the flags the renderer's own whitelist allows; `g` and `y` carry lastIndex state.
        const flags = typeof term.regexFlags === "string" ? term.regexFlags : "";
        if (!/^[imsu]*$/.test(flags)) continue;
        try {
          regex = new RegExp(term.regexSource, flags);
        } catch {
          continue;
        }
      }
      terms.push({ field, value: term.value, negated: Boolean(term.negated), regex });
    }
    if (terms.length) clean.push(terms);
  }
  return clean;
}

/** Every tag a Page carries, lower-cased, including each ancestor of a nested `a/b`. */
function pageTagSet(meta) {
  const tags = new Set();
  const values = Array.isArray(meta?.tags) ? meta.tags : [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const tag = value.trim().toLowerCase().replace(/^#/, "");
    if (!tag) continue;
    tags.add(tag);
    // `tag:project` has to find a Page tagged `project/alpha`, the way a nested tag reads.
    const parts = tag.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      tags.add(parts.slice(0, index).join("/"));
    }
  }
  return tags;
}

function matchesSearchTerm(term, context) {
  const test = (haystack) =>
    term.regex ? term.regex.test(haystack) : haystack.toLowerCase().includes(term.value);
  let hit;
  if (term.field === "tag") {
    hit = term.regex
      ? [...context.tags].some((tag) => term.regex.test(tag))
      : context.tags.has(term.value);
  } else if (term.field === "file") {
    hit = test(context.name);
  } else if (term.field === "path") {
    hit = test(context.path);
  } else {
    hit = test(context.body);
  }
  return term.negated ? !hit : hit;
}

/** Every group must match; within a group any one term is enough. */
function evaluateSearchCriteria(groups, context) {
  return groups.every((group) => group.some((term) => matchesSearchTerm(term, context)));
}

async function workspaceMarkdownSearch(rootValue, queryValue, limitValue, criteriaValue) {
  const root = await canonicalWorkspaceRoot(rootValue);
  const query = String(queryValue || "")
    .trim()
    .toLowerCase();
  const criteria = sanitizeSearchCriteria(criteriaValue);
  // `tag:project` is a complete query with no text in it, so the requirement is a query *or* a
  // constraint — not a query string.
  if (!query && !criteria.length) throw new Error("search query is required");
  const limit = Math.min(Math.max(Number(limitValue || 50), 1), 200);
  const scan = await workspaceScan(root);
  const results = [];
  for (const document of scan.documents) {
    if (document.documentType !== "markdown") continue;
    const raw = await readUtf8(path.join(root, ...document.path.split("/")));
    // The body, not the raw file. Line numbers counted over the frontmatter belong to no line the
    // editor can show — `readPage` returns the body — so a hit reported at line 7 landed several
    // Blocks off. It also stopped `id:` and `tags:` surfacing as if they were content.
    const split = splitPageSource(raw);
    const body = split.body;
    if (
      criteria.length &&
      !evaluateSearchCriteria(criteria, {
        name: document.name,
        path: document.path,
        body,
        tags: pageTagSet(split.meta),
      })
    ) {
      continue;
    }
    const matches = [];
    let matchCount = 0;
    // Only when there is text to look for. `includes("")` is true of every line, so a
    // constraint-only query reported the whole Page line by line and never reached the
    // branch below that exists to handle it.
    for (const [index, line] of query ? body.split(/\r\n|\n|\r/).entries() : []) {
      if (!line.toLowerCase().includes(query)) continue;
      matchCount += 1;
      // Every hit is counted, but a Page with thousands of them does not send thousands of
      // previews across the bridge for a panel that can only show a screen of them.
      if (matches.length < MARKDOWN_SEARCH_PREVIEWS_PER_PAGE) {
        matches.push({ line: index + 1, preview: line.trim().slice(0, 240) });
      }
    }
    // A query made only of constraints — `tag:project` alone — has no text to point at, so the
    // Page is reported with its first non-empty line rather than dropped for having no line hits.
    if (!query && criteria.length && matchCount === 0) {
      const first = body.split(/\r\n|\n|\r/).findIndex((line) => line.trim());
      if (first >= 0) {
        matchCount = 1;
        matches.push({ line: first + 1, preview: body.split(/\r\n|\n|\r/)[first].trim().slice(0, 240) });
      }
    }
    if (matches.length) {
      results.push({
        id: document.id,
        path: document.path,
        name: document.name,
        title: document.title,
        matches,
        matchCount,
      });
      if (results.length >= limit) break;
    }
  }
  return results;
}

async function canonicalWorkspaceRoot(rootValue) {
  if (typeof rootValue !== "string" || !rootValue.trim()) {
    throw new Error("workspace root is required");
  }
  let real;
  try {
    real = await fsp.realpath(path.resolve(rootValue));
  } catch {
    throw new Error(`workspace root is not a directory: ${path.resolve(rootValue)}`);
  }
  const stat = await fsp.stat(real);
  if (!stat.isDirectory()) throw new Error(`workspace root is not a directory: ${real}`);
  return real;
}

function validateRelativePath(relPath) {
  if (typeof relPath !== "string" || !relPath.trim()) {
    throw new Error("document path is required");
  }
  if (path.isAbsolute(relPath) || /^[A-Za-z]:[\\/]/.test(relPath)) {
    throw new Error(`document path must be relative: ${relPath}`);
  }
  const normalizedParts = relPath.replaceAll("\\", "/").split("/");
  const parts = [];
  for (const part of normalizedParts) {
    if (!part || part === ".") continue;
    if (part === "..") throw new Error(`document path escapes workspace root: ${relPath}`);
    parts.push(part);
  }
  if (!parts.length) throw new Error("document path is required");
  return parts;
}

async function resolveWorkspacePathForWrite(root, relPath) {
  const parts = validateRelativePath(relPath);
  const candidate = path.join(root, ...parts);
  const candidateStat = await lstatIfPresent(candidate);
  if (candidateStat?.isSymbolicLink()) {
    throw new Error(`symbolic-link writes are not allowed: ${relPath}`);
  }
  let nearest = candidate;
  while (!(await lstatIfPresent(nearest))) {
    const parent = path.dirname(nearest);
    if (parent === nearest) break;
    nearest = parent;
  }
  const nearestStat = await fsp.lstat(nearest);
  if (nearestStat.isSymbolicLink()) {
    throw new Error(`symbolic-link writes are not allowed: ${relPath}`);
  }
  const nearestReal = await fsp.realpath(nearest);
  ensureWithinRoot(root, nearestReal);
  if (candidateStat) {
    const candidateReal = await fsp.realpath(candidate);
    ensureWithinRoot(root, candidateReal);
  }
  return candidate;
}

async function resolveExistingWorkspacePath(root, relPath) {
  const parts = validateRelativePath(relPath);
  const candidate = path.join(root, ...parts);
  let real;
  try {
    real = await fsp.realpath(candidate);
  } catch {
    throw new Error(`workspace path does not exist: ${relPath}`);
  }
  ensureWithinRoot(root, real);
  const stat = await fsp.lstat(candidate);
  if (stat.isSymbolicLink())
    throw new Error(`symbolic-link operations are not allowed: ${relPath}`);
  return candidate;
}

function ensureWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`path escapes workspace root: ${candidate}`);
  }
}

function ensureMarkdownPath(pathValue) {
  const extension = path.extname(String(pathValue || "")).toLowerCase();
  if (!MARKDOWN_EXTENSIONS.has(extension)) {
    throw new Error(`Page path must end in .md or .markdown: ${pathValue}`);
  }
}

function ensureSameDocumentExtension(oldPath, newPath) {
  const oldExtension = path.extname(String(oldPath || "")).toLowerCase();
  const newExtension = path.extname(String(newPath || "")).toLowerCase();
  if (!DOCUMENT_EXTENSIONS.has(oldExtension) || !DOCUMENT_EXTENSIONS.has(newExtension)) {
    throw new Error(`unsupported workspace document move: ${oldPath} -> ${newPath}`);
  }
  if (oldExtension !== newExtension) {
    throw new Error(`cannot change document type on move: ${oldPath} -> ${newPath}`);
  }
}

function splitPageSource(raw) {
  const sourceStart = raw.startsWith("\ufeff") ? 1 : 0;
  const first = readLine(raw, sourceStart);
  if (!first || first.content !== "---" || !first.ending) {
    return { prefix: null, body: raw, meta: {} };
  }
  const metadataLines = [];
  let offset = first.end;
  while (offset <= raw.length) {
    const line = readLine(raw, offset);
    if (!line) break;
    // `...` is YAML's document-end marker and a conventional frontmatter
    // terminator. Without it the scan runs past the block into body prose.
    if (line.content === "---" || line.content === "...") {
      const headEnd = line.end - line.ending.length;
      let prefixEnd = line.end;
      const separator = readLine(raw, prefixEnd);
      if (separator && separator.content === "" && separator.ending) prefixEnd = separator.end;
      return {
        prefix: raw.slice(0, prefixEnd),
        body: raw.slice(prefixEnd),
        meta: parseMetadataLines(metadataLines),
        headEnd,
      };
    }
    metadataLines.push(line.content);
    if (!line.ending) break;
    offset = line.end;
  }
  return { prefix: null, body: raw, meta: {} };
}

function readLine(source, start) {
  if (start > source.length || (start === source.length && source.length !== 0)) return null;
  for (let index = start; index < source.length; index += 1) {
    const ch = source[index];
    if (ch !== "\n" && ch !== "\r") continue;
    const ending = ch === "\r" && source[index + 1] === "\n" ? "\r\n" : ch;
    return { content: source.slice(start, index), ending, end: index + ending.length };
  }
  return { content: source.slice(start), ending: "", end: source.length };
}

function parseMetadataLines(lines) {
  const meta = {};
  for (let index = 0; index < lines.length; index += 1) {
    // Only a top-level mapping entry — the exact shape the patch writer can
    // target — becomes a Page property. Indented keys stay unknown-but-
    // preserved source so an edit never lands on a different YAML node.
    const line = lines[index];
    const match = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*:/.exec(line);
    if (!match) continue;
    const sequence = readBlockSequence(lines, index);
    if (sequence) {
      meta[match[1]] = sequence.items;
      index = sequence.end - 1;
      continue;
    }
    meta[match[1]] = parseYamlScalar(line.slice(match[0].length).trim());
  }
  return meta;
}

/**
 * The block sequence opened by `lines[index]`, or null if that key's value is not one.
 *
 * `tags:` followed by `  - project` is how Obsidian writes a list, and reading only the key's own
 * line saw an empty scalar — so every tag and alias in an imported vault arrived as `""`, invisible
 * in the properties panel and unpatchable by the writer. A nested *mapping* is deliberately not a
 * sequence: those stay opaque, because the writer cannot target a key inside one.
 */
function readBlockSequence(lines, index) {
  const line = lines[index];
  const match = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*:/.exec(line);
  if (!match) return null;
  if (stripYamlInlineComment(line.slice(match[0].length)).trim()) return null;
  const items = [];
  let indent = null;
  let end = index + 1;
  for (; end < lines.length; end += 1) {
    const entry = /^([ \t]*)-(?:[ \t]+(.*))?$/.exec(lines[end]);
    if (!entry) break;
    // Every entry of one sequence stands in the same column; a different one is another node.
    if (indent === null) indent = entry[1];
    else if (entry[1] !== indent) break;
    items.push(parseYamlScalar((entry[2] ?? "").trim()));
  }
  if (!items.length) return null;
  return { items, end, indent: indent ?? "  " };
}

function portablePageId(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9._:-]+$/.test(trimmed) ? trimmed : null;
}

function pageMetaProjection(meta) {
  const projected = { ...meta };
  const id = portablePageId(projected.id);
  if (id) projected.id = id;
  else delete projected.id;
  for (const key of ["title", "icon", "cover", "created", "updated"]) {
    if (projected[key] !== undefined && typeof projected[key] !== "string") delete projected[key];
  }
  if (projected.favorite !== undefined && typeof projected.favorite !== "boolean") {
    delete projected.favorite;
  }
  for (const key of PAGE_LIST_METADATA_KEYS) {
    if (
      projected[key] !== undefined &&
      (!Array.isArray(projected[key]) || projected[key].some((value) => typeof value !== "string"))
    ) {
      delete projected[key];
    }
  }
  if (
    projected.cover_position !== undefined &&
    (typeof projected.cover_position !== "number" || !Number.isFinite(projected.cover_position))
  ) {
    delete projected.cover_position;
  }
  return projected;
}

function parseYamlScalar(value) {
  const token = stripYamlInlineComment(value).trim();
  if (/^(true|false)$/i.test(token)) return token.toLowerCase() === "true";
  if (/^(null|~)$/i.test(token)) return null;
  // YAML's flow sequence is only JSON when every item happens to be quoted. `tags: [a, b]` is
  // ordinary YAML and was landing in the fallback as the literal string "[a, b]".
  if (token.startsWith("[") && token.endsWith("]")) {
    const items = splitYamlFlowItems(token.slice(1, -1));
    if (items) return items.map((item) => parseYamlScalar(item));
  }
  try {
    return JSON.parse(token);
  } catch {
    const singleQuoted = /^'(.*)'$/s.exec(token);
    if (singleQuoted) return singleQuoted[1].replaceAll("''", "'");
    return token;
  }
}

/** Top-level commas of a flow sequence's interior, respecting quotes and nesting. */
function splitYamlFlowItems(inner) {
  const items = [];
  let current = "";
  let quote = null;
  let escaped = false;
  let depth = 0;
  for (const char of inner) {
    if (quote === '"') {
      current += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      current += char;
      if (char === "'") quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "[" || char === "{") depth += 1;
    else if (char === "]" || char === "}") depth -= 1;
    if (char === "," && depth === 0) {
      items.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (quote !== null || depth !== 0) return null;
  items.push(current);
  return items.map((item) => item.trim()).filter((item) => item !== "");
}

function stripYamlInlineComment(value) {
  const index = yamlInlineCommentIndex(value);
  return index === -1 ? value : value.slice(0, index).trimEnd();
}

function yamlInlineCommentIndex(value) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (quote === "'") {
      if (char === quote && value[index + 1] === quote) index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "#" && (index === 0 || /\s/.test(value[index - 1]))) {
      return index;
    }
  }
  return -1;
}

function patchFrontmatterPrefix(prefix, patchValue) {
  if (!patchValue || typeof patchValue !== "object" || Array.isArray(patchValue)) return prefix;
  validatePagePropertyPatchValues(patchValue);
  const patch = Object.fromEntries(
    Object.entries(patchValue).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  );
  if (!Object.keys(patch).length) return prefix;
  if (prefix === null) {
    const pageId =
      typeof patch.id === "string" && patch.id.trim() ? patch.id.trim() : crypto.randomUUID();
    const lines = [`id: ${pageId}`];
    for (const [key, value] of Object.entries(patch)) {
      if (key !== "id" && value !== null && value !== undefined) {
        lines.push(`${key}: ${renderMetadataValue(key, value)}`);
      }
    }
    return `---\n${lines.join("\n")}\n---\n\n`;
  }

  const split = splitPageSource(prefix);
  if (split.prefix === null || split.body)
    throw new Error("cannot patch malformed Page frontmatter");
  const head = prefix.slice(0, split.headEnd);
  const suffix = prefix.slice(split.headEnd);
  const newline = head.includes("\r\n") ? "\r\n" : head.includes("\r") ? "\r" : "\n";
  const lines = head.split(/\r\n|\n|\r/);
  validatePagePropertyPatchSource(lines.slice(1, -1), patch);
  const body = lines.slice(1, -1);
  const output = [lines[0]];
  const consumed = new Set();
  for (let index = 0; index < body.length; index += 1) {
    const line = body[index];
    const key = pagePropertyLineKey(line);
    const sequence = key ? readBlockSequence(body, index) : null;
    if (!key || !(key in patch)) {
      output.push(line);
      // A sequence we are not touching is copied through exactly as the user wrote it.
      if (sequence) {
        for (let entry = index + 1; entry < sequence.end; entry += 1) output.push(body[entry]);
        index = sequence.end - 1;
      }
      continue;
    }
    consumed.add(key);
    const value = patch[key];
    if (sequence) {
      // Rewriting a list the user wrote as a block keeps it a block; collapsing it to flow style
      // would reformat a file the user never asked us to reformat.
      if (value !== null && value !== undefined) {
        output.push(...renderBlockSequenceLines(line, key, value, sequence.indent));
      }
      index = sequence.end - 1;
      continue;
    }
    if (value !== null && value !== undefined) {
      output.push(patchPagePropertyLine(line, key, value));
    }
  }
  for (const [key, value] of Object.entries(patch)) {
    if (!consumed.has(key) && value !== null && value !== undefined) {
      output.push(`${key}: ${renderMetadataValue(key, value)}`);
    }
  }
  output.push(lines.at(-1));
  return `${output.join(newline)}${suffix}`;
}

function validatePagePropertyPatchValues(patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (!PAGE_PROPERTY_KEY.test(key)) {
      throw new Error(`invalid Page property key '${key}'`);
    }
    if (key === "id" && !portablePageId(value)) {
      throw new Error("id must be a portable non-empty string");
    }
    if (PAGE_LIST_METADATA_KEYS.has(key)) {
      if (
        value !== null &&
        (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
      ) {
        throw new Error(`${key} must be string[] or null`);
      }
      continue;
    }
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "boolean" &&
      !(typeof value === "number" && Number.isFinite(value)) &&
      !(Array.isArray(value) && value.every((item) => typeof item === "string"))
    ) {
      throw new Error(`${key} must be a string, finite number, boolean, string[], or null`);
    }
  }
}

function validatePagePropertyPatchSource(lines, patch) {
  for (const key of Object.keys(patch)) {
    const matches = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (pagePropertyLineKey(lines[index]) === key) matches.push(index);
    }
    if (matches.length > 1) {
      throw new Error(`cannot safely patch Page property '${key}': duplicate YAML keys`);
    }
    if (matches.length !== 1) continue;
    const index = matches[0];
    const line = lines[index];
    const scalar = stripYamlInlineComment(line.slice(line.indexOf(":") + 1)).trim();
    if (!yamlValueEndsOnLine(scalar)) {
      throw new Error(`cannot safely patch Page property '${key}': nested YAML value`);
    }
    // A block sequence is a shape the writer rewrites whole, so its own entries are not the
    // nesting this guard exists to refuse. Resume the check past the sequence.
    const sequence = readBlockSequence(lines, index);
    for (const continuation of lines.slice(sequence ? sequence.end : index + 1)) {
      if (!continuation.trim() || continuation.trimStart().startsWith("#")) continue;
      if (/^[ \t]/.test(continuation)) {
        throw new Error(`cannot safely patch Page property '${key}': nested YAML value`);
      }
      break;
    }
  }
}

// A patch rewrites exactly one line, so the existing value has to end on that
// line. A block scalar (`|`, `>`) or an unterminated flow collection/quoted
// scalar continues below and can only be patched by orphaning those bytes.
function yamlValueEndsOnLine(scalar) {
  if (!scalar) return true;
  if (/^[|>][+-]?[0-9]*[+-]?$/.test(scalar)) return false;
  const first = scalar[0];
  if (first !== '"' && first !== "'" && first !== "[" && first !== "{") return true;
  let quote = null;
  let escaped = false;
  let depth = 0;
  for (let index = 0; index < scalar.length; index += 1) {
    const char = scalar[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (quote === "'") {
      if (char === quote && scalar[index + 1] === quote) index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "[" || char === "{") depth += 1;
    else if (char === "]" || char === "}") depth -= 1;
  }
  return quote === null && depth === 0;
}

function pagePropertyLineKey(line) {
  const match = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*:/.exec(line);
  return match ? match[1] : null;
}

function patchPagePropertyLine(line, key, value) {
  const separator = line.indexOf(":");
  const prefix = line.slice(0, separator + 1);
  const rawValue = line.slice(separator + 1);
  const leadingWhitespace = /^\s*/.exec(rawValue)?.[0] ?? "";
  const commentIndex = yamlInlineCommentIndex(rawValue);
  let suffix = "";
  if (commentIndex !== -1) {
    const beforeComment = rawValue.slice(0, commentIndex);
    suffix = `${beforeComment.slice(beforeComment.trimEnd().length)}${rawValue.slice(commentIndex)}`;
  } else {
    suffix = rawValue.slice(rawValue.trimEnd().length);
  }
  return `${prefix}${leadingWhitespace}${renderMetadataValue(key, value)}${suffix}`;
}

function renderBlockSequenceLines(keyLine, key, value, indent) {
  if (!Array.isArray(value) || value.length === 0) {
    return [patchPagePropertyLine(keyLine, key, value)];
  }
  return [keyLine, ...value.map((item) => `${indent}- ${renderYamlSequenceItem(item)}`)];
}

/**
 * A sequence entry, left bare where YAML allows it so a round-trip through doXmind leaves an
 * Obsidian tag list looking the way Obsidian wrote it.
 */
function renderYamlSequenceItem(value) {
  if (typeof value === "string" && /^[A-Za-z0-9_][A-Za-z0-9 _./-]*$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function renderMetadataValue(key, value) {
  if (key === "id") return String(value);
  return JSON.stringify(value);
}

function outlineFromMarkdown(markdown) {
  const seen = new Map();
  const outline = [];
  for (const line of markdown.split(/\r\n|\n|\r/)) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const text = match[2].replace(/\s+\{#.*?\}\s*$/, "").trim();
    const base = slugifyHeading(text);
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    outline.push({ id: count === 1 ? base : `${base}-${count}`, depth: match[1].length, text });
  }
  return outline;
}

function slugifyHeading(text) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "section"
  );
}

function revisionForBytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

async function atomicWrite(target, bytes, options = {}) {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  if (options.exclusive && fs.existsSync(target))
    throw new Error(`document already exists: ${target}`);
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.tmp-${process.pid}-${crypto.randomUUID()}`
  );
  let handle;
  try {
    const currentMode = await fsp
      .stat(target)
      .then((stat) => stat.mode & 0o777)
      .catch(() => 0o600);
    handle = await fsp.open(temporary, "wx", currentMode);
    // `open`'s mode argument is masked by the process umask, so preserving the
    // Page's permissions needs an explicit chmod before the rename commits.
    await handle.chmod(currentMode);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await options.beforeReplace?.(target);
    if (options.expectedRevision != null) {
      // Preparing and syncing a large replacement can take long enough for an
      // external editor to save. Revalidate at the commit boundary so that
      // rename never knowingly replaces bytes newer than the caller opened.
      const actualRevision = await revisionForRegularFile(target);
      if (actualRevision !== options.expectedRevision) {
        throw new Error(
          `page_revision_conflict: expected ${options.expectedRevision}, actual ${actualRevision || "missing"} for ${target}`
        );
      }
    }
    if (options.exclusive) {
      try {
        await fsp.link(temporary, target);
      } catch (error) {
        if (error && error.code === "EEXIST") throw new Error(`document already exists: ${target}`);
        throw error;
      }
      await fsp.unlink(temporary);
    } else {
      await fsp.rename(temporary, target);
    }
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fsp.unlink(temporary).catch(() => {});
  }
}

async function revisionForRegularFile(target) {
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  let handle;
  try {
    handle = await fsp.open(target, fs.constants.O_RDONLY | noFollow);
    const stat = await handle.stat();
    if (!stat.isFile()) return null;
    return revisionForBytes(await handle.readFile());
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ELOOP") return null;
    throw error;
  } finally {
    await handle?.close();
  }
}

async function readUtf8(absolute) {
  return decodeUtf8(await fsp.readFile(absolute), absolute);
}

function decodeUtf8(bytes, absolute) {
  try {
    return utf8.decode(bytes);
  } catch {
    const error = new Error(`Page is not valid UTF-8: ${absolute}`);
    error.code = "ERR_PAGE_NOT_UTF8";
    throw error;
  }
}

function relativePath(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function normalizeRelativePath(relPath) {
  return validateRelativePath(relPath).join("/");
}

function sidecarPathFor(documentPath) {
  const name = path.basename(documentPath);
  const lower = name.toLowerCase();
  const stem = lower.endsWith(".markdown")
    ? name.slice(0, -".markdown".length)
    : lower.endsWith(".md")
      ? name.slice(0, -".md".length)
      : name;
  return path.join(path.dirname(documentPath), `.${stem}.doxmind`);
}

async function sidecarFamilyPaths(documentPath) {
  const exact = sidecarPathFor(documentPath);
  const directory = path.dirname(exact);
  if (!fs.existsSync(directory)) return [];
  const base = path.basename(exact);
  const directoryNames = await fsp.readdir(directory);
  const existingNames = new Set(directoryNames);
  const names = [base, `${base}.bak`, `${base}.lock`]
    .filter((name) => existingNames.has(name))
    .concat(
      directoryNames
        .filter((name) => name.startsWith(`${base}.corrupt-`))
        .sort((left, right) => left.localeCompare(right))
    );
  const members = [];
  for (const name of names) {
    const member = path.join(directory, name);
    const stat = await fsp.lstat(member);
    if (stat.isSymbolicLink()) {
      throw new Error(`legacy sidecar family contains a symbolic link: ${member}`);
    }
    if (!stat.isFile()) throw new Error(`legacy sidecar family member is not a file: ${member}`);
    members.push(member);
  }
  return members;
}

async function createMissingParentDirectories(root, destinationParent) {
  const missing = [];
  let current = destinationParent;
  while (current !== root && !fs.existsSync(current)) {
    missing.push(current);
    current = path.dirname(current);
  }
  await fsp.mkdir(destinationParent, { recursive: true });
  return missing;
}

function bytesFromPayload(value, label) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value));
  if (!Array.isArray(value)) {
    throw new Error(`${label} bytes payload must be an array of unsigned bytes`);
  }
  const bytes = [];
  for (const item of value) {
    const number = Number(item);
    if (!Number.isInteger(number) || number < 0 || number > 255) {
      throw new Error(`invalid ${label} bytes payload`);
    }
    bytes.push(number);
  }
  return Buffer.from(bytes);
}

function documentTypeForExtension(extension) {
  if (MARKDOWN_EXTENSIONS.has(extension)) return "markdown";
  if (extension === ".pdf") return "pdf";
  if ([".xlsx", ".xlsm", ".csv"].includes(extension)) return "excel";
  return "html";
}

function attachmentKind(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".pdf") return "pdf";
  if ([".xlsx", ".xlsm", ".csv"].includes(extension)) return "excel";
  if ([".html", ".htm"].includes(extension)) return "html";
  throw new Error("attachment inspection requires PDF, spreadsheet, or HTML");
}

function stablePathId(relPath) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of Buffer.from(relPath, "utf8")) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `path:${hash.toString(16).padStart(16, "0")}`;
}

function isHiddenSidecarName(name) {
  if (!name.startsWith(".")) return false;
  const marker = ".doxmind";
  const markerIndex = name.indexOf(marker, 1);
  if (markerIndex <= 1) return false;
  const tailIndex = markerIndex + marker.length;
  return tailIndex === name.length || name[tailIndex] === ".";
}

async function isSameFilesystemEntry(left, right) {
  const [leftStat, rightStat] = await Promise.all([lstatIfPresent(left), lstatIfPresent(right)]);
  if (!leftStat || !rightStat) return false;
  return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
}

async function lstatIfPresent(target) {
  try {
    return await fsp.lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function attachmentArtifactState(target) {
  try {
    const stat = await fsp.lstat(target);
    return stat.isFile() && !stat.isSymbolicLink() ? "regular" : "unsafe";
  } catch (error) {
    return error?.code === "ENOENT" ? "missing" : "unsafe";
  }
}

async function readRegularAttachmentArtifact(target) {
  if ((await attachmentArtifactState(target)) !== "regular") {
    throw new Error(`attachment_recovery_unreadable: ${target}`);
  }
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  let handle;
  try {
    handle = await fsp.open(target, fs.constants.O_RDONLY | noFollow);
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(`attachment_recovery_unreadable: ${target}`);
    return await handle.readFile();
  } catch (error) {
    throw new Error(`attachment_recovery_unreadable: ${target}`, { cause: error });
  } finally {
    await handle?.close();
  }
}

module.exports = {
  createNativeWorkspaceDispatcher,
  NATIVE_WORKSPACE_COMMANDS,
  isNativeWorkspaceCommand: (command) => NATIVE_WORKSPACE_COMMANDS.has(command),
  MARKDOWN_EXTENSIONS,
  DOCUMENT_EXTENSIONS,
  revisionForBytes,
  splitPageSource,
};
