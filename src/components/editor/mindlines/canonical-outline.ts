import type { Editor } from "@tiptap/react";

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface Heading {
  id: string;
  level: HeadingLevel;
  text: string;
  pos: number;
}

const MAX_HEADING_LEVEL = 6;

function isHeadingLevel(value: number): value is HeadingLevel {
  return value >= 1 && value <= MAX_HEADING_LEVEL && Number.isInteger(value);
}

export function normalizeFromEditor(editor: Editor): Heading[] {
  const found: Heading[] = [];
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name !== "heading") return;
    const rawLevel = Number(node.attrs.level);
    if (!isHeadingLevel(rawLevel)) return;
    found.push({
      id: `h-${offset}`,
      level: rawLevel,
      text: node.textContent || "Untitled",
      pos: offset,
    });
  });
  found.sort((a, b) => a.pos - b.pos);
  return found;
}

export function equals(a: Heading[], b: Heading[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (
      left.id !== right.id ||
      left.level !== right.level ||
      left.text !== right.text ||
      left.pos !== right.pos
    ) {
      return false;
    }
  }
  return true;
}
