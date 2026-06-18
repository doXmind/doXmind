export const SIDEBAR_TREE_ROW_PADDING_PX = 6;
export const SIDEBAR_TREE_INDENT_PX = 16;

export function getSidebarTreePaddingLeft(depth: number): number {
  return SIDEBAR_TREE_ROW_PADDING_PX + Math.max(0, depth) * SIDEBAR_TREE_INDENT_PX;
}
