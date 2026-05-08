/**
 * Sidebar drag-and-drop policy (D1 from PRD #63).
 *
 * Pure verdict function. UI layers consume verdicts; they never re-derive
 * legality rules. Treating this as a single source of truth keeps the
 * not-allowed-cursor / toast-on-collision branches symmetric across the
 * Tauri shell, the browser-dev fallback, and any future entry points.
 *
 * The verdict pipeline:
 *  1. Resolve the drop target to an effective parent folder id (or null = root):
 *     - Drop on a folder    → that folder.
 *     - Drop on a document  → that document's parent.
 *     - Drop on a sub-page  → the sub-page's parent (sub-pages are not drop
 *                              targets themselves; sub-page semantics are
 *                              explicitly out of scope per PRD #63).
 *     - Drop on root spacer → null.
 *  2. Reject self-drop and ancestor-cycle for folder sources.
 *  3. Reject same-name folder collisions at the destination.
 *  4. Return `no-op-same-parent` if source already lives there.
 *
 * The function never mutates input and never reaches into stores or
 * backends — feed it a tree snapshot, get a verdict back.
 */

export type DnDVerdict =
  | "ok"
  | "cycle"
  | "no-op-same-parent"
  | "name-collision"
  | "would-be-self";

export interface DnDNode {
  id: string;
  name: string;
  isFolder: boolean;
  parentId: string | null;
}

export interface DnDInput {
  sourceId: string;
  /** null means the drop landed on the root spacer. */
  targetId: string | null;
  tree: DnDNode[];
}

export interface DnDDecision {
  verdict: DnDVerdict;
  /** Effective destination parent folder id (null = workspace root). */
  destinationParentId: string | null;
}

/**
 * Returns the destination parent id for a drop target:
 *  - target = null              → null (root drop)
 *  - target is a folder         → target.id
 *  - target is a document       → target.parentId
 *  - target id missing from tree → null (treat as root, conservative)
 */
function resolveDestinationParent(
  targetId: string | null,
  tree: DnDNode[]
): string | null {
  if (targetId === null) return null;
  const target = tree.find((n) => n.id === targetId);
  if (!target) return null;
  return target.isFolder ? target.id : target.parentId;
}

/**
 * Walks ancestry of `nodeId` toward the root. Returns true if `candidateId`
 * appears in that chain (i.e. dropping a folder onto its descendant would
 * create a cycle). Defends against malformed trees with a visited set.
 */
function isAncestor(
  candidateId: string,
  nodeId: string,
  tree: DnDNode[]
): boolean {
  const byId = new Map(tree.map((n) => [n.id, n]));
  let current: string | null = nodeId;
  const visited = new Set<string>();
  while (current) {
    if (visited.has(current)) return false; // cycle in tree itself
    visited.add(current);
    if (current === candidateId) return true;
    const node = byId.get(current);
    current = node ? node.parentId : null;
  }
  return false;
}

export function evaluateSidebarDrop(input: DnDInput): DnDDecision {
  const { sourceId, targetId, tree } = input;
  const source = tree.find((n) => n.id === sourceId);

  // No source = nothing meaningful to do; treat as root drop with ok so the
  // caller can decide. In practice the UI never ships an unknown source id
  // because drag payloads come from rendered rows.
  if (!source) {
    return { verdict: "ok", destinationParentId: null };
  }

  // Drop on self → would-be-self (resolved before parent resolution because
  // dropping a folder on itself should never silently become a no-op).
  if (targetId !== null && targetId === sourceId) {
    return { verdict: "would-be-self", destinationParentId: source.parentId };
  }

  const destinationParentId = resolveDestinationParent(targetId, tree);

  // Folder cycle: source is a folder and the destination parent sits inside
  // the source's own subtree. Walking up from destination must not pass
  // through the source.
  if (source.isFolder && destinationParentId !== null) {
    if (destinationParentId === sourceId) {
      return { verdict: "cycle", destinationParentId };
    }
    if (isAncestor(sourceId, destinationParentId, tree)) {
      return { verdict: "cycle", destinationParentId };
    }
  }

  // Same parent → no-op. Cheap to detect and saves the backend a wasted
  // rename round-trip + cache invalidation.
  if (source.parentId === destinationParentId) {
    return { verdict: "no-op-same-parent", destinationParentId };
  }

  // Folder name collision at destination: a same-name folder already lives
  // in the destination parent. Per ADR (proposed) 0007 we reject — no
  // merge, no replace. Document collisions are not handled here; the
  // backend reports its own destination-exists error for those because the
  // resolution path for documents is rename-with-suffix at a different layer.
  if (source.isFolder) {
    const collision = tree.some(
      (n) =>
        n.isFolder &&
        n.parentId === destinationParentId &&
        n.id !== sourceId &&
        n.name === source.name
    );
    if (collision) {
      return { verdict: "name-collision", destinationParentId };
    }
  }

  return { verdict: "ok", destinationParentId };
}
