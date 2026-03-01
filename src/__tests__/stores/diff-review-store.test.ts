/**
 * Tests for diff-review-store
 *
 * Verifies state transitions, sequential dependency detection,
 * navigation helpers, feedback generation, and hunk management.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.hoisted ensures mocks are available before imports (hoisted above vi.mock)
const { mockTrackDiffReview, mockSetLastAIOperation, getIdCounter, resetIdCounter } = vi.hoisted(
  () => {
    let idCounter = 0;
    return {
      mockTrackDiffReview: vi.fn(),
      mockSetLastAIOperation: vi.fn(),
      getIdCounter: () => ++idCounter,
      resetIdCounter: () => {
        idCounter = 0;
      },
    };
  }
);

vi.mock("@/lib/telemetry", () => ({
  telemetry: { trackDiffReview: mockTrackDiffReview },
}));

vi.mock("@/stores/editor-store", () => ({
  useEditorStore: {
    getState: () => ({
      setLastAIOperation: mockSetLastAIOperation,
    }),
  },
}));

vi.mock("@/lib/utils", () => ({
  generateId: () => `gen-id-${getIdCounter()}`,
}));

import { useDiffReviewStore } from "@/stores/diff-review-store";
import type { DiffHunk } from "@/types/diff";

// ---------------------------------------------------------------------------
// Helper to create a minimal DiffHunk
// ---------------------------------------------------------------------------
function makeHunk(overrides: Partial<DiffHunk> = {}): DiffHunk {
  return {
    id: overrides.id || `hunk-${Math.random().toString(36).slice(2, 6)}`,
    type: "replace",
    from: 0,
    to: 10,
    oldContent: "old text",
    searchText: "old text",
    newContent: "new text",
    status: "pending",
    createdAt: new Date().toISOString(),
    editId: "edit-1",
    ...overrides,
  };
}

describe("useDiffReviewStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetIdCounter();
    // Reset store
    useDiffReviewStore.setState({
      diffSession: null,
      isReviewMode: false,
      pendingFeedback: [],
      currentHunkIndex: -1,
      navigationSource: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // startDiffReview / endDiffReview lifecycle
  // ==========================================================================
  describe("startDiffReview", () => {
    it("creates a diff session with correct structure", () => {
      const hunks = [makeHunk({ id: "h1" })];
      useDiffReviewStore
        .getState()
        .startDiffReview("file-1", hunks, "<p>original</p>", "original", "working");

      const state = useDiffReviewStore.getState();
      expect(state.isReviewMode).toBe(true);
      expect(state.currentHunkIndex).toBe(0);
      expect(state.diffSession).not.toBeNull();
      expect(state.diffSession!.fileId).toBe("file-1");
      expect(state.diffSession!.hunks).toHaveLength(1);
      expect(state.diffSession!.originalContent).toBe("<p>original</p>");
      expect(state.diffSession!.originalMarkdown).toBe("original");
      expect(state.diffSession!.workingMarkdown).toBe("working");
      expect(state.diffSession!.isActive).toBe(true);
    });

    it("stamps displayedAt on all hunks", () => {
      const hunks = [makeHunk({ id: "h1" }), makeHunk({ id: "h2" })];
      useDiffReviewStore.getState().startDiffReview("file-1", hunks, "content");

      const session = useDiffReviewStore.getState().diffSession!;
      for (const h of session.hunks) {
        expect(h.displayedAt).toBeTypeOf("number");
      }
    });
  });

  describe("endDiffReview", () => {
    it("clears session state", () => {
      useDiffReviewStore.getState().startDiffReview("file-1", [makeHunk()], "content");
      useDiffReviewStore.getState().endDiffReview();

      const state = useDiffReviewStore.getState();
      expect(state.diffSession).toBeNull();
      expect(state.isReviewMode).toBe(false);
      expect(state.currentHunkIndex).toBe(-1);
      expect(state.navigationSource).toBeNull();
    });
  });

  // ==========================================================================
  // acceptHunk / rejectHunk
  // ==========================================================================
  describe("acceptHunk", () => {
    it("marks hunk as accepted and tracks telemetry", () => {
      const hunks = [makeHunk({ id: "h1" }), makeHunk({ id: "h2" })];
      useDiffReviewStore.getState().startDiffReview("file-1", hunks, "content");

      useDiffReviewStore.getState().acceptHunk("h1");

      const session = useDiffReviewStore.getState().diffSession!;
      expect(session.hunks[0].status).toBe("accepted");
      expect(session.hunks[1].status).toBe("pending");
      expect(mockTrackDiffReview).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: "diff_hunk_accepted",
          hunk_id: "h1",
          user_action: "accept",
        })
      );
      expect(mockSetLastAIOperation).toHaveBeenCalled();
    });

    it("adds feedback to pending list", () => {
      useDiffReviewStore
        .getState()
        .startDiffReview(
          "file-1",
          [makeHunk({ id: "h1", oldContent: "old", newContent: "new" })],
          "content"
        );

      useDiffReviewStore.getState().acceptHunk("h1");

      const feedback = useDiffReviewStore.getState().pendingFeedback;
      expect(feedback).toHaveLength(1);
      expect(feedback[0].decision).toBe("accepted");
      expect(feedback[0].editType).toBe("str_replace");
    });

    it("auto-advances to next pending hunk", () => {
      const hunks = [makeHunk({ id: "h1" }), makeHunk({ id: "h2" }), makeHunk({ id: "h3" })];
      useDiffReviewStore.getState().startDiffReview("file-1", hunks, "content");

      // Accept h1 (index 0) → should advance to h2 (index 1)
      useDiffReviewStore.getState().acceptHunk("h1");

      expect(useDiffReviewStore.getState().currentHunkIndex).toBe(1);
      expect(useDiffReviewStore.getState().navigationSource).toBe("auto");
    });

    it("noop when no session exists", () => {
      useDiffReviewStore.getState().acceptHunk("nonexistent");
      expect(useDiffReviewStore.getState().diffSession).toBeNull();
    });
  });

  describe("rejectHunk", () => {
    it("marks hunk as rejected and tracks telemetry", () => {
      useDiffReviewStore.getState().startDiffReview("file-1", [makeHunk({ id: "h1" })], "content");

      useDiffReviewStore.getState().rejectHunk("h1");

      const session = useDiffReviewStore.getState().diffSession!;
      expect(session.hunks[0].status).toBe("rejected");
      expect(mockTrackDiffReview).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: "diff_hunk_rejected",
          user_action: "reject",
        })
      );
    });

    it("adds rejected feedback", () => {
      useDiffReviewStore.getState().startDiffReview("file-1", [makeHunk({ id: "h1" })], "content");
      useDiffReviewStore.getState().rejectHunk("h1");

      const feedback = useDiffReviewStore.getState().pendingFeedback;
      expect(feedback[0].decision).toBe("rejected");
    });
  });

  describe("acceptAllHunks / rejectAllHunks", () => {
    it("acceptAllHunks marks all as accepted", () => {
      const hunks = [makeHunk({ id: "h1" }), makeHunk({ id: "h2" })];
      useDiffReviewStore.getState().startDiffReview("file-1", hunks, "content");

      useDiffReviewStore.getState().acceptAllHunks();

      const session = useDiffReviewStore.getState().diffSession!;
      expect(session.hunks.every((h) => h.status === "accepted")).toBe(true);
      expect(mockTrackDiffReview).toHaveBeenCalledTimes(2);
    });

    it("rejectAllHunks marks all as rejected", () => {
      const hunks = [makeHunk({ id: "h1" }), makeHunk({ id: "h2" })];
      useDiffReviewStore.getState().startDiffReview("file-1", hunks, "content");

      useDiffReviewStore.getState().rejectAllHunks();

      const session = useDiffReviewStore.getState().diffSession!;
      expect(session.hunks.every((h) => h.status === "rejected")).toBe(true);
    });

    it("only tracks pending hunks (not already-processed)", () => {
      const hunks = [makeHunk({ id: "h1" }), makeHunk({ id: "h2" })];
      useDiffReviewStore.getState().startDiffReview("file-1", hunks, "content");
      // Accept h1 first
      useDiffReviewStore.getState().acceptHunk("h1");
      vi.clearAllMocks();

      // Accept all — only h2 should be tracked
      useDiffReviewStore.getState().acceptAllHunks();
      expect(mockTrackDiffReview).toHaveBeenCalledTimes(1);
      expect(mockTrackDiffReview).toHaveBeenCalledWith(expect.objectContaining({ hunk_id: "h2" }));
    });
  });

  // ==========================================================================
  // addHunksToDiffSession — sequential dependency detection
  // ==========================================================================
  describe("addHunksToDiffSession", () => {
    it("appends hunks when no sequential dependency", () => {
      const originalMd = "Hello World. Some text.";
      useDiffReviewStore
        .getState()
        .startDiffReview("file-1", [makeHunk({ id: "h1" })], "content", originalMd, originalMd);

      // New hunk whose oldContent exists in originalMarkdown
      const newHunk = makeHunk({
        id: "h2",
        oldContent: "Hello World",
      });
      useDiffReviewStore.getState().addHunksToDiffSession([newHunk]);

      const session = useDiffReviewStore.getState().diffSession!;
      expect(session.hunks).toHaveLength(2);
      expect(session.hunks[1].id).toBe("h2");
    });

    it("splits into regional hunks when sequential dependency detected", () => {
      const originalMd = "Hello World.";
      const workingMd = "Modified World. Extra content.";
      useDiffReviewStore
        .getState()
        .startDiffReview("file-1", [makeHunk({ id: "h1" })], "content", originalMd, originalMd);

      // This hunk's oldContent does NOT exist in originalMarkdown → sequential dependency
      const newHunk = makeHunk({
        id: "h2",
        oldContent: "Modified World",
        newContent: "Changed World",
      });
      useDiffReviewStore.getState().addHunksToDiffSession([newHunk], workingMd);

      const session = useDiffReviewStore.getState().diffSession!;
      // Pending hunks are replaced with regional hunks (not one full-doc-replace)
      const pendingHunks = session.hunks.filter((h) => h.status === "pending");
      expect(pendingHunks.length).toBeGreaterThanOrEqual(1);
      // Regional hunks should NOT be full-doc-replace
      expect(pendingHunks.every((h) => !h.isFullDocumentReplace)).toBe(true);
      // Combined old/new content should represent the diff from original to working
      const combinedOld = pendingHunks.map((h) => h.oldContent).join("");
      const combinedNew = pendingHunks.map((h) => h.newContent).join("");
      expect(originalMd).toContain(combinedOld);
      expect(workingMd).toContain(combinedNew);
    });

    it("preserves accepted/rejected hunks during sequential conversion", () => {
      const originalMd = "Hello World.";
      useDiffReviewStore
        .getState()
        .startDiffReview("file-1", [makeHunk({ id: "h1" })], "content", originalMd, originalMd);

      // Accept h1 first
      useDiffReviewStore.getState().acceptHunk("h1");

      // Add sequential-dependent hunk
      const newHunk = makeHunk({
        id: "h2",
        oldContent: "nonexistent in original",
      });
      useDiffReviewStore.getState().addHunksToDiffSession([newHunk], "final state");

      const session = useDiffReviewStore.getState().diffSession!;
      // h1 (accepted) should still be present
      const acceptedHunks = session.hunks.filter((h) => h.status === "accepted");
      expect(acceptedHunks).toHaveLength(1);
      expect(acceptedHunks[0].id).toBe("h1");
    });

    it("noop when no active session", () => {
      useDiffReviewStore.getState().addHunksToDiffSession([makeHunk()]);
      expect(useDiffReviewStore.getState().diffSession).toBeNull();
    });

    it("updates workingMarkdown when provided", () => {
      useDiffReviewStore
        .getState()
        .startDiffReview(
          "file-1",
          [makeHunk({ id: "h1", oldContent: "Hello" })],
          "content",
          "Hello World.",
          "Hello World."
        );

      const newHunk = makeHunk({ id: "h2", oldContent: "World" });
      useDiffReviewStore.getState().addHunksToDiffSession([newHunk], "Hello Universe.");

      const session = useDiffReviewStore.getState().diffSession!;
      expect(session.workingMarkdown).toBe("Hello Universe.");
    });
  });

  // ==========================================================================
  // Navigation: goToNextHunk / goToPreviousHunk
  // ==========================================================================
  describe("navigation", () => {
    it("goToNextHunk wraps around", () => {
      const hunks = [makeHunk({ id: "h1" }), makeHunk({ id: "h2" }), makeHunk({ id: "h3" })];
      useDiffReviewStore.getState().startDiffReview("file-1", hunks, "content");

      // Start at index 0, go next → 1
      useDiffReviewStore.getState().goToNextHunk();
      expect(useDiffReviewStore.getState().currentHunkIndex).toBe(1);
      expect(useDiffReviewStore.getState().navigationSource).toBe("user");

      // Go next → 2
      useDiffReviewStore.getState().goToNextHunk();
      expect(useDiffReviewStore.getState().currentHunkIndex).toBe(2);

      // Go next → wraps to 0
      useDiffReviewStore.getState().goToNextHunk();
      expect(useDiffReviewStore.getState().currentHunkIndex).toBe(0);
    });

    it("goToPreviousHunk wraps around", () => {
      const hunks = [makeHunk({ id: "h1" }), makeHunk({ id: "h2" }), makeHunk({ id: "h3" })];
      useDiffReviewStore.getState().startDiffReview("file-1", hunks, "content");

      // Start at index 0, go prev → wraps to 2
      useDiffReviewStore.getState().goToPreviousHunk();
      expect(useDiffReviewStore.getState().currentHunkIndex).toBe(2);

      // Go prev → 1
      useDiffReviewStore.getState().goToPreviousHunk();
      expect(useDiffReviewStore.getState().currentHunkIndex).toBe(1);
    });

    it("skips non-pending hunks during navigation", () => {
      const hunks = [makeHunk({ id: "h1" }), makeHunk({ id: "h2" }), makeHunk({ id: "h3" })];
      useDiffReviewStore.getState().startDiffReview("file-1", hunks, "content");

      // Accept h2 (index 1)
      useDiffReviewStore.getState().acceptHunk("h2");

      // Reset to index 0, go next → should skip h2 and go to h3 (index 2)
      useDiffReviewStore.setState({ currentHunkIndex: 0 });
      useDiffReviewStore.getState().goToNextHunk();
      expect(useDiffReviewStore.getState().currentHunkIndex).toBe(2);
    });

    it("returns -1 when no pending hunks", () => {
      useDiffReviewStore.getState().startDiffReview("file-1", [makeHunk({ id: "h1" })], "content");
      useDiffReviewStore.getState().acceptHunk("h1");

      useDiffReviewStore.getState().goToNextHunk();
      expect(useDiffReviewStore.getState().currentHunkIndex).toBe(-1);
    });

    it("noop when no session", () => {
      useDiffReviewStore.getState().goToNextHunk();
      expect(useDiffReviewStore.getState().currentHunkIndex).toBe(-1);
    });
  });

  // ==========================================================================
  // buildFeedback (tested indirectly through accept/reject)
  // ==========================================================================
  describe("buildFeedback", () => {
    it("truncates content to 80 chars", () => {
      const longContent = "A".repeat(200);
      useDiffReviewStore
        .getState()
        .startDiffReview(
          "file-1",
          [makeHunk({ id: "h1", oldContent: longContent, newContent: longContent })],
          "content"
        );

      useDiffReviewStore.getState().acceptHunk("h1");

      const feedback = useDiffReviewStore.getState().pendingFeedback;
      expect(feedback[0].oldContent).toHaveLength(80);
      expect(feedback[0].newContent).toHaveLength(80);
    });

    it("uses replace_all editType for full doc replace", () => {
      useDiffReviewStore
        .getState()
        .startDiffReview(
          "file-1",
          [makeHunk({ id: "h1", isFullDocumentReplace: true })],
          "content"
        );

      useDiffReviewStore.getState().acceptHunk("h1");

      const feedback = useDiffReviewStore.getState().pendingFeedback;
      expect(feedback[0].editType).toBe("replace_all");
    });

    it("uses str_replace editType for normal hunks", () => {
      useDiffReviewStore.getState().startDiffReview("file-1", [makeHunk({ id: "h1" })], "content");

      useDiffReviewStore.getState().acceptHunk("h1");

      const feedback = useDiffReviewStore.getState().pendingFeedback;
      expect(feedback[0].editType).toBe("str_replace");
    });
  });

  // ==========================================================================
  // consumePendingFeedback
  // ==========================================================================
  describe("consumePendingFeedback", () => {
    it("returns accumulated feedback and clears it", () => {
      useDiffReviewStore
        .getState()
        .startDiffReview("file-1", [makeHunk({ id: "h1" }), makeHunk({ id: "h2" })], "content");
      useDiffReviewStore.getState().acceptHunk("h1");
      useDiffReviewStore.getState().rejectHunk("h2");

      const feedback = useDiffReviewStore.getState().consumePendingFeedback();
      expect(feedback).toHaveLength(2);
      expect(feedback[0].decision).toBe("accepted");
      expect(feedback[1].decision).toBe("rejected");

      // Should be empty after consume
      expect(useDiffReviewStore.getState().pendingFeedback).toHaveLength(0);
    });

    it("returns empty array when no feedback", () => {
      const feedback = useDiffReviewStore.getState().consumePendingFeedback();
      expect(feedback).toHaveLength(0);
    });
  });

  // ==========================================================================
  // setCurrentHunkIndex
  // ==========================================================================
  describe("setCurrentHunkIndex", () => {
    it("directly sets the index", () => {
      useDiffReviewStore.getState().setCurrentHunkIndex(5);
      expect(useDiffReviewStore.getState().currentHunkIndex).toBe(5);
    });
  });
});
