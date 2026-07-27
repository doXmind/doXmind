import { describe, expect, it } from "vitest";

import { orderedListDisplayOrdinals } from "@/editor/markdown-block/markdown-block-source";

/**
 * What an ordered list *shows*, which is not what its source says.
 *
 * Markdown does not renumber, so every one of these fixtures is a file a normal edit produces: an
 * insert leaves two items both written `1.`, a duplicate leaves two `2.`s, and deleting the first
 * item of a list leaves one that starts at `2.`. Rendering the source ordinal verbatim showed all of
 * that to the user.
 */
function blocks(...items: [kind: string, raw: string, depth?: number][]) {
  return items.map(([kind, raw, depth], index) => ({
    id: `b${index}`,
    kind,
    raw,
    depth,
  }));
}

describe("orderedListDisplayOrdinals", () => {
  it("counts a run instead of trusting the ordinals in the file", () => {
    // What `1. a` / `2. b` / `3. c` becomes after typing a new item under the first.
    const ordinals = orderedListDisplayOrdinals(
      blocks(
        ["ordered_list_item", "1. a"],
        ["ordered_list_item", "1. x"],
        ["ordered_list_item", "2. b"],
        ["ordered_list_item", "3. c"]
      )
    );

    expect([...ordinals.values()]).toEqual([1, 2, 3, 4]);
  });

  it("seeds a run from its first item, so a list that starts at 2 still starts at 2", () => {
    // Deleting the first item of `1./2./3.` leaves exactly this, and CommonMark renders 2, 3.
    const ordinals = orderedListDisplayOrdinals(
      blocks(["ordered_list_item", "2. b"], ["ordered_list_item", "3. c"])
    );

    expect([...ordinals.values()]).toEqual([2, 3]);
  });

  it("gives a duplicated item the next number rather than repeating one", () => {
    const ordinals = orderedListDisplayOrdinals(
      blocks(["ordered_list_item", "1. a"], ["ordered_list_item", "1. a"])
    );

    expect([...ordinals.values()]).toEqual([1, 2]);
  });

  it("ends a run at anything that is not another number", () => {
    const ordinals = orderedListDisplayOrdinals(
      blocks(
        ["ordered_list_item", "1. a"],
        ["ordered_list_item", "1. b"],
        ["bullet_list_item", "- break"],
        ["ordered_list_item", "1. x"],
        ["paragraph", "Prose."],
        ["ordered_list_item", "1. y"]
      )
    );

    expect([...ordinals.values()]).toEqual([1, 2, 1, 1]);
  });

  it("counts each depth separately and restarts a nested list that comes back", () => {
    const ordinals = orderedListDisplayOrdinals(
      blocks(
        ["ordered_list_item", "1. a"],
        ["ordered_list_item", "1. n1", 1],
        ["ordered_list_item", "1. n2", 1],
        ["ordered_list_item", "1. b"],
        ["ordered_list_item", "1. n3", 1]
      )
    );

    // The outer list keeps counting across the nested one; the nested list starts over under `b`.
    expect([...ordinals.values()]).toEqual([1, 1, 2, 2, 1]);
  });

  it("ignores every kind that is not an ordered item", () => {
    const ordinals = orderedListDisplayOrdinals(
      blocks(["paragraph", "Prose."], ["bullet_list_item", "- a"], ["task_list_item", "- [ ] t"])
    );

    expect(ordinals.size).toBe(0);
  });
});
