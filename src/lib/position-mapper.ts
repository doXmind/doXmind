/**
 * Position Mapper
 *
 * Functions for finding text positions in ProseMirror documents.
 */

/**
 * ProseMirror document interface for position mapping
 */
export interface DocWithContent {
  textContent: string;
  nodeSize: number;
}

/**
 * Find text position in ProseMirror document (exact match only).
 *
 * @param doc - ProseMirror document
 * @param searchText - Text to find
 * @returns Position range { from, to } or null if not found
 */
export function findTextInDoc(
  doc: DocWithContent,
  searchText: string
): { from: number; to: number } | null {
  const index = doc.textContent.indexOf(searchText);
  if (index === -1) return null;

  // ProseMirror document content starts at position 1 (after the doc node)
  return {
    from: index + 1,
    to: index + searchText.length + 1,
  };
}
