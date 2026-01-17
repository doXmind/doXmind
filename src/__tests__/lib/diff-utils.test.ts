/**
 * Tests for diff utilities
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeDiffHunks,
  areAllHunksProcessed,
  getPendingHunkCount,
  findTextInDoc,
  findLinePosition,
  mapHunkPositions,
  fuzzyIndexOf,
  type DocWithContent,
} from "@/lib/diff-utils";
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

// Helper to create a mock ProseMirror document
function createMockDoc(content: string): DocWithContent {
  return {
    textContent: content,
    nodeSize: content.length + 2, // +2 for doc node boundaries
  };
}

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

      it("returns empty when old_str is empty (use insert operation instead)", () => {
        // str_replace with empty old_str returns empty array
        // The insert operation type should be used for insertions
        const edit: EditOperation = {
          type: "str_replace",
          old_str: "",
          new_str: "inserted text",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
        };

        const hunks = computeDiffHunks("Some content", edit);

        // Empty old_str is treated as invalid for str_replace
        // The code checks !edit.old_str which is falsy for empty string
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

      it("handles HTML content by converting to markdown", () => {
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
        // searchText should be plain text version
        expect(hunks[0].searchText).toBe("Hello World");
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

    describe("insert operation", () => {
      it("creates insert hunk at specified line with doc", () => {
        const doc = createMockDoc("Line 1\nLine 2\nLine 3");
        const edit: EditOperation = {
          type: "insert",
          insert_line: 1,
          new_str: "Inserted Line",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
        };

        const hunks = computeDiffHunks("Line 1\nLine 2\nLine 3", edit, doc);

        expect(hunks).toHaveLength(1);
        expect(hunks[0].type).toBe("insert");
        expect(hunks[0].oldContent).toBe("");
        expect(hunks[0].newContent).toBe("Inserted Line");
        expect(hunks[0].from).toBe(hunks[0].to); // Insert: from === to
      });

      it("creates insert hunk without doc (fallback calculation)", () => {
        const edit: EditOperation = {
          type: "insert",
          insert_line: 1,
          new_str: "Inserted Line",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
        };

        const hunks = computeDiffHunks("Line 1\nLine 2\nLine 3", edit);

        expect(hunks).toHaveLength(1);
        expect(hunks[0].type).toBe("insert");
        expect(hunks[0].newContent).toBe("Inserted Line");
      });

      it("returns empty array when insert_line is undefined", () => {
        const edit: EditOperation = {
          type: "insert",
          new_str: "Inserted Line",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
        } as EditOperation;

        const hunks = computeDiffHunks("Some content", edit);

        expect(hunks).toHaveLength(0);
      });

      it("returns empty array when new_str is undefined", () => {
        const edit: EditOperation = {
          type: "insert",
          insert_line: 1,
          file_id: "file-1",
          file_name: "test.md",
          success: true,
        } as EditOperation;

        const hunks = computeDiffHunks("Some content", edit);

        expect(hunks).toHaveLength(0);
      });

      it("has empty searchText for insert type", () => {
        const edit: EditOperation = {
          type: "insert",
          insert_line: 0,
          new_str: "New content",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
        };

        const hunks = computeDiffHunks("Original", edit);

        expect(hunks[0].searchText).toBe("");
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

      it("converts HTML original content to markdown", () => {
        const htmlContent = "<p>Original <em>content</em></p>";
        const edit: EditOperation = {
          type: "replace_all",
          new_content: "New content",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
        };

        const hunks = computeDiffHunks(htmlContent, edit);

        // Turndown converts <em> to underscore style by default
        expect(hunks[0].oldContent).toBe("Original _content_");
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
  // findTextInDoc tests
  // ============================================================================
  describe("findTextInDoc", () => {
    it("finds exact text match", () => {
      const doc = createMockDoc("Hello World");
      const result = findTextInDoc(doc, "World");

      expect(result).not.toBeNull();
      expect(result!.from).toBe(7); // Index 6 + 1 for ProseMirror offset
      expect(result!.to).toBe(12); // from + length
    });

    it("finds text at start of document", () => {
      const doc = createMockDoc("Hello World");
      const result = findTextInDoc(doc, "Hello");

      expect(result).not.toBeNull();
      expect(result!.from).toBe(1);
      expect(result!.to).toBe(6);
    });

    it("returns null when text not found", () => {
      const doc = createMockDoc("Hello World");
      const result = findTextInDoc(doc, "Universe");

      expect(result).toBeNull();
    });

    it("finds text with normalized whitespace", () => {
      const doc = createMockDoc("Hello    World"); // Multiple spaces
      const result = findTextInDoc(doc, "Hello World"); // Single space

      expect(result).not.toBeNull();
    });

    it("handles empty search text", () => {
      const doc = createMockDoc("Hello World");
      const result = findTextInDoc(doc, "");

      expect(result).not.toBeNull();
      expect(result!.from).toBe(1);
    });
  });

  // ============================================================================
  // findLinePosition tests
  // ============================================================================
  describe("findLinePosition", () => {
    it("returns position at start of document for line 0", () => {
      const doc = createMockDoc("Line 1\nLine 2\nLine 3");
      const pos = findLinePosition(doc, 0);

      expect(pos).toBe(1);
    });

    it("returns position at start of line 1", () => {
      const doc = createMockDoc("Line 1\nLine 2\nLine 3");
      const pos = findLinePosition(doc, 1);

      // "Line 1\n" = 7 chars, so line 2 starts at position 8
      expect(pos).toBe(8);
    });

    it("returns position at start of line 2", () => {
      const doc = createMockDoc("Line 1\nLine 2\nLine 3");
      const pos = findLinePosition(doc, 2);

      // "Line 1\nLine 2\n" = 14 chars, so line 3 starts at position 15
      expect(pos).toBe(15);
    });

    it("returns end of document for line beyond document", () => {
      const doc = createMockDoc("Line 1\nLine 2");
      const pos = findLinePosition(doc, 10);

      expect(pos).toBe(doc.nodeSize - 2);
    });

    it("returns start for negative line number", () => {
      const doc = createMockDoc("Line 1\nLine 2");
      const pos = findLinePosition(doc, -1);

      expect(pos).toBe(1);
    });
  });

  // ============================================================================
  // mapHunkPositions tests
  // ============================================================================
  describe("mapHunkPositions", () => {
    it("does not adjust hunks before the change", () => {
      const hunks: DiffHunk[] = [createTestHunk({ from: 0, to: 5 })];
      const result = mapHunkPositions(hunks, 10, 5, 10);

      expect(result[0].from).toBe(0);
      expect(result[0].to).toBe(5);
    });

    it("shifts hunks after the change", () => {
      const hunks: DiffHunk[] = [createTestHunk({ from: 20, to: 30 })];
      // Change at position 10, removed 5 chars, added 10 chars = +5 offset
      const result = mapHunkPositions(hunks, 10, 5, 10);

      expect(result[0].from).toBe(25);
      expect(result[0].to).toBe(35);
    });

    it("handles negative offset (content removed)", () => {
      const hunks: DiffHunk[] = [createTestHunk({ from: 20, to: 30 })];
      // Removed 10 chars, added 5 = -5 offset
      const result = mapHunkPositions(hunks, 10, 10, 5);

      expect(result[0].from).toBe(15);
      expect(result[0].to).toBe(25);
    });

    it("marks overlapping hunks as rejected", () => {
      const hunks: DiffHunk[] = [createTestHunk({ from: 10, to: 20, status: "pending" })];
      // Change overlaps with hunk (change at 15, within 10-20)
      const result = mapHunkPositions(hunks, 15, 5, 10);

      expect(result[0].status).toBe("rejected");
    });

    it("handles multiple hunks correctly", () => {
      const hunks: DiffHunk[] = [
        createTestHunk({ id: "1", from: 0, to: 5 }),
        createTestHunk({ id: "2", from: 30, to: 40 }),
        createTestHunk({ id: "3", from: 50, to: 60 }),
      ];
      // Change at position 20, removed 5, added 15 = +10 offset
      const result = mapHunkPositions(hunks, 20, 5, 15);

      expect(result[0].from).toBe(0); // Before change, unchanged
      expect(result[0].to).toBe(5);

      expect(result[1].from).toBe(40); // After change, shifted +10
      expect(result[1].to).toBe(50);

      expect(result[2].from).toBe(60); // After change, shifted +10
      expect(result[2].to).toBe(70);
    });

    it("handles empty hunks array", () => {
      const result = mapHunkPositions([], 10, 5, 10);
      expect(result).toEqual([]);
    });

    it("preserves other hunk properties", () => {
      const hunks: DiffHunk[] = [
        createTestHunk({
          from: 30,
          to: 40,
          type: "insert",
          oldContent: "old",
          newContent: "new",
          status: "pending",
        }),
      ];
      const result = mapHunkPositions(hunks, 10, 5, 10);

      expect(result[0].type).toBe("insert");
      expect(result[0].oldContent).toBe("old");
      expect(result[0].newContent).toBe("new");
      expect(result[0].status).toBe("pending");
    });
  });

  // ============================================================================
  // fuzzyIndexOf tests
  // ============================================================================
  describe("fuzzyIndexOf", () => {
    it("finds exact match", () => {
      const index = fuzzyIndexOf("Hello World", "World");
      expect(index).toBe(6);
    });

    it("finds match with normalized whitespace in haystack", () => {
      const index = fuzzyIndexOf("Hello    World", "Hello World");
      expect(index).toBeGreaterThanOrEqual(0);
    });

    it("finds match with normalized whitespace in needle", () => {
      const index = fuzzyIndexOf("Hello World", "Hello    World");
      expect(index).toBeGreaterThanOrEqual(0);
    });

    it("returns -1 when not found", () => {
      const index = fuzzyIndexOf("Hello World", "Universe");
      expect(index).toBe(-1);
    });

    it("handles empty needle", () => {
      const index = fuzzyIndexOf("Hello World", "");
      expect(index).toBe(0);
    });

    it("handles empty haystack", () => {
      const index = fuzzyIndexOf("", "Hello");
      expect(index).toBe(-1);
    });

    it("handles newlines and tabs", () => {
      const index = fuzzyIndexOf("Hello\nWorld", "Hello World");
      expect(index).toBeGreaterThanOrEqual(0);
    });

    it("finds text at start", () => {
      const index = fuzzyIndexOf("Hello World", "Hello");
      expect(index).toBe(0);
    });

    it("finds text at end", () => {
      const index = fuzzyIndexOf("Hello World", "World");
      expect(index).toBe(6);
    });
  });
});
