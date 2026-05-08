import { describe, expect, it } from "vitest";
import {
  extensionOf,
  nextKeepBothName,
  planExternalImport,
  resolveImportPlan,
  SUPPORTED_EXTENSIONS,
} from "@/lib/external-import-resolver";

describe("extensionOf", () => {
  it("returns lowercase extension with the leading dot", () => {
    expect(extensionOf("Foo.MD")).toBe(".md");
    expect(extensionOf("Bar.PDF")).toBe(".pdf");
    expect(extensionOf("Baz.XLSX")).toBe(".xlsx");
  });

  it("returns null for files with no extension", () => {
    expect(extensionOf("README")).toBeNull();
    expect(extensionOf("")).toBeNull();
    expect(extensionOf("   ")).toBeNull();
  });

  it("treats dotfiles with no following extension as extension-less", () => {
    // ".gitignore" has no _trailing_ extension; the leading dot is part of
    // the basename. Reject — same as `README`.
    expect(extensionOf(".gitignore")).toBeNull();
  });

  it("uses the rightmost dot for compound names", () => {
    expect(extensionOf("archive.tar.gz")).toBe(".gz");
    expect(extensionOf("Notes.draft.md")).toBe(".md");
  });

  it("returns null when the dot is the last character", () => {
    expect(extensionOf("trailing.")).toBeNull();
  });
});

describe("planExternalImport — whitelist", () => {
  it("accepts every supported extension", () => {
    const plan = planExternalImport({
      items: [
        { name: "Plan.md", srcPath: "/tmp/Plan.md" },
        { name: "Spec.pdf", srcPath: "/tmp/Spec.pdf" },
        { name: "Q3.xlsx", srcPath: "/tmp/Q3.xlsx" },
      ],
      destFolderId: null,
      existingNames: [],
    });

    expect(plan.accepted.map((entry) => entry.item.name)).toEqual([
      "Plan.md",
      "Spec.pdf",
      "Q3.xlsx",
    ]);
    expect(plan.rejected).toHaveLength(0);
    expect(plan.collisions).toHaveLength(0);
  });

  it("normalizes the extension to lowercase on the accepted entry", () => {
    const plan = planExternalImport({
      items: [{ name: "Plan.MD" }],
      destFolderId: null,
      existingNames: [],
    });
    expect(plan.accepted[0].extension).toBe(".md");
  });

  it("rejects unsupported extensions with bad-extension", () => {
    const plan = planExternalImport({
      items: [
        { name: "notes.txt" },
        { name: "report.docx" },
        { name: "logo.png" },
        { name: "extensionless" },
      ],
      destFolderId: null,
      existingNames: [],
    });

    expect(plan.accepted).toHaveLength(0);
    expect(plan.collisions).toHaveLength(0);
    expect(plan.rejected.map((entry) => entry.item.name)).toEqual([
      "notes.txt",
      "report.docx",
      "logo.png",
      "extensionless",
    ]);
    for (const r of plan.rejected) {
      expect(r.reason).toBe("bad-extension");
    }
  });

  it("rejects .markdown — only .md is whitelisted in this slice", () => {
    // The PRD pins the whitelist to `.md / .pdf / .xlsx` literally. `.markdown`
    // is supported elsewhere but #67's whitelist test calls it out explicitly.
    const plan = planExternalImport({
      items: [{ name: "Doc.markdown" }],
      destFolderId: null,
      existingNames: [],
    });
    expect(plan.rejected[0]?.reason).toBe("bad-extension");
  });

  it("exports the canonical whitelist as a readonly tuple", () => {
    expect(SUPPORTED_EXTENSIONS).toEqual([".md", ".pdf", ".xlsx"]);
  });
});

describe("planExternalImport — collisions", () => {
  it("routes whitelisted items with same-name destination matches into collisions", () => {
    const plan = planExternalImport({
      items: [{ name: "Plan.md" }, { name: "Fresh.md" }],
      destFolderId: "folder-1",
      existingNames: ["Plan.md", "Other.md"],
    });

    expect(plan.accepted.map((entry) => entry.item.name)).toEqual(["Fresh.md"]);
    expect(plan.collisions.map((entry) => entry.item.name)).toEqual(["Plan.md"]);
    expect(plan.collisions[0]).toMatchObject({
      existingName: "Plan.md",
      extension: ".md",
    });
  });

  it("a rejected non-whitelisted item never falls through to collisions even if the name clashes", () => {
    const plan = planExternalImport({
      items: [{ name: "Plan.txt" }],
      destFolderId: null,
      existingNames: ["Plan.txt"],
    });
    expect(plan.rejected).toHaveLength(1);
    expect(plan.collisions).toHaveLength(0);
    expect(plan.accepted).toHaveLength(0);
  });

  it("collision detection is case-sensitive (mirrors the on-disk source of truth)", () => {
    const plan = planExternalImport({
      items: [{ name: "plan.md" }],
      destFolderId: null,
      existingNames: ["Plan.md"],
    });
    expect(plan.accepted).toHaveLength(1);
    expect(plan.collisions).toHaveLength(0);
  });
});

describe("planExternalImport — bucket shape", () => {
  it("returns the three buckets plus the destFolderId echo", () => {
    const plan = planExternalImport({
      items: [],
      destFolderId: "folder-xyz",
      existingNames: [],
    });
    expect(plan).toEqual({
      destFolderId: "folder-xyz",
      accepted: [],
      rejected: [],
      collisions: [],
    });
  });

  it("preserves item order across buckets in a mixed batch", () => {
    const plan = planExternalImport({
      items: [
        { name: "A.md" },
        { name: "B.txt" },
        { name: "C.pdf" },
        { name: "D.xlsx" }, // collision
        { name: "E.png" },
      ],
      destFolderId: null,
      existingNames: ["D.xlsx"],
    });

    expect(plan.accepted.map((entry) => entry.item.name)).toEqual(["A.md", "C.pdf"]);
    expect(plan.rejected.map((entry) => entry.item.name)).toEqual(["B.txt", "E.png"]);
    expect(plan.collisions.map((entry) => entry.item.name)).toEqual(["D.xlsx"]);
  });

  it("each bucket entry carries the original item reference (no clone)", () => {
    const item = { name: "Plan.md", srcPath: "/tmp/Plan.md" };
    const plan = planExternalImport({
      items: [item],
      destFolderId: null,
      existingNames: [],
    });
    expect(plan.accepted[0].item).toBe(item);
  });
});

describe("nextKeepBothName", () => {
  it("appends (2) when the base name has no numeric suffix and no other clashes exist", () => {
    expect(nextKeepBothName("Foo.md", new Set(["Foo.md"]))).toBe("Foo (2).md");
  });

  it("increments past the highest existing (N) at the destination", () => {
    expect(nextKeepBothName("Foo.md", new Set(["Foo.md", "Foo (2).md"]))).toBe("Foo (3).md");
    expect(
      nextKeepBothName("Foo.md", new Set(["Foo.md", "Foo (2).md", "Foo (5).md"]))
    ).toBe("Foo (6).md");
  });

  it("anchors counting on the bare stem so `Foo (2).md` re-collisions land on `Foo (3).md`", () => {
    // The user dragged a file literally named `Foo (2).md` and it clashed.
    // The new copy should slot after the highest sibling, not double-suffix.
    expect(nextKeepBothName("Foo (2).md", new Set(["Foo (2).md"]))).toBe("Foo (3).md");
  });

  it("preserves the original extension casing", () => {
    expect(nextKeepBothName("Plan.MD", new Set(["Plan.MD"]))).toBe("Plan (2).MD");
  });
});

describe("resolveImportPlan", () => {
  it("passes accepted items straight through as create actions", () => {
    const plan = planExternalImport({
      items: [
        { name: "A.md", srcPath: "/tmp/A.md" },
        { name: "B.pdf", srcPath: "/tmp/B.pdf" },
      ],
      destFolderId: "folder-1",
      existingNames: [],
    });

    const resolved = resolveImportPlan({ plan, existingNames: [], decisions: {} });

    expect(resolved.destFolderId).toBe("folder-1");
    expect(resolved.actions).toEqual([
      { item: plan.accepted[0].item, extension: ".md", name: "A.md", mode: "create" },
      { item: plan.accepted[1].item, extension: ".pdf", name: "B.pdf", mode: "create" },
    ]);
    expect(resolved.rejected).toHaveLength(0);
  });

  it("a per-collision skip removes the item from the final plan", () => {
    const plan = planExternalImport({
      items: [{ name: "Plan.md", srcPath: "/tmp/Plan.md" }],
      destFolderId: null,
      existingNames: ["Plan.md"],
    });

    const resolved = resolveImportPlan({
      plan,
      existingNames: ["Plan.md"],
      decisions: { "Plan.md": "skip" },
    });

    expect(resolved.actions).toHaveLength(0);
    expect(resolved.rejected).toHaveLength(0);
  });

  it("replace produces an action with mode: 'replace' and the original name", () => {
    const plan = planExternalImport({
      items: [{ name: "Plan.md", srcPath: "/tmp/Plan.md" }],
      destFolderId: "folder-1",
      existingNames: ["Plan.md"],
    });

    const resolved = resolveImportPlan({
      plan,
      existingNames: ["Plan.md"],
      decisions: { "Plan.md": "replace" },
    });

    expect(resolved.actions).toEqual([
      {
        item: plan.collisions[0].item,
        extension: ".md",
        name: "Plan.md",
        mode: "replace",
      },
    ]);
  });

  it("keep-both renames the file to `Foo (2).md` when the base name clashes", () => {
    const plan = planExternalImport({
      items: [{ name: "Plan.md", srcPath: "/tmp/Plan.md" }],
      destFolderId: null,
      existingNames: ["Plan.md"],
    });

    const resolved = resolveImportPlan({
      plan,
      existingNames: ["Plan.md"],
      decisions: { "Plan.md": "keep-both" },
    });

    expect(resolved.actions).toHaveLength(1);
    expect(resolved.actions[0]).toMatchObject({
      name: "Plan (2).md",
      mode: "create",
    });
  });

  it("a second keep-both on the same stem in one batch lands at `Foo (3).md`", () => {
    // Two distinct collisions sharing a root — possible when the user drops
    // two files literally named `Plan.md` from different OS paths in one batch.
    // (The DataTransfer API allows duplicate names because each File has its
    // own srcPath / bytes; the planner routes both into `collisions`.)
    const plan: ReturnType<typeof planExternalImport> = {
      destFolderId: null,
      accepted: [],
      rejected: [],
      collisions: [
        {
          item: { name: "Plan.md", srcPath: "/tmp/a/Plan.md" },
          extension: ".md",
          existingName: "Plan.md",
        },
        {
          item: { name: "Plan.md", srcPath: "/tmp/b/Plan.md" },
          extension: ".md",
          existingName: "Plan.md",
        },
      ],
    };

    const resolved = resolveImportPlan({
      plan,
      existingNames: ["Plan.md"],
      decisions: { "Plan.md": "keep-both" },
    });

    // First keep-both lands at (2); the second sees (2) reserved and rolls to (3).
    expect(resolved.actions.map((a) => a.name)).toEqual(["Plan (2).md", "Plan (3).md"]);
    expect(resolved.actions.every((a) => a.mode === "create")).toBe(true);
  });

  it("mixed batch: accepted + rejected + collisions populates all branches", () => {
    const plan = planExternalImport({
      items: [
        { name: "A.md", srcPath: "/tmp/A.md" }, // accepted
        { name: "B.txt", srcPath: "/tmp/B.txt" }, // rejected
        { name: "C.pdf", srcPath: "/tmp/C.pdf" }, // collision → replace
        { name: "D.xlsx", srcPath: "/tmp/D.xlsx" }, // collision → keep-both
        { name: "E.png" }, // rejected
        { name: "F.md", srcPath: "/tmp/F.md" }, // collision → skip
      ],
      destFolderId: "folder-x",
      existingNames: ["C.pdf", "D.xlsx", "F.md"],
    });

    const resolved = resolveImportPlan({
      plan,
      existingNames: ["C.pdf", "D.xlsx", "F.md"],
      decisions: {
        "C.pdf": "replace",
        "D.xlsx": "keep-both",
        "F.md": "skip",
      },
    });

    expect(resolved.destFolderId).toBe("folder-x");
    expect(resolved.actions).toEqual([
      { item: plan.accepted[0].item, extension: ".md", name: "A.md", mode: "create" },
      {
        item: plan.collisions[0].item,
        extension: ".pdf",
        name: "C.pdf",
        mode: "replace",
      },
      {
        item: plan.collisions[1].item,
        extension: ".xlsx",
        name: "D (2).xlsx",
        mode: "create",
      },
    ]);
    expect(resolved.rejected.map((r) => r.item.name)).toEqual(["B.txt", "E.png"]);
  });

  it("throws when a collision is missing a decision", () => {
    const plan = planExternalImport({
      items: [{ name: "Plan.md" }, { name: "Other.md" }],
      destFolderId: null,
      existingNames: ["Plan.md", "Other.md"],
    });

    expect(() =>
      resolveImportPlan({
        plan,
        existingNames: ["Plan.md", "Other.md"],
        // Decision provided for "Plan.md" but not "Other.md".
        decisions: { "Plan.md": "skip" },
      })
    ).toThrow(/Other\.md/);
  });

  it("keep-both reserves names mid-batch so an accepted file shadows a (2)", () => {
    // The user drops `Plan.md` (collision → keep-both) and `Plan (2).md`
    // (accepted) in the same batch. The accepted entry already takes the
    // (2) slot, so the keep-both should walk to (3).
    const plan = planExternalImport({
      items: [
        { name: "Plan.md", srcPath: "/tmp/Plan.md" },
        { name: "Plan (2).md", srcPath: "/tmp/Plan2.md" },
      ],
      destFolderId: null,
      existingNames: ["Plan.md"],
    });

    const resolved = resolveImportPlan({
      plan,
      existingNames: ["Plan.md"],
      decisions: { "Plan.md": "keep-both" },
    });

    const names = resolved.actions.map((a) => a.name).sort();
    expect(names).toContain("Plan (2).md");
    expect(names).toContain("Plan (3).md");
  });
});
