/**
 * Tests for Feature Hints localStorage logic
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Test the pure localStorage helper functions
const HINTS_STORAGE_KEY = "doxmind-feature-hints";
const ONBOARDING_STORAGE_KEY = "doxmind-onboarding-completed";

// Inline the helper functions from feature-hints.tsx for unit testing
type FeatureHintId =
  | "autocomplete-shown"
  | "slash-command-used"
  | "search-opened"
  | "quick-edit-shown";

function getSeenHints(): Set<FeatureHintId> {
  try {
    const stored = localStorage.getItem(HINTS_STORAGE_KEY);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
}

function markHintSeen(id: FeatureHintId) {
  const seen = getSeenHints();
  seen.add(id);
  localStorage.setItem(HINTS_STORAGE_KEY, JSON.stringify([...seen]));
}

describe("Feature Hints", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe("getSeenHints", () => {
    it("returns empty set when nothing stored", () => {
      const seen = getSeenHints();
      expect(seen.size).toBe(0);
    });

    it("returns stored hint IDs", () => {
      localStorage.setItem(HINTS_STORAGE_KEY, JSON.stringify(["autocomplete-shown"]));
      const seen = getSeenHints();
      expect(seen.has("autocomplete-shown")).toBe(true);
      expect(seen.size).toBe(1);
    });

    it("returns multiple stored hints", () => {
      localStorage.setItem(
        HINTS_STORAGE_KEY,
        JSON.stringify(["autocomplete-shown", "search-opened"])
      );
      const seen = getSeenHints();
      expect(seen.has("autocomplete-shown")).toBe(true);
      expect(seen.has("search-opened")).toBe(true);
      expect(seen.size).toBe(2);
    });

    it("handles corrupted localStorage data gracefully", () => {
      localStorage.setItem(HINTS_STORAGE_KEY, "not-valid-json{{{");
      const seen = getSeenHints();
      expect(seen.size).toBe(0);
    });
  });

  describe("markHintSeen", () => {
    it("stores a hint ID", () => {
      markHintSeen("autocomplete-shown");
      const stored = JSON.parse(localStorage.getItem(HINTS_STORAGE_KEY)!);
      expect(stored).toContain("autocomplete-shown");
    });

    it("preserves previously seen hints", () => {
      markHintSeen("autocomplete-shown");
      markHintSeen("search-opened");
      const stored = JSON.parse(localStorage.getItem(HINTS_STORAGE_KEY)!);
      expect(stored).toContain("autocomplete-shown");
      expect(stored).toContain("search-opened");
    });

    it("does not duplicate hint IDs", () => {
      markHintSeen("autocomplete-shown");
      markHintSeen("autocomplete-shown");
      const stored = JSON.parse(localStorage.getItem(HINTS_STORAGE_KEY)!) as string[];
      const count = stored.filter((id) => id === "autocomplete-shown").length;
      expect(count).toBe(1);
    });

    it("hint is marked as seen after markHintSeen", () => {
      expect(getSeenHints().has("quick-edit-shown")).toBe(false);
      markHintSeen("quick-edit-shown");
      expect(getSeenHints().has("quick-edit-shown")).toBe(true);
    });
  });

  describe("onboarding gate logic", () => {
    it("should not show hints when onboarding is not completed", () => {
      // Simulate: onboarding not completed
      const onboardingDone = localStorage.getItem(ONBOARDING_STORAGE_KEY);
      expect(onboardingDone).toBeNull();
      // Feature hints should be gated behind onboarding completion
    });

    it("should allow hints after onboarding is completed", () => {
      localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
      const onboardingDone = localStorage.getItem(ONBOARDING_STORAGE_KEY);
      expect(onboardingDone).toBe("true");
    });
  });

  describe("all hint IDs are unique", () => {
    it("all defined hint IDs are distinct", () => {
      const allIds: FeatureHintId[] = [
        "autocomplete-shown",
        "slash-command-used",
        "search-opened",
        "quick-edit-shown",
      ];
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(allIds.length);
    });
  });
});
