import { describe, expect, it } from "vitest";
import {
  CUSTOM_BLOCK_PLACEHOLDER_REGEX,
  CustomBlockExtensions,
  parseCustomBlockPlaceholder,
  parseCustomBlockPlaceholderComment,
} from "@/extensions/registry";

const UUIDS = {
  pdf: "550e8400-e29b-41d4-a716-446655440000",
  excel: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
} as const;

describe("CustomBlockExtensions registry", () => {
  it("registers PDF and Excel as external-reference blocks", () => {
    expect(CustomBlockExtensions["pdf-block"].category).toBe("external-reference");
    expect(CustomBlockExtensions["excel-block"].category).toBe("external-reference");
  });

  it.each([
    { blockType: "pdf-block" as const, id: UUIDS.pdf, src: "assets/spec.pdf" },
    { blockType: "excel-block" as const, id: UUIDS.excel, src: "assets/budget.xlsx" },
  ])("round-trips $blockType placeholders through id/src node attrs", ({ blockType, id, src }) => {
    const entry = CustomBlockExtensions[blockType];
    const placeholder = entry.placeholderTemplate(id, src);
    const expected = `<!-- ${blockType} id="${id}" src="${src}" -->`;

    expect(placeholder).toBe(expected);

    const parsed = parseCustomBlockPlaceholder(placeholder);
    expect(parsed).toEqual({
      blockType,
      id,
      src,
      attrs: "",
    });

    const commentNode = document.createComment(placeholder.slice(4, -3));
    expect(parseCustomBlockPlaceholderComment(commentNode)).toEqual(parsed);

    const prosemirrorNode = { attrs: { id: parsed?.id, src: parsed?.src } };
    const rendered = entry.placeholderTemplate(
      entry.extractIdFromNode(prosemirrorNode),
      entry.extractSrcFromNode(prosemirrorNode)
    );

    expect(rendered).toBe(placeholder);
  });

  it("uses one spec-compatible regex with attrs anchored before the closing comment", () => {
    const blockType = "pdf-block";
    const id = UUIDS.pdf;
    const src = "assets/spec.pdf";
    const placeholderWithAttrs = `<!-- ${blockType} id="${id}" src="${src}" data-page="2" -->`;
    const match = CUSTOM_BLOCK_PLACEHOLDER_REGEX.exec(placeholderWithAttrs);

    expect(match?.[1]).toBe(blockType);
    expect(match?.[2]).toBe(id);
    expect(match?.[3]).toBe(src);
    expect(match?.[4]).toBe(' data-page="2"');
  });
});
