import { describe, it, expect } from "vitest";
import {
  evaluateSidebarDrop,
  type DnDNode,
} from "@/lib/sidebar-dnd-policy";

/**
 * Test tree (mirrors the file-store shape — only the four fields the policy
 * cares about):
 *
 *   root/
 *   ├── notes (folder, id=F1)
 *   │   ├── intro.md (file, id=D1, parent=F1)
 *   │   └── inbox (folder, id=F2, parent=F1)
 *   │       └── stub.md (file, id=D2, parent=F2)
 *   ├── archive (folder, id=F3)
 *   ├── inbox (folder, id=F4)   ← same name as F2 (different parent)
 *   └── readme.md (file, id=D3, parent=null)
 */
const TREE: DnDNode[] = [
  { id: "F1", name: "notes", isFolder: true, parentId: null },
  { id: "F2", name: "inbox", isFolder: true, parentId: "F1" },
  { id: "F3", name: "archive", isFolder: true, parentId: null },
  { id: "F4", name: "inbox", isFolder: true, parentId: null },
  { id: "D1", name: "intro.md", isFolder: false, parentId: "F1" },
  { id: "D2", name: "stub.md", isFolder: false, parentId: "F2" },
  { id: "D3", name: "readme.md", isFolder: false, parentId: null },
];

describe("evaluateSidebarDrop", () => {
  it("drop file on folder → ok", () => {
    // readme.md (root) dropped on notes folder → moves into notes
    const result = evaluateSidebarDrop({
      sourceId: "D3",
      targetId: "F1",
      tree: TREE,
    });
    expect(result.verdict).toBe("ok");
    expect(result.destinationParentId).toBe("F1");
  });

  it("drop file on file → resolves to that file's parent (ok when different parent)", () => {
    // readme.md (root) dropped on intro.md (parent=F1) → moves into F1
    const result = evaluateSidebarDrop({
      sourceId: "D3",
      targetId: "D1",
      tree: TREE,
    });
    expect(result.verdict).toBe("ok");
    expect(result.destinationParentId).toBe("F1");
  });

  it("drop file on file → no-op-same-parent when both share a parent", () => {
    // intro.md (parent=F1) dropped on a sibling that lives in F1.
    // Add a sibling for this case.
    const tree: DnDNode[] = [
      ...TREE,
      { id: "D4", name: "outline.md", isFolder: false, parentId: "F1" },
    ];
    const result = evaluateSidebarDrop({
      sourceId: "D1",
      targetId: "D4",
      tree,
    });
    expect(result.verdict).toBe("no-op-same-parent");
    expect(result.destinationParentId).toBe("F1");
  });

  it("drop folder onto its own descendant → cycle", () => {
    // notes (F1) dropped on stub.md (under inbox under notes) — descendant
    // resolves to F2, which is inside F1 → cycle.
    const result = evaluateSidebarDrop({
      sourceId: "F1",
      targetId: "D2",
      tree: TREE,
    });
    expect(result.verdict).toBe("cycle");
  });

  it("drop folder directly into its own immediate child folder → cycle", () => {
    // notes (F1) dropped on inbox (F2, child of F1) → cycle (destination is F2 inside F1).
    const result = evaluateSidebarDrop({
      sourceId: "F1",
      targetId: "F2",
      tree: TREE,
    });
    expect(result.verdict).toBe("cycle");
  });

  it("drop folder on itself → would-be-self", () => {
    const result = evaluateSidebarDrop({
      sourceId: "F1",
      targetId: "F1",
      tree: TREE,
    });
    expect(result.verdict).toBe("would-be-self");
  });

  it("drop folder where same-name folder already exists at destination → name-collision", () => {
    // F2 (name=inbox, parent=F1) dropped onto root area where F4 (name=inbox, parent=null)
    // already exists → collision.
    const result = evaluateSidebarDrop({
      sourceId: "F2",
      targetId: null,
      tree: TREE,
    });
    expect(result.verdict).toBe("name-collision");
    expect(result.destinationParentId).toBe(null);
  });

  it("drop folder into a folder that already contains a same-name child → name-collision", () => {
    // Build a tree where folder S (name=docs) is under root and folder T contains another
    // child folder also named "docs". Dragging S into T should collide.
    const tree: DnDNode[] = [
      { id: "S", name: "docs", isFolder: true, parentId: null },
      { id: "T", name: "team", isFolder: true, parentId: null },
      { id: "T_DOCS", name: "docs", isFolder: true, parentId: "T" },
    ];
    const result = evaluateSidebarDrop({
      sourceId: "S",
      targetId: "T",
      tree,
    });
    expect(result.verdict).toBe("name-collision");
    expect(result.destinationParentId).toBe("T");
  });

  it("drop on root spacer (target=null) → ok with parent=null", () => {
    // intro.md (parent=F1) dropped on root spacer → moves to root.
    const result = evaluateSidebarDrop({
      sourceId: "D1",
      targetId: null,
      tree: TREE,
    });
    expect(result.verdict).toBe("ok");
    expect(result.destinationParentId).toBe(null);
  });

  it("folder drop on a sub-page (file with file-parent) resolves to the sub-page's parent", () => {
    // sub-page semantics: a file whose parentId is another file id. The policy
    // should resolve that to the sub-page's parent (a file id), not crash.
    const tree: DnDNode[] = [
      { id: "F1", name: "notes", isFolder: true, parentId: null },
      { id: "P", name: "page.md", isFolder: false, parentId: "F1" },
      { id: "SUB", name: "sub.md", isFolder: false, parentId: "P" },
      { id: "OTHER", name: "loose.md", isFolder: false, parentId: null },
    ];
    const result = evaluateSidebarDrop({
      sourceId: "OTHER",
      targetId: "SUB",
      tree,
    });
    expect(result.verdict).toBe("ok");
    expect(result.destinationParentId).toBe("P");
  });

  it("drop folder at same parent → no-op-same-parent (does not flag false collision against self)", () => {
    // F2 (inbox, parent=F1) dropped on intro.md (parent=F1) → same parent, no-op.
    // Critically: F2 must not collide with itself.
    const result = evaluateSidebarDrop({
      sourceId: "F2",
      targetId: "D1",
      tree: TREE,
    });
    expect(result.verdict).toBe("no-op-same-parent");
    expect(result.destinationParentId).toBe("F1");
  });
});
