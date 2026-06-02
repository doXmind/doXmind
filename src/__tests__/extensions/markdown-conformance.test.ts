/**
 * Markdown→HTML conformance (#152): pin the `marked` importer's output against
 * a committed snapshot so any drift is caught. The shared corpus and the
 * Rust/Python snapshots live under `conformance/`; cross-implementation
 * divergences are catalogued in `conformance/REPORT.md`.
 *
 * Refresh after an intentional change: `DOXMIND_UPDATE_CONFORMANCE=1 vitest run markdown-conformance`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { markdownToHtml } from "@/lib/markdown";

const ROOT = resolve(__dirname, "../../..");
const corpus = JSON.parse(readFileSync(resolve(ROOT, "conformance/corpus.json"), "utf8")) as Array<{
  name: string;
  md: string;
}>;
const expectedPath = resolve(ROOT, "conformance/expected/marked.json");

if (process.env.DOXMIND_UPDATE_CONFORMANCE === "1") {
  describe("markdown conformance — update marked snapshot", () => {
    it("writes snapshot", () => {
      const out: Record<string, string> = {};
      for (const c of corpus) out[c.name] = markdownToHtml(c.md);
      writeFileSync(expectedPath, JSON.stringify(out, null, 2) + "\n");
    });
  });
} else {
  const expected = JSON.parse(readFileSync(expectedPath, "utf8")) as Record<string, string>;
  describe("markdown conformance — marked importer matches snapshot", () => {
    for (const c of corpus) {
      it(c.name, () => {
        expect(markdownToHtml(c.md)).toBe(expected[c.name]);
      });
    }
  });
}
