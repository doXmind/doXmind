/**
 * Tests for diff utilities
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeDiffHunks, areAllHunksProcessed, getPendingHunkCount } from "@/lib/diff-utils";
import { findTextInDoc } from "@/lib/position-mapper";
import type { DiffHunk, EditOperation } from "@/types/diff";

// Mock generateId to return predictable IDs for testing
vi.mock("@/lib/utils", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/utils")>();
  let idCounter = 0;
  return {
    ...original,
    generateId: vi.fn(() => `test-id-${++idCounter}`),
  };
});

// Helper to create a hunk for testing
function createTestHunk(overrides: Partial<DiffHunk> = {}): DiffHunk {
  return {
    id: "test-hunk-1",
    type: "replace",
    from: 0,
    to: 10,
    oldContent: "old text",
    searchText: "old text",
    newContent: "new text",
    status: "pending",
    createdAt: new Date().toISOString(),
    editId: "test-edit-1",
    ...overrides,
  };
}

describe("diff-utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // computeDiffHunks tests
  // ============================================================================
  describe("computeDiffHunks", () => {
    describe("str_replace operation", () => {
      it("creates replace hunk for text replacement", () => {
        const edit: EditOperation = {
          type: "str_replace",
          old_str: "Hello World",
          new_str: "Hello Universe",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
        };

        const hunks = computeDiffHunks("Hello World", edit);

        expect(hunks).toHaveLength(1);
        expect(hunks[0].type).toBe("replace");
        expect(hunks[0].oldContent).toBe("Hello World");
        expect(hunks[0].newContent).toBe("Hello Universe");
        expect(hunks[0].status).toBe("pending");
        expect(hunks[0].editId).toBe("file-1");
      });

      it("creates delete hunk when new_str is empty", () => {
        const edit: EditOperation = {
          type: "str_replace",
          old_str: "delete this",
          new_str: "",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
        };

        const hunks = computeDiffHunks("Some content delete this more content", edit);

        expect(hunks).toHaveLength(1);
        expect(hunks[0].type).toBe("delete");
        expect(hunks[0].oldContent).toBe("delete this");
        expect(hunks[0].newContent).toBe("");
      });

      it("returns empty when old_str is empty", () => {
        const edit: EditOperation = {
          type: "str_replace",
          old_str: "",
          new_str: "inserted text",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
        };

        const hunks = computeDiffHunks("Some content", edit);

        expect(hunks).toHaveLength(0);
      });

      it("returns empty array when old_str is missing", () => {
        const edit: EditOperation = {
          type: "str_replace",
          new_str: "new text",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
        } as EditOperation;

        const hunks = computeDiffHunks("Some content", edit);

        expect(hunks).toHaveLength(0);
      });

      it("returns empty array when new_str is undefined", () => {
        const edit: EditOperation = {
          type: "str_replace",
          old_str: "old text",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
        } as EditOperation;

        const hunks = computeDiffHunks("Some content with old text", edit);

        expect(hunks).toHaveLength(0);
      });

      it("uses edit.old_str for oldContent regardless of input format", () => {
        const htmlContent = "<p>Hello <strong>World</strong></p>";
        const edit: EditOperation = {
          type: "str_replace",
          old_str: "Hello **World**", // AI uses markdown
          new_str: "Hello **Universe**",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
        };

        const hunks = computeDiffHunks(htmlContent, edit);

        expect(hunks).toHaveLength(1);
        expect(hunks[0].oldContent).toBe("Hello **World**");
      });

      it("generates searchText from markdown for doc searching", () => {
        const edit: EditOperation = {
          type: "str_replace",
          old_str: "Hello **World**",
          new_str: "Hello **Universe**",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
        };

        const hunks = computeDiffHunks("Hello **World**", edit);

        expect(hunks).toHaveLength(1);
        // searchText is raw markdown (matching now uses Apply-and-Diff on full document)
        expect(hunks[0].searchText).toBe("Hello **World**");
      });

      it("generates unique IDs for each hunk", () => {
        const edit: EditOperation = {
          type: "str_replace",
          old_str: "text",
          new_str: "new text",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
        };

        const hunks1 = computeDiffHunks("text", edit);
        const hunks2 = computeDiffHunks("text", edit);

        expect(hunks1[0].id).not.toBe(hunks2[0].id);
      });

      it("includes createdAt timestamp", () => {
        const edit: EditOperation = {
          type: "str_replace",
          old_str: "text",
          new_str: "new text",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
        };

        const before = new Date().toISOString();
        const hunks = computeDiffHunks("text", edit);
        const after = new Date().toISOString();

        expect(hunks[0].createdAt >= before).toBe(true);
        expect(hunks[0].createdAt <= after).toBe(true);
      });
    });

    describe("replace_all operation", () => {
      it("creates single full document replace hunk", () => {
        const edit: EditOperation = {
          type: "replace_all",
          new_content: "Completely new content",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
        };

        const hunks = computeDiffHunks("Original content", edit);

        expect(hunks).toHaveLength(1);
        expect(hunks[0].type).toBe("replace");
        expect(hunks[0].isFullDocumentReplace).toBe(true);
        expect(hunks[0].oldContent).toBe("Original content");
        expect(hunks[0].newContent).toBe("Completely new content");
      });

      it("sets from to 0 and to to -1 (special marker)", () => {
        const edit: EditOperation = {
          type: "replace_all",
          new_content: "New content",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
        };

        const hunks = computeDiffHunks("Original", edit);

        expect(hunks[0].from).toBe(0);
        expect(hunks[0].to).toBe(-1); // Special marker for end of document
      });

      it("has empty searchText for full document replace", () => {
        const edit: EditOperation = {
          type: "replace_all",
          new_content: "New content",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
        };

        const hunks = computeDiffHunks("Original", edit);

        expect(hunks[0].searchText).toBe("");
      });

      it("returns empty array when new_content is undefined", () => {
        const edit: EditOperation = {
          type: "replace_all",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
        } as EditOperation;

        const hunks = computeDiffHunks("Original", edit);

        expect(hunks).toHaveLength(0);
      });

      it("uses provided originalMarkdown for oldContent", () => {
        const htmlContent = "<p>Original <em>content</em></p>";
        const edit: EditOperation = {
          type: "replace_all",
          new_content: "New content",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
        };

        // Pass pre-computed markdown via 3rd parameter (from contentMarkdown cache)
        const hunks = computeDiffHunks(htmlContent, edit, "Original *content*");

        expect(hunks[0].oldContent).toBe("Original *content*");
      });

      it("falls back to raw content when no originalMarkdown provided", () => {
        const edit: EditOperation = {
          type: "replace_all",
          new_content: "New content",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
        };

        const hunks = computeDiffHunks("Original content", edit);

        expect(hunks[0].oldContent).toBe("Original content");
      });
    });
  });

  // ============================================================================
  // areAllHunksProcessed tests
  // ============================================================================
  describe("areAllHunksProcessed", () => {
    it("returns true when all hunks are accepted", () => {
      const hunks: DiffHunk[] = [
        createTestHunk({ status: "accepted" }),
        createTestHunk({ status: "accepted" }),
      ];

      expect(areAllHunksProcessed(hunks)).toBe(true);
    });

    it("returns true when all hunks are rejected", () => {
      const hunks: DiffHunk[] = [
        createTestHunk({ status: "rejected" }),
        createTestHunk({ status: "rejected" }),
      ];

      expect(areAllHunksProcessed(hunks)).toBe(true);
    });

    it("returns true when hunks are mixed accepted/rejected", () => {
      const hunks: DiffHunk[] = [
        createTestHunk({ status: "accepted" }),
        createTestHunk({ status: "rejected" }),
      ];

      expect(areAllHunksProcessed(hunks)).toBe(true);
    });

    it("returns false when any hunk is pending", () => {
      const hunks: DiffHunk[] = [
        createTestHunk({ status: "accepted" }),
        createTestHunk({ status: "pending" }),
      ];

      expect(areAllHunksProcessed(hunks)).toBe(false);
    });

    it("returns false when all hunks are pending", () => {
      const hunks: DiffHunk[] = [
        createTestHunk({ status: "pending" }),
        createTestHunk({ status: "pending" }),
      ];

      expect(areAllHunksProcessed(hunks)).toBe(false);
    });

    it("returns true for empty array", () => {
      expect(areAllHunksProcessed([])).toBe(true);
    });
  });

  // ============================================================================
  // getPendingHunkCount tests
  // ============================================================================
  describe("getPendingHunkCount", () => {
    it("returns count of pending hunks", () => {
      const hunks: DiffHunk[] = [
        createTestHunk({ status: "pending" }),
        createTestHunk({ status: "accepted" }),
        createTestHunk({ status: "pending" }),
        createTestHunk({ status: "rejected" }),
      ];

      expect(getPendingHunkCount(hunks)).toBe(2);
    });

    it("returns 0 when no pending hunks", () => {
      const hunks: DiffHunk[] = [
        createTestHunk({ status: "accepted" }),
        createTestHunk({ status: "rejected" }),
      ];

      expect(getPendingHunkCount(hunks)).toBe(0);
    });

    it("returns total count when all pending", () => {
      const hunks: DiffHunk[] = [
        createTestHunk({ status: "pending" }),
        createTestHunk({ status: "pending" }),
        createTestHunk({ status: "pending" }),
      ];

      expect(getPendingHunkCount(hunks)).toBe(3);
    });

    it("returns 0 for empty array", () => {
      expect(getPendingHunkCount([])).toBe(0);
    });
  });

  // ============================================================================
  // computeDiffHunks — markdownOffset propagation
  // ============================================================================
  describe("computeDiffHunks — markdownOffset propagation", () => {
    it("propagates offset from edit to hunk", () => {
      const edit: EditOperation = {
        type: "str_replace",
        old_str: "Hello World",
        new_str: "Hello Universe",
        file_id: "file-1",
        file_name: "test.md",
        success: true,
        offset: 42,
      };

      const hunks = computeDiffHunks("prefix\nHello World\nsuffix", edit);

      expect(hunks).toHaveLength(1);
      expect(hunks[0].markdownOffset).toBe(42);
    });

    it("sets markdownOffset to undefined when edit has no offset", () => {
      const edit: EditOperation = {
        type: "str_replace",
        old_str: "Hello World",
        new_str: "Hello Universe",
        file_id: "file-1",
        file_name: "test.md",
        success: true,
      };

      const hunks = computeDiffHunks("Hello World", edit);

      expect(hunks).toHaveLength(1);
      expect(hunks[0].markdownOffset).toBeUndefined();
    });

    it("propagates offset=0 correctly", () => {
      const edit: EditOperation = {
        type: "str_replace",
        old_str: "Hello",
        new_str: "Hi",
        file_id: "file-1",
        file_name: "test.md",
        success: true,
        offset: 0,
      };

      const hunks = computeDiffHunks("Hello World", edit);

      expect(hunks).toHaveLength(1);
      expect(hunks[0].markdownOffset).toBe(0);
    });

    it("does not set markdownOffset on replace_all hunks", () => {
      const edit: EditOperation = {
        type: "replace_all",
        new_content: "New content",
        file_id: "file-1",
        file_name: "test.md",
        success: true,
        offset: 0,
      };

      const hunks = computeDiffHunks("Original", edit);

      expect(hunks).toHaveLength(1);
      expect(hunks[0].markdownOffset).toBeUndefined();
    });
  });

  // ============================================================================
  // findTextInDoc tests (exact match only)
  // ============================================================================
  describe("findTextInDoc", () => {
    it("finds exact text match", () => {
      const doc = { textContent: "Hello World", nodeSize: 13 };
      const result = findTextInDoc(doc, "World");

      expect(result).not.toBeNull();
      expect(result!.from).toBe(7); // Index 6 + 1 for ProseMirror offset
      expect(result!.to).toBe(12); // from + length
    });

    it("finds text at start of document", () => {
      const doc = { textContent: "Hello World", nodeSize: 13 };
      const result = findTextInDoc(doc, "Hello");

      expect(result).not.toBeNull();
      expect(result!.from).toBe(1);
      expect(result!.to).toBe(6);
    });

    it("returns null when text not found", () => {
      const doc = { textContent: "Hello World", nodeSize: 13 };
      const result = findTextInDoc(doc, "Universe");

      expect(result).toBeNull();
    });

    it("returns null for whitespace-different text (no fuzzy matching)", () => {
      const doc = { textContent: "Hello    World", nodeSize: 16 };
      const result = findTextInDoc(doc, "Hello World"); // Single space

      // Exact match only — should NOT match
      expect(result).toBeNull();
    });

    it("handles empty search text", () => {
      const doc = { textContent: "Hello World", nodeSize: 13 };
      const result = findTextInDoc(doc, "");

      expect(result).not.toBeNull();
      expect(result!.from).toBe(1);
    });
  });
});
