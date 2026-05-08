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
}

/**
 * Per-collision user decision from the conflict modal (#69).
 *
 * - `replace`   — overwrite the user file at the destination. The pre-existing
 *                 sidecar is left intact at the FS level; the next open trips
 *                 the Stale-sidecar / Salvage path. See ADR 0002.
 * - `keep-both` — copy under a renamed name (`Foo.md` → `Foo (2).md`).
 * - `skip`      — drop this item from the final plan entirely.
 */
export type CollisionResolution = "replace" | "keep-both" | "skip";

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

/**
 * Concrete action the storage adapter should execute. `mode` is the wire
 * value passed straight to `doc_import_external` — `"create"` for fresh
 * imports and `keep-both` renames, `"replace"` for an in-place overwrite.
 */
export interface ImportAction {
  item: ExternalImportItem;
  extension: SupportedExtension;
  /** Final destination filename — may differ from `item.name` after `keep-both`. */
  name: string;
  mode: "create" | "replace";
}

export interface ResolvedImportPlan {
  destFolderId: string | null;
  /** Items ready to copy. Ordering follows `accepted` then resolved collisions. */
  actions: ImportAction[];
  /** Echoed through from the plan phase so the caller can still surface bad-extension toasts. */
  rejected: RejectedItem[];
}

export interface ResolveImportPlanInput {
  plan: ImportPlan;
  /** Existing names at the destination — same set the plan phase used. Needed for `keep-both` rename arithmetic. */
  existingNames: string[];
  /**
   * Per-collision decisions, keyed by `existingName`. Missing entries cause
   * the resolver to throw — callers must decide every collision before
   * dispatching. (The modal blocks Apply until all rows have a choice.)
   */
  decisions: Record<string, CollisionResolution>;
}

/**
 * Match the canonical `Name (N).ext` rename pattern.
 *
 * Captures: stem, optional space-paren-N-paren suffix (with N), extension.
 * Used to discover the highest existing N for a given stem so `keep-both`
 * picks a non-clashing name.
 */
const KEEP_BOTH_NUMBERED_RE = /^(.*?)(?: \((\d+)\))?(\.[^.]+)$/;

/**
 * Compute a non-clashing name for `keep-both`.
 *
 * `Foo.md` collides → returns `Foo (2).md`. If `Foo (2).md` also exists,
 * returns `Foo (3).md` and so on. The starting point is always 2 — the
 * original (without a suffix) is treated as the implicit `(1)`.
 *
 * `existing` is mutated callsite-side by the resolver between successive
 * `keep-both` decisions in the same batch, so two collisions with the same
 * root pick distinct names (`Foo (2).md`, then `Foo (3).md`).
 */
export function nextKeepBothName(originalName: string, existing: Set<string>): string {
  const match = KEEP_BOTH_NUMBERED_RE.exec(originalName);
  if (!match) {
    // No extension — extremely unlikely to reach here because the whitelist
    // requires .md/.pdf/.xlsx, but be defensive: fall back to `<name> (2)`.
    let n = 2;
    while (existing.has(`${originalName} (${n})`)) n += 1;
    return `${originalName} (${n})`;
  }
  const [, rawStem, , ext] = match;
  // Strip any trailing `(N)` from the stem so `Foo (2).md` doesn't grow into
  // `Foo (2) (2).md` on a re-collision; we anchor the counter to the bare stem.
  const stem = rawStem.replace(/ \(\d+\)$/, "");
  // Find the highest existing N for this stem at the destination.
  let highest = 1;
  const stemPrefix = `${stem} (`;
  for (const name of existing) {
    if (!name.endsWith(ext)) continue;
    if (name === `${stem}${ext}`) {
      // The bare base counts as (1) — already accounted for in `highest = 1`.
      continue;
    }
    if (!name.startsWith(stemPrefix)) continue;
    const middle = name.slice(stemPrefix.length, name.length - ext.length);
    const closingParen = middle.lastIndexOf(")");
    if (closingParen === -1) continue;
    const candidate = middle.slice(0, closingParen);
    const n = Number.parseInt(candidate, 10);
    if (!Number.isFinite(n) || String(n) !== candidate) continue;
    if (n > highest) highest = n;
  }
  return `${stem} (${highest + 1})${ext}`;
}

/**
 * Resolve the collision bucket of a plan into a final action list.
 *
 * Throws if any collision is missing a decision: the modal contract is that
 * the user picks Replace / Keep both / Skip for every row before pressing
 * Apply, so a missing key indicates a programming error in the caller.
 */
export function resolveImportPlan(input: ResolveImportPlanInput): ResolvedImportPlan {
  const { plan, decisions } = input;
  // Mutable working set so successive `keep-both` renames in the same batch
  // see each other's reservations. Seeded with the destination's existing
  // names plus every accepted item's name (a brand-new accept can shadow a
  // would-be `keep-both` target).
  const reserved = new Set<string>(input.existingNames);
  for (const accepted of plan.accepted) {
    reserved.add(accepted.item.name);
  }

  const actions: ImportAction[] = [];

  // Accepted entries pass straight through as `create`.
  for (const accepted of plan.accepted) {
    actions.push({
      item: accepted.item,
      extension: accepted.extension,
      name: accepted.item.name,
      mode: "create",
    });
  }

  for (const collision of plan.collisions) {
    const decision = decisions[collision.existingName];
    if (decision === undefined) {
      throw new Error(
        `resolveImportPlan: missing decision for collision "${collision.existingName}"`
      );
    }
    if (decision === "skip") continue;
    if (decision === "replace") {
      actions.push({
        item: collision.item,
        extension: collision.extension,
        name: collision.item.name,
        mode: "replace",
      });
      // `replace` keeps the existing reservation — the destination name is
      // unchanged, so no further bookkeeping is needed.
      continue;
    }
    // keep-both
    const nextName = nextKeepBothName(collision.item.name, reserved);
    reserved.add(nextName);
    actions.push({
      item: collision.item,
      extension: collision.extension,
      name: nextName,
      mode: "create",
    });
  }

  return {
    destFolderId: plan.destFolderId,
    actions,
    rejected: plan.rejected,
  };
}
