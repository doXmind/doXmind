/**
 * D2 — External import resolver, plan phase.
 *
 * Pure planner for sidebar external drag-and-drop. Splits the legality decision
 * (testable, no side effects) from the actual filesystem copy that the backend
 * does in `doc_import_external`. The plan phase enforces the .md/.pdf/.xlsx
 * whitelist and detects same-name collisions at the destination, but does NOT
 * resolve them — collision RESOLUTION (Replace / Keep both / Skip) lands in
 * #69. The bucket shape below is intentionally extensible so #69 can attach a
 * `resolution` field per collision without breaking this module's callers.
 *
 * Usage shape:
 *
 *   const plan = planExternalImport({
 *     items: [{ name: "Notes.md", srcPath: "/Users/x/Downloads/Notes.md" }],
 *     destFolderId: "folder-abc",
 *     existingNames: ["Other.md"],
 *   });
 *   plan.accepted   // copy these straight through
 *   plan.rejected   // toast "Only .md/.pdf/.xlsx" — never copy
 *   plan.collisions // toast in this slice (#67); modal in #69
 */

/** Whitelist of supported document extensions (lowercase, with dot). */
export const SUPPORTED_EXTENSIONS = [".md", ".pdf", ".xlsx"] as const;

export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

/** A single dropped item — either a real OS path (Tauri) or in-memory bytes (browser). */
export interface ExternalImportItem {
  /** Filename including extension; the resolver only inspects this for the whitelist. */
  name: string;
  /** Absolute source path on disk. Tauri provides this via `tauri://drag-drop`. */
  srcPath?: string;
  /** Raw bytes, used in browser dev mode where HTML5 DnD only exposes File objects. */
  bytes?: Uint8Array;
}

/**
 * Possible reasons we refuse an item before it reaches the backend.
 *
 * Kept as a discriminated union so #69 can introduce additional reasons
 * (e.g. `"too-large"`) without breaking exhaustive switches on existing
 * callers — TypeScript will flag the new variant at every site.
 */
export type RejectReason = "bad-extension";

export interface AcceptedItem {
  item: ExternalImportItem;
  /** Lower-cased, dot-prefixed extension; useful for picking the right backend code path. */
  extension: SupportedExtension;
}

export interface RejectedItem {
  item: ExternalImportItem;
  reason: RejectReason;
}

export interface CollisionItem {
  item: ExternalImportItem;
  extension: SupportedExtension;
  /** The colliding existing name at the destination (case-sensitive match). */
  existingName: string;
  // Future: `resolution: "replace" | "keep-both" | "skip"` lands in #69.
}

export interface ImportPlanInput {
  items: ExternalImportItem[];
  /** Destination folder id (or null for workspace root). Echoed through; not interpreted here. */
  destFolderId: string | null;
  /** Names already present at the destination. Pass the names as the user sees them in the sidebar. */
  existingNames: string[];
}

export interface ImportPlan {
  destFolderId: string | null;
  accepted: AcceptedItem[];
  rejected: RejectedItem[];
  collisions: CollisionItem[];
}

/**
 * Extract the extension from a filename, lowercased and including the leading
 * dot. Returns `null` for files with no extension. Matches the rightmost dot
 * so `archive.tar.gz` → `.gz` (we reject those anyway, the result just needs
 * to be deterministic).
 */
export function extensionOf(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0 || dot === trimmed.length - 1) return null;
  return trimmed.slice(dot).toLowerCase();
}

function isSupported(ext: string | null): ext is SupportedExtension {
  return ext !== null && (SUPPORTED_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Plan an external-import drop. Pure: no filesystem access, no async.
 *
 * Each item lands in exactly one bucket:
 * - `accepted` — whitelisted extension, no name clash at destination.
 * - `rejected` — not whitelisted (`bad-extension`).
 * - `collisions` — whitelisted but the destination already has that name.
 *   This slice errors out at the backend boundary; #69 owns the modal /
 *   Replace / Keep both / Skip resolution.
 */
export function planExternalImport(input: ImportPlanInput): ImportPlan {
  const accepted: AcceptedItem[] = [];
  const rejected: RejectedItem[] = [];
  const collisions: CollisionItem[] = [];

  // Existing-name lookup is case-sensitive: doXmind's filesystem-of-truth
  // model means the user's OS decides case sensitivity. We mirror what's on
  // disk verbatim — cross-platform false-positives are out of scope here.
  const existing = new Set(input.existingNames);

  for (const item of input.items) {
    const ext = extensionOf(item.name);
    if (!isSupported(ext)) {
      rejected.push({ item, reason: "bad-extension" });
      continue;
    }
    if (existing.has(item.name)) {
      collisions.push({ item, extension: ext, existingName: item.name });
      continue;
    }
    accepted.push({ item, extension: ext });
  }

  return {
    destFolderId: input.destFolderId,
    accepted,
    rejected,
    collisions,
  };
}
