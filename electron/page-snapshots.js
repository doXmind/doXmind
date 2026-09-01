"use strict";

/**
 * Local snapshots of a Page's previous on-disk bytes.
 *
 * Recovery, not versioning. The user's Markdown file is the source of truth, so a snapshot is
 * derived state and lives in app data — never beside the Page. Writing history into the workspace
 * would put files the user did not create next to the ones they did, and would sync, back up and
 * travel with their notes.
 *
 * `<DATA_DIR>/page-snapshots/<sha256(canonical page path)>/<epochMillis>.md`, each file a
 * byte-for-byte copy of the Page as it was *before* a write, BOM and frontmatter included.
 */

const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

/** One snapshot per Page per five minutes: a save every keystroke must not fill the disk. */
const CAPTURE_INTERVAL_MS = 5 * 60 * 1000;

/** Bounded three ways, because an unbounded store is a slow failure nobody notices. */
const MAX_VERSIONS = 25;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 8 * 1024 * 1024;

const SNAPSHOT_ID = /^[0-9]{1,15}$/;

function dataDir() {
  return process.env.DATA_DIR || path.join(os.homedir(), ".doxmind");
}

/** Keyed by a hash of the canonical path, so no Page name can escape the snapshot root. */
function snapshotDir(absolutePagePath) {
  const key = crypto.createHash("sha256").update(absolutePagePath).digest("hex");
  return path.join(dataDir(), "page-snapshots", key);
}

async function listSnapshotIds(directory) {
  let entries;
  try {
    entries = await fsp.readdir(directory);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith(".md") && SNAPSHOT_ID.test(name.slice(0, -3)))
    .map((name) => Number(name.slice(0, -3)))
    .sort((left, right) => right - left);
}

/**
 * Drop what falls outside every bound, newest first.
 *
 * Index 0 is always kept: a Page whose single snapshot is older than the age bound still deserves
 * the one copy that could recover it.
 */
async function prune(directory, now) {
  const ids = await listSnapshotIds(directory);
  let bytes = 0;
  for (const [index, id] of ids.entries()) {
    const file = path.join(directory, `${id}.md`);
    let size = 0;
    try {
      size = (await fsp.stat(file)).size;
    } catch {
      continue;
    }
    bytes += size;
    const keep = index === 0 || (index < MAX_VERSIONS && now - id < MAX_AGE_MS && bytes <= MAX_BYTES);
    if (!keep) await fsp.rm(file, { force: true });
  }
}

/**
 * Record `bytes` as the state before a write, unless one was recorded recently.
 *
 * Never throws: a full disk or an unwritable DATA_DIR must not fail the user's save. The Markdown
 * file is what matters; this is a convenience layered on top of it.
 */
async function capturePageSnapshot(absolutePagePath, bytes, now = Date.now()) {
  if (!bytes || bytes.length === 0) return;
  try {
    const directory = snapshotDir(absolutePagePath);
    const [newest] = await listSnapshotIds(directory);
    if (newest !== undefined && now - newest < CAPTURE_INTERVAL_MS) return;
    await fsp.mkdir(directory, { recursive: true });
    await fsp.writeFile(path.join(directory, `${now}.md`), bytes);
    await prune(directory, now);
  } catch (error) {
    console.error("[doxmind] page snapshot failed:", error);
  }
}

async function listPageSnapshots(absolutePagePath) {
  const ids = await listSnapshotIds(snapshotDir(absolutePagePath));
  return { snapshots: ids.map((id) => ({ id: String(id), capturedAt: id })) };
}

async function readPageSnapshot(absolutePagePath, idValue) {
  const id = String(idValue || "");
  // The only caller-supplied path segment in the feature, so it is validated before it is joined.
  if (!SNAPSHOT_ID.test(id)) throw new Error("invalid snapshot id");
  const file = path.join(snapshotDir(absolutePagePath), `${id}.md`);
  const bytes = await fsp.readFile(file);
  return { id, capturedAt: Number(id), markdown: bytes.toString("utf8") };
}

module.exports = {
  capturePageSnapshot,
  listPageSnapshots,
  readPageSnapshot,
  snapshotDir,
  CAPTURE_INTERVAL_MS,
  MAX_VERSIONS,
};
