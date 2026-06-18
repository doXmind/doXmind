import { describe, expect, it } from "vitest";
import {
  getSidebarTreePaddingLeft,
  SIDEBAR_TREE_INDENT_PX,
  SIDEBAR_TREE_ROW_PADDING_PX,
} from "@/components/sidebar/tree-layout";

describe("sidebar tree layout", () => {
  it("uses compact VSCode-style per-row indentation", () => {
    expect(getSidebarTreePaddingLeft(0)).toBe(SIDEBAR_TREE_ROW_PADDING_PX);
    expect(getSidebarTreePaddingLeft(1)).toBe(SIDEBAR_TREE_ROW_PADDING_PX + SIDEBAR_TREE_INDENT_PX);
    expect(getSidebarTreePaddingLeft(10)).toBe(
      SIDEBAR_TREE_ROW_PADDING_PX + SIDEBAR_TREE_INDENT_PX * 10
    );
  });

  it("clamps negative depth to the root padding", () => {
    expect(getSidebarTreePaddingLeft(-1)).toBe(SIDEBAR_TREE_ROW_PADDING_PX);
  });
});
