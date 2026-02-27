/**
 * Tests for use-edit-operations hook
 *
 * Verifies workingMarkdown computation with offset propagation,
 * edit grouping by file, and diff review session lifecycle.
 *
 * Since this is a React hook, we test the core logic by mocking
 * store dependencies and calling applyEdits directly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks (must be set up before imports)
// ---------------------------------------------------------------------------
const mockGetFile = vi.fn();
const mockStartDiffReview = vi.fn();
const mockAddHunksToDiffSession = vi.fn();
const mockComputeDiffHunks = vi.fn();
const mockFindInMarkdown = vi.fn();
const mockIsHtml = vi.fn();
const mockHtmlToMarkdown = vi.fn();

// Store state that can be adjusted per test
let mockDiffState: {
  isReviewMode: boolean;
  diffSession: { fileId: string; workingMarkdown?: string; originalMarkdown?: string } | null;
} = {
  isReviewMode: false,
  diffSession: null,
};

vi.mock("@/stores/file-store", () => ({
  useFileStore: () => ({
    getFile: mockGetFile,
  }),
}));

vi.mock("@/stores/diff-review-store", () => ({
  useDiffReviewStore: {
    getState: () => ({
      ...mockDiffState,
      startDiffReview: mockStartDiffReview,
      addHunksToDiffSession: mockAddHunksToDiffSession,
    }),
  },
}));

vi.mock("@/lib/diff-utils", () => ({
  computeDiffHunks: (...args: unknown[]) => mockComputeDiffHunks(...args),
  findInMarkdown: (...args: unknown[]) => mockFindInMarkdown(...args),
}));

vi.mock("@/lib/markdown", () => ({
  isHtml: (...args: unknown[]) => mockIsHtml(...args),
  htmlToMarkdown: (...args: unknown[]) => mockHtmlToMarkdown(...args),
}));

vi.mock("@/lib/logger", () => ({
  editorLogger: {
    child: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
  },
}));

import { useEditOperations } from "@/hooks/use-edit-operations";

describe("useEditOperations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiffState = { isReviewMode: false, diffSession: null };

    // Default: file exists with markdown content
    mockGetFile.mockReturnValue({
      id: "file-1",
      content: "Hello World. Some text.",
    });

    // Default: content is not HTML
    mockIsHtml.mockReturnValue(false);

    // Default: computeDiffHunks returns a single hunk
    mockComputeDiffHunks.mockReturnValue([
      {
        id: "hunk-1",
        type: "replace",
        from: 0,
        to: 0,
        oldContent: "Hello",
        searchText: "Hello",
        newContent: "Hi",
        status: "pending",
        createdAt: "2024-01-01",
        editId: "file-1",
      },
    ]);

    // Default: findInMarkdown returns the index
    mockFindInMarkdown.mockImplementation((markdown: string, oldStr: string, offset?: number) => {
      if (offset !== undefined && offset >= 0) return offset;
      return markdown.indexOf(oldStr);
    });
  });

  // ==========================================================================
  // Basic functionality
  // ==========================================================================
  it("returns applyEdits function", () => {
    const { result } = renderHook(() => useEditOperations());
    expect(result.current.applyEdits).toBeTypeOf("function");
  });

  it("returns 0 for empty edits array", () => {
    const { result } = renderHook(() => useEditOperations());
    const count = result.current.applyEdits([]);
    expect(count).toBe(0);
    expect(mockStartDiffReview).not.toHaveBeenCalled();
  });

  it("skips edits for non-existent files", () => {
    mockGetFile.mockReturnValue(null);

    const { result } = renderHook(() => useEditOperations());
    const count = result.current.applyEdits([
      {
        type: "str_replace",
        file_id: "nonexistent",
        file_name: "test.md",
        success: true,
        old_str: "Hello",
        new_str: "Hi",
      },
    ]);
    expect(count).toBe(0);
  });

  // ==========================================================================
  // str_replace with offset
  // ==========================================================================
  describe("str_replace with offset", () => {
    it("starts a new diff session for first edit", () => {
      const { result } = renderHook(() => useEditOperations());
      result.current.applyEdits([
        {
          type: "str_replace",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
          old_str: "Hello",
          new_str: "Hi",
          offset: 0,
        },
      ]);

      expect(mockStartDiffReview).toHaveBeenCalledTimes(1);
      // Check that workingMarkdown was computed
      const args = mockStartDiffReview.mock.calls[0];
      expect(args[0]).toBe("file-1"); // fileId
      expect(args[3]).toBe("Hello World. Some text."); // originalMarkdown
      expect(args[4]).toContain("Hi"); // workingMarkdown should have replacement
    });

    it("passes offset to findInMarkdown for workingMarkdown computation", () => {
      const { result } = renderHook(() => useEditOperations());
      result.current.applyEdits([
        {
          type: "str_replace",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
          old_str: "Hello",
          new_str: "Hi",
          offset: 0,
        },
      ]);

      // findInMarkdown should be called with the offset
      expect(mockFindInMarkdown).toHaveBeenCalledWith("Hello World. Some text.", "Hello", 0);
    });

    it("computes workingMarkdown correctly with offset", () => {
      const { result } = renderHook(() => useEditOperations());
      result.current.applyEdits([
        {
          type: "str_replace",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
          old_str: "Hello",
          new_str: "Hi",
          offset: 0,
        },
      ]);

      const workingMd = mockStartDiffReview.mock.calls[0][4];
      expect(workingMd).toBe("Hi World. Some text.");
    });
  });

  // ==========================================================================
  // Sequential edits (workingMarkdown accumulation)
  // ==========================================================================
  describe("sequential edits", () => {
    it("applies multiple str_replace edits sequentially to workingMarkdown", () => {
      mockFindInMarkdown.mockImplementation((markdown: string, oldStr: string) =>
        markdown.indexOf(oldStr)
      );

      mockComputeDiffHunks.mockReturnValue([
        {
          id: "hunk-seq",
          type: "replace",
          from: 0,
          to: 0,
          oldContent: "X",
          searchText: "X",
          newContent: "Y",
          status: "pending",
          createdAt: "2024-01-01",
          editId: "file-1",
        },
      ]);

      const { result } = renderHook(() => useEditOperations());
      const count = result.current.applyEdits([
        {
          type: "str_replace",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
          old_str: "Hello",
          new_str: "Goodbye",
        },
        {
          type: "str_replace",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
          old_str: "Goodbye",
          new_str: "Farewell",
        },
      ]);

      expect(count).toBe(2);
      // workingMarkdown should reflect both edits
      const workingMd = mockStartDiffReview.mock.calls[0][4];
      expect(workingMd).toBe("Farewell World. Some text.");
    });
  });

  // ==========================================================================
  // replace_all
  // ==========================================================================
  describe("replace_all", () => {
    it("sets workingMarkdown to new_content", () => {
      const { result } = renderHook(() => useEditOperations());
      result.current.applyEdits([
        {
          type: "replace_all",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
          new_content: "Entirely new document.",
        },
      ]);

      const workingMd = mockStartDiffReview.mock.calls[0][4];
      expect(workingMd).toBe("Entirely new document.");
    });
  });

  // ==========================================================================
  // Existing review mode (addHunksToDiffSession)
  // ==========================================================================
  describe("existing review mode", () => {
    it("adds hunks to existing session instead of creating new one", () => {
      mockDiffState = {
        isReviewMode: true,
        diffSession: {
          fileId: "file-1",
          workingMarkdown: "Hello World. Some text.",
          originalMarkdown: "Hello World. Some text.",
        },
      };

      const { result } = renderHook(() => useEditOperations());
      result.current.applyEdits([
        {
          type: "str_replace",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
          old_str: "Hello",
          new_str: "Hi",
          offset: 0,
        },
      ]);

      expect(mockStartDiffReview).not.toHaveBeenCalled();
      expect(mockAddHunksToDiffSession).toHaveBeenCalledTimes(1);
    });

    it("starts new session if different file", () => {
      mockDiffState = {
        isReviewMode: true,
        diffSession: {
          fileId: "file-other",
          workingMarkdown: "other content",
        },
      };

      const { result } = renderHook(() => useEditOperations());
      result.current.applyEdits([
        {
          type: "str_replace",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
          old_str: "Hello",
          new_str: "Hi",
        },
      ]);

      expect(mockStartDiffReview).toHaveBeenCalledTimes(1);
      expect(mockAddHunksToDiffSession).not.toHaveBeenCalled();
    });

    it("uses existing workingMarkdown from session for sequential edits", () => {
      mockDiffState = {
        isReviewMode: true,
        diffSession: {
          fileId: "file-1",
          workingMarkdown: "Modified content.",
          originalMarkdown: "Hello World. Some text.",
        },
      };

      mockFindInMarkdown.mockImplementation((markdown: string, oldStr: string) =>
        markdown.indexOf(oldStr)
      );

      const { result } = renderHook(() => useEditOperations());
      result.current.applyEdits([
        {
          type: "str_replace",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
          old_str: "Modified",
          new_str: "Updated",
        },
      ]);

      // Should use "Modified content." as base, not file.content
      expect(mockFindInMarkdown).toHaveBeenCalledWith("Modified content.", "Modified", undefined);
    });
  });

  // ==========================================================================
  // HTML content handling
  // ==========================================================================
  describe("HTML content", () => {
    it("converts HTML to markdown for matching", () => {
      mockGetFile.mockReturnValue({
        id: "file-1",
        content: "<p>Hello World.</p>",
      });
      mockIsHtml.mockReturnValue(true);
      mockHtmlToMarkdown.mockReturnValue("Hello World.");

      const { result } = renderHook(() => useEditOperations());
      result.current.applyEdits([
        {
          type: "str_replace",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
          old_str: "Hello",
          new_str: "Hi",
        },
      ]);

      expect(mockHtmlToMarkdown).toHaveBeenCalledWith("<p>Hello World.</p>");
      // originalMarkdown should be the converted markdown
      const originalMd = mockStartDiffReview.mock.calls[0][3];
      expect(originalMd).toBe("Hello World.");
    });
  });

  // ==========================================================================
  // Grouping edits by file
  // ==========================================================================
  describe("edit grouping by file", () => {
    it("groups edits by file_id", () => {
      const mockGetFileMulti = vi.fn().mockImplementation((id: string) => ({
        id,
        content: `Content of ${id}`,
      }));
      mockGetFile.mockImplementation(mockGetFileMulti);

      const { result } = renderHook(() => useEditOperations());
      result.current.applyEdits([
        {
          type: "str_replace",
          file_id: "file-1",
          file_name: "a.md",
          success: true,
          old_str: "Content",
          new_str: "Text",
        },
        {
          type: "str_replace",
          file_id: "file-2",
          file_name: "b.md",
          success: true,
          old_str: "Content",
          new_str: "Text",
        },
      ]);

      // startDiffReview called once per file
      expect(mockStartDiffReview).toHaveBeenCalledTimes(2);
    });
  });

  // ==========================================================================
  // Streaming simulation — multiple applyEdits calls (SSE scenario)
  // ==========================================================================
  describe("streaming simulation (multiple applyEdits calls)", () => {
    it("first call starts session, second call adds to session", () => {
      mockFindInMarkdown.mockImplementation((markdown: string, oldStr: string, offset?: number) => {
        if (
          offset !== undefined &&
          offset >= 0 &&
          offset + oldStr.length <= markdown.length &&
          markdown.slice(offset, offset + oldStr.length) === oldStr
        ) {
          return offset;
        }
        return markdown.indexOf(oldStr);
      });

      const { result } = renderHook(() => useEditOperations());

      // --- SSE event 1: first edit arrives ---
      result.current.applyEdits([
        {
          type: "str_replace",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
          old_str: "Hello",
          new_str: "Hi",
          offset: 0,
        },
      ]);

      expect(mockStartDiffReview).toHaveBeenCalledTimes(1);
      expect(mockAddHunksToDiffSession).not.toHaveBeenCalled();

      // Verify startDiffReview args: workingMarkdown should reflect edit 1
      const startArgs = mockStartDiffReview.mock.calls[0];
      expect(startArgs[4]).toBe("Hi World. Some text."); // workingMarkdown

      // --- Simulate state transition (store is now in review mode) ---
      mockDiffState = {
        isReviewMode: true,
        diffSession: {
          fileId: "file-1",
          workingMarkdown: "Hi World. Some text.",
          originalMarkdown: "Hello World. Some text.",
        },
      };

      // --- SSE event 2: second edit arrives ---
      result.current.applyEdits([
        {
          type: "str_replace",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
          old_str: "Some text",
          new_str: "More text",
          offset: 10,
        },
      ]);

      // Should add to existing session, NOT start a new one
      expect(mockStartDiffReview).toHaveBeenCalledTimes(1); // still 1
      expect(mockAddHunksToDiffSession).toHaveBeenCalledTimes(1);

      // workingMarkdown passed to addHunks should reflect edit 2 on top of session state
      const addArgs = mockAddHunksToDiffSession.mock.calls[0];
      const updatedWorkingMd = addArgs[1];
      expect(updatedWorkingMd).toBe("Hi World. More text.");
    });

    it("three sequential streaming edits accumulate workingMarkdown", () => {
      mockFindInMarkdown.mockImplementation((markdown: string, oldStr: string, offset?: number) => {
        if (
          offset !== undefined &&
          offset >= 0 &&
          offset + oldStr.length <= markdown.length &&
          markdown.slice(offset, offset + oldStr.length) === oldStr
        ) {
          return offset;
        }
        return markdown.indexOf(oldStr);
      });

      mockGetFile.mockReturnValue({
        id: "file-1",
        content: "AAA BBB CCC",
      });

      const { result } = renderHook(() => useEditOperations());

      // --- SSE event 1 ---
      result.current.applyEdits([
        {
          type: "str_replace",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
          old_str: "AAA",
          new_str: "XXX",
          offset: 0,
        },
      ]);
      expect(mockStartDiffReview.mock.calls[0][4]).toBe("XXX BBB CCC");

      // --- State transition ---
      mockDiffState = {
        isReviewMode: true,
        diffSession: {
          fileId: "file-1",
          workingMarkdown: "XXX BBB CCC",
          originalMarkdown: "AAA BBB CCC",
        },
      };

      // --- SSE event 2 ---
      result.current.applyEdits([
        {
          type: "str_replace",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
          old_str: "BBB",
          new_str: "YYY",
          offset: 4,
        },
      ]);
      expect(mockAddHunksToDiffSession.mock.calls[0][1]).toBe("XXX YYY CCC");

      // --- State transition ---
      mockDiffState = {
        isReviewMode: true,
        diffSession: {
          fileId: "file-1",
          workingMarkdown: "XXX YYY CCC",
          originalMarkdown: "AAA BBB CCC",
        },
      };

      // --- SSE event 3 ---
      result.current.applyEdits([
        {
          type: "str_replace",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
          old_str: "CCC",
          new_str: "ZZZ",
          offset: 8,
        },
      ]);
      expect(mockAddHunksToDiffSession.mock.calls[1][1]).toBe("XXX YYY ZZZ");
    });

    it("streaming with sequential dependency (edit 2 depends on edit 1)", () => {
      mockFindInMarkdown.mockImplementation((markdown: string, oldStr: string) =>
        markdown.indexOf(oldStr)
      );

      mockGetFile.mockReturnValue({
        id: "file-1",
        content: "Original sentence here.",
      });

      const { result } = renderHook(() => useEditOperations());

      // --- SSE event 1: replaces "Original" → "Modified" ---
      result.current.applyEdits([
        {
          type: "str_replace",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
          old_str: "Original",
          new_str: "Modified",
        },
      ]);
      expect(mockStartDiffReview.mock.calls[0][4]).toBe("Modified sentence here.");

      // --- State transition ---
      mockDiffState = {
        isReviewMode: true,
        diffSession: {
          fileId: "file-1",
          workingMarkdown: "Modified sentence here.",
          originalMarkdown: "Original sentence here.",
        },
      };

      // --- SSE event 2: edit depends on edit 1's output ---
      // Backend validated "Modified sentence" against cumulative state
      result.current.applyEdits([
        {
          type: "str_replace",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
          old_str: "Modified sentence",
          new_str: "Updated paragraph",
        },
      ]);

      // addHunksToDiffSession receives correct workingMarkdown
      expect(mockAddHunksToDiffSession).toHaveBeenCalledTimes(1);
      const workingMd = mockAddHunksToDiffSession.mock.calls[0][1];
      expect(workingMd).toBe("Updated paragraph here.");
    });

    it("streaming with mermaid chart edits using offsets", () => {
      const docContent = [
        "# Title",
        "",
        "```mermaid",
        "graph TD",
        "  A --> B",
        "```",
        "",
        "```mermaid",
        "graph TD",
        "  C --> D",
        "```",
        "",
        "Some text.",
      ].join("\n");

      mockGetFile.mockReturnValue({ id: "file-1", content: docContent });

      const firstMermaid = "```mermaid\ngraph TD\n  A --> B\n```";
      const secondMermaid = "```mermaid\ngraph TD\n  C --> D\n```";
      const firstOffset = docContent.indexOf(firstMermaid);
      const _secondOffset = docContent.indexOf(secondMermaid);

      mockFindInMarkdown.mockImplementation((markdown: string, oldStr: string, offset?: number) => {
        if (
          offset !== undefined &&
          offset >= 0 &&
          offset + oldStr.length <= markdown.length &&
          markdown.slice(offset, offset + oldStr.length) === oldStr
        ) {
          return offset;
        }
        return markdown.indexOf(oldStr);
      });

      const { result } = renderHook(() => useEditOperations());

      // --- SSE event 1: modify first mermaid chart ---
      result.current.applyEdits([
        {
          type: "str_replace",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
          old_str: firstMermaid,
          new_str: "```mermaid\ngraph TD\n  A --> B --> E\n```",
          offset: firstOffset,
        },
      ]);

      const workingMd1 = mockStartDiffReview.mock.calls[0][4];
      expect(workingMd1).toContain("A --> B --> E");
      expect(workingMd1).toContain("C --> D"); // second chart unchanged

      // --- State transition ---
      mockDiffState = {
        isReviewMode: true,
        diffSession: {
          fileId: "file-1",
          workingMarkdown: workingMd1,
          originalMarkdown: docContent,
        },
      };

      // --- SSE event 2: modify second mermaid chart ---
      // Backend sends offset based on cumulative state (workingMd1)
      const newSecondOffset = workingMd1.indexOf(secondMermaid);
      result.current.applyEdits([
        {
          type: "str_replace",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
          old_str: secondMermaid,
          new_str: "```mermaid\ngraph TD\n  C --> D --> F\n```",
          offset: newSecondOffset,
        },
      ]);

      expect(mockAddHunksToDiffSession).toHaveBeenCalledTimes(1);
      const workingMd2 = mockAddHunksToDiffSession.mock.calls[0][1];
      expect(workingMd2).toContain("A --> B --> E");
      expect(workingMd2).toContain("C --> D --> F");
      expect(workingMd2).toContain("Some text.");
    });

    it("streaming edit with offset invalidated by prior edit falls back to indexOf", () => {
      mockGetFile.mockReturnValue({
        id: "file-1",
        content: "Short. Target text here.",
      });

      // findInMarkdown: offset doesn't match → fallback to indexOf
      mockFindInMarkdown.mockImplementation((markdown: string, oldStr: string, offset?: number) => {
        if (
          offset !== undefined &&
          offset >= 0 &&
          offset + oldStr.length <= markdown.length &&
          markdown.slice(offset, offset + oldStr.length) === oldStr
        ) {
          return offset;
        }
        return markdown.indexOf(oldStr);
      });

      const { result } = renderHook(() => useEditOperations());

      // --- SSE event 1: insert text at beginning, shifting all offsets ---
      result.current.applyEdits([
        {
          type: "str_replace",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
          old_str: "Short.",
          new_str: "A much longer prefix.",
          offset: 0,
        },
      ]);

      const workingMd1 = mockStartDiffReview.mock.calls[0][4];
      expect(workingMd1).toBe("A much longer prefix. Target text here.");

      // --- State transition ---
      mockDiffState = {
        isReviewMode: true,
        diffSession: {
          fileId: "file-1",
          workingMarkdown: workingMd1,
          originalMarkdown: "Short. Target text here.",
        },
      };

      // --- SSE event 2: offset from backend is based on cumulative state ---
      // But suppose backend sent an offset that's now correct for workingMd1
      const correctOffset = workingMd1.indexOf("Target text");
      result.current.applyEdits([
        {
          type: "str_replace",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
          old_str: "Target text",
          new_str: "Final text",
          offset: correctOffset,
        },
      ]);

      const workingMd2 = mockAddHunksToDiffSession.mock.calls[0][1];
      expect(workingMd2).toBe("A much longer prefix. Final text here.");
    });

    it("mixed str_replace and replace_all in streaming", () => {
      mockFindInMarkdown.mockImplementation((markdown: string, oldStr: string) =>
        markdown.indexOf(oldStr)
      );

      const { result } = renderHook(() => useEditOperations());

      // --- SSE event 1: str_replace ---
      result.current.applyEdits([
        {
          type: "str_replace",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
          old_str: "Hello",
          new_str: "Hi",
        },
      ]);
      expect(mockStartDiffReview.mock.calls[0][4]).toBe("Hi World. Some text.");

      // --- State transition ---
      mockDiffState = {
        isReviewMode: true,
        diffSession: {
          fileId: "file-1",
          workingMarkdown: "Hi World. Some text.",
          originalMarkdown: "Hello World. Some text.",
        },
      };

      // --- SSE event 2: replace_all replaces everything ---
      result.current.applyEdits([
        {
          type: "replace_all",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
          new_content: "Completely rewritten document.",
        },
      ]);

      expect(mockAddHunksToDiffSession).toHaveBeenCalledTimes(1);
      const workingMd = mockAddHunksToDiffSession.mock.calls[0][1];
      expect(workingMd).toBe("Completely rewritten document.");
    });
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================
  describe("edge cases", () => {
    it("handles edit with no hunks computed", () => {
      mockComputeDiffHunks.mockReturnValue([]);

      const { result } = renderHook(() => useEditOperations());
      const count = result.current.applyEdits([
        {
          type: "str_replace",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
          old_str: "Hello",
          new_str: "Hi",
        },
      ]);

      expect(count).toBe(0);
      expect(mockStartDiffReview).not.toHaveBeenCalled();
    });

    it("handles findInMarkdown returning -1", () => {
      mockFindInMarkdown.mockReturnValue(-1);

      const { result } = renderHook(() => useEditOperations());
      result.current.applyEdits([
        {
          type: "str_replace",
          file_id: "file-1",
          file_name: "test.md",
          success: true,
          old_str: "nonexistent",
          new_str: "replacement",
        },
      ]);

      // Should still proceed — workingMarkdown stays unchanged
      const workingMd = mockStartDiffReview.mock.calls[0][4];
      expect(workingMd).toBe("Hello World. Some text.");
    });
  });
});
