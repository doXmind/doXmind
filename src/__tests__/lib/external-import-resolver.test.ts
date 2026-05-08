import { describe, expect, it } from "vitest";
import {
  extensionOf,
  planExternalImport,
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
