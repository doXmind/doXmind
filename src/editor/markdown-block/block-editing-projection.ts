import type {
  MarkdownBlockView,
  Utf16Range,
} from "@/editor/markdown-block/markdown-block-document";
import { editableMarkdownBlockSource } from "@/editor/markdown-block/markdown-block-source";

export interface BlockEditingProjection {
  readonly editorText: string;
  readonly sourcePrefix: string;
  readonly sourceSuffix: string;
  toSource(nextEditorText: string): string;
  editorOffsetToSource(offset: number): number;
  sourceOffsetToEditor(offset: number): number;
  editorRangeToSource(range: Utf16Range): Utf16Range;
  sourceRangeToEditor(range: Utf16Range): Utf16Range;
}

export function createBlockEditingProjection(
  block: Pick<MarkdownBlockView, "kind" | "raw">
): BlockEditingProjection {
  const editableSource = editableMarkdownBlockSource(block.raw);
  const sourceSuffix = block.raw.slice(editableSource.length);
  if (!usesPayloadProjection(block.kind, editableSource)) {
    return projectionFromParts(editableSource, "", sourceSuffix);
  }

  const sourcePrefix = sourcePrefixFor(block.kind, editableSource);
  const editorText = editableSource.slice(sourcePrefix.length);

  return projectionFromParts(editorText, sourcePrefix, sourceSuffix);
}

function projectionFromParts(
  editorText: string,
  sourcePrefix: string,
  sourceSuffix: string
): BlockEditingProjection {
  const editorOffsetToSource = (offset: number) =>
    sourcePrefix.length + clampOffset(offset, editorText.length);
  const sourceOffsetToEditor = (offset: number) =>
    clampOffset(offset - sourcePrefix.length, editorText.length);

  return {
    editorText,
    sourcePrefix,
    sourceSuffix,
    toSource(nextEditorText) {
      return `${sourcePrefix}${nextEditorText}${sourceSuffix}`;
    },
    editorOffsetToSource,
    sourceOffsetToEditor,
    editorRangeToSource(range) {
      return {
        from: editorOffsetToSource(range.from),
        to: editorOffsetToSource(range.to),
      };
    },
    sourceRangeToEditor(range) {
      return {
        from: sourceOffsetToEditor(range.from),
        to: sourceOffsetToEditor(range.to),
      };
    },
  };
}

function clampOffset(offset: number, length: number): number {
  return Math.min(length, Math.max(0, offset));
}

function usesPayloadProjection(kind: MarkdownBlockView["kind"], source: string): boolean {
  if (kind === "paragraph" || kind === "heading") return true;
  if (
    kind === "bullet_list_item" ||
    kind === "ordered_list_item" ||
    kind === "task_list_item" ||
    kind === "blockquote"
  ) {
    return !/[\r\n]/.test(source);
  }
  return false;
}

function sourcePrefixFor(kind: MarkdownBlockView["kind"], source: string): string {
  if (kind === "heading") return source.match(/^#{1,6}[ \t]+/)?.[0] ?? "";
  if (kind === "task_list_item") {
    return source.match(/^[ \t]*[-+*][ \t]+\[[ xX]\](?:[ \t]+|$)/)?.[0] ?? "";
  }
  if (kind === "bullet_list_item") {
    return source.match(/^[ \t]*[-+*](?:[ \t]+|$)/)?.[0] ?? "";
  }
  if (kind === "ordered_list_item") {
    return source.match(/^[ \t]*\d{1,9}[.)](?:[ \t]+|$)/)?.[0] ?? "";
  }
  if (kind === "blockquote" && !/[\r\n]/.test(source)) {
    return source.match(/^ {0,3}>[ \t]?/)?.[0] ?? "";
  }
  return "";
}
