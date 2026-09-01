import { describe, expect, it } from "vitest";

import contract from "../../../tests/fixtures/page-tag-contract.json";
import { countTags, tagWithAncestors, tagsInText } from "@/lib/tags";

describe("inline tag grammar", () => {
  it.each(contract.cases)("$name", ({ text, tags }) => {
    expect(tagsInText(text).map((tag) => tag.name)).toEqual(tags);
  });

  it("reports the exact run each tag occupies, so a caller can splice it", () => {
    const [tag] = tagsInText("see #project here");
    expect(text_slice("see #project here", tag.from, tag.to)).toBe("#project");
  });
});

const text_slice = (source: string, from: number, to: number) => source.slice(from, to);

describe("tagWithAncestors", () => {
  it("counts a nested tag towards each of its ancestors", () => {
    expect(tagWithAncestors("Project/Web/App")).toEqual([
      "project",
      "project/web",
      "project/web/app",
    ]);
  });

  it("tolerates a leading hash and surrounding space", () => {
    expect(tagWithAncestors(" #Inbox ")).toEqual(["inbox"]);
  });
});

describe("countTags", () => {
  it("counts a Page once per tag, ancestors included", () => {
    const counts = countTags([
      { tags: ["project/web"] },
      { tags: ["project/api"] },
      { tags: ["inbox"] },
    ]);
    expect(counts.get("project")).toBe(2);
    expect(counts.get("project/web")).toBe(1);
    expect(counts.get("inbox")).toBe(1);
  });

  it("does not double-count a Page carrying two children of one parent", () => {
    expect(countTags([{ tags: ["a/b", "a/c"] }]).get("a")).toBe(1);
  });
});
