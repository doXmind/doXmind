import { describe, expect, it } from "vitest";

import { freshParsedCacheValue } from "@/lib/parsed-cache-freshness";

describe("freshParsedCacheValue", () => {
  it("reuses PDF parsedCache only when sourceHash matches the current PDF hash", () => {
    const parsed = { version: 2, pages: [{ pageIndex: 0, blocks: [] }] };
    const cache = { sourceHash: "pdf-sha", parsed };

    expect(freshParsedCacheValue(cache, "pdf-sha")).toBe(parsed);
    expect(freshParsedCacheValue(cache, "changed-pdf-sha")).toBeNull();
  });

  it("reuses Excel parsedCache only when sourceHash matches the current workbook hash", () => {
    const parsed = {
      version: 1,
      sheets: [{ id: "Sheet1", name: "Q1", cells: [] }],
      truncated: { sheets: false, rowsBy: {}, colsBy: {} },
    };
    const cache = { sourceHash: "xlsx-sha", parsed };

    expect(freshParsedCacheValue(cache, "xlsx-sha")).toBe(parsed);
    expect(freshParsedCacheValue(cache, "changed-xlsx-sha")).toBeNull();
  });

  it("rejects malformed envelopes instead of treating derived state as source of truth", () => {
    expect(freshParsedCacheValue(null, "sha")).toBeNull();
    expect(freshParsedCacheValue({ sourceHash: "sha" }, "sha")).toBeNull();
    expect(freshParsedCacheValue({ sourceHash: 42, parsed: {} }, "42")).toBeNull();
  });
});
