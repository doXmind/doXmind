import { describe, expect, it } from "vitest";
import { slashMatchScore } from "@/components/editor/slash-commands";

const columns = { title: "Columns", description: "Split content into side-by-side columns" };
const twoColumns = { title: "2 Columns", description: "Side-by-side two columns" };
const toggle = {
  title: "Toggle",
  description: "Hide content under a toggle",
  searchKeywords: ["collapse", "折叠"],
};
const linkToPage = { title: "Link to Page", description: "Link to another document" };

describe("slashMatchScore", () => {
  it("empty query matches everything at rank 0", () => {
    expect(slashMatchScore(toggle, "")).toBe(0);
  });

  it("ranks title prefix above title word-prefix above keyword match", () => {
    const col = "col";
    expect(slashMatchScore(columns, col)).toBeLessThan(slashMatchScore(twoColumns, col));
    expect(slashMatchScore(twoColumns, col)).toBeLessThan(slashMatchScore(toggle, col));
  });

  it("supports multi-word queries", () => {
    expect(slashMatchScore(twoColumns, "2 col")).toBe(0);
    expect(slashMatchScore(linkToPage, "link to")).toBe(0);
    expect(slashMatchScore(columns, "link to")).toBe(Infinity);
  });

  it("matches non-English keywords", () => {
    expect(slashMatchScore(toggle, "折叠")).toBeLessThan(Infinity);
  });

  it("returns Infinity for non-matches", () => {
    expect(slashMatchScore(columns, "mermaid")).toBe(Infinity);
  });
});
