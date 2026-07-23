"use client";

import { ImageIcon } from "lucide-react";
import {
  type ClipboardEvent,
  type CompositionEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  applyVisibleTextPatch,
  type MarkdownInlinePatchResult,
  type MarkdownInlineProjection,
  type MarkdownInlineSegment,
  projectMarkdownInline,
} from "@/editor/markdown-block/markdown-inline-projection";

export interface SemanticInlineSelection {
  readonly anchor: number;
  readonly head: number;
}

export interface SemanticInlineEditorProps {
  readonly source: string;
  readonly id?: string;
  readonly describedBy?: string;
  readonly className?: string;
  readonly selection?: SemanticInlineSelection;
  readonly autoFocus?: boolean;
  readonly onSourceChange: (source: string, selection: SemanticInlineSelection) => void;
  readonly onSelectionChange?: (selection: SemanticInlineSelection, event?: Event) => void;
  readonly onKeyDown?: (
    event: KeyboardEvent<HTMLDivElement>,
    selection: SemanticInlineSelection
  ) => void;
  readonly onPasteText?: (
    text: string,
    selection: SemanticInlineSelection,
    event: ClipboardEvent<HTMLDivElement>
  ) => boolean | void;
  readonly onPasteFiles?: (
    files: readonly File[],
    selection: SemanticInlineSelection,
    event: ClipboardEvent<HTMLDivElement>
  ) => boolean | void;
  readonly onCompositionStart?: (event: CompositionEvent<HTMLDivElement>) => void;
  readonly onCompositionEnd?: (event: CompositionEvent<HTMLDivElement>) => void;
}

/**
 * A controlled, source-backed inline Markdown editor.
 *
 * The DOM is only an editing projection. Every accepted mutation is translated
 * back into Markdown source before it leaves this component.
 */
export function SemanticInlineEditor({
  source,
  id,
  describedBy,
  className,
  selection,
  autoFocus = false,
  onSourceChange,
  onSelectionChange,
  onKeyDown,
  onPasteText,
  onPasteFiles,
  onCompositionStart,
  onCompositionEnd,
}: SemanticInlineEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const restoringSelectionRef = useRef(false);
  const pendingSelectionRef = useRef<SemanticInlineSelection | null>(null);
  const [restoreRevision, setRestoreRevision] = useState(0);
  const projection = useMemo(() => projectMarkdownInline(source), [source]);

  const currentSourceSelection = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return selection ?? { anchor: 0, head: 0 };
    return (
      readSourceSelection(editor, projection) ??
      selection ?? {
        anchor: source.length,
        head: source.length,
      }
    );
  }, [projection, selection, source.length]);

  const restoreControlledDom = useCallback(
    (sourceSelection?: SemanticInlineSelection) => {
      pendingSelectionRef.current = sourceSelection ?? selection ?? null;
      setRestoreRevision((revision) => revision + 1);
    },
    [selection]
  );

  const commitVisibleText = useCallback(
    (
      visibleText: string,
      visibleSelection: SemanticInlineSelection,
      sourceSelectionHint?: SemanticInlineSelection
    ): boolean => {
      const patch = applyVisibleTextPatch(
        source,
        projection.visibleText,
        visibleText,
        visibleSelection
      );
      const result = preferMarkedInsertion(
        source,
        projection,
        visibleText,
        visibleSelection,
        sourceSelectionHint,
        patch
      );
      if (!result.applied || !preservesAtomicImages(source, result.source, projection)) {
        restoreControlledDom(currentSourceSelection());
        return false;
      }

      const nextSelection = result.selection ?? {
        anchor: result.source.length,
        head: result.source.length,
      };
      pendingSelectionRef.current = nextSelection;
      onSourceChange(result.source, nextSelection);
      return true;
    },
    [currentSourceSelection, onSourceChange, projection, restoreControlledDom, source]
  );

  const commitCurrentDom = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return false;
    const sourceSelectionHint = currentSourceSelection();
    const visibleSelection = readVisibleSelection(editor) ?? {
      anchor: readVisibleText(editor).length,
      head: readVisibleText(editor).length,
    };
    return commitVisibleText(readVisibleText(editor), visibleSelection, sourceSelectionHint);
  }, [commitVisibleText, currentSourceSelection]);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    if (autoFocus && document.activeElement !== editor) editor.focus();

    const nextSelection = pendingSelectionRef.current ?? selection;
    if (!nextSelection || (document.activeElement !== editor && !autoFocus)) {
      return;
    }

    pendingSelectionRef.current = null;
    restoringSelectionRef.current = true;
    restoreSourceSelection(editor, projection, nextSelection);
    restoringSelectionRef.current = false;
  }, [autoFocus, projection, restoreRevision, selection, source]);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor || !onSelectionChange) return;

    const handleSelectionChange = (event: Event) => {
      if (restoringSelectionRef.current) return;
      const nextSelection = readSourceSelection(editor, projection);
      if (nextSelection) onSelectionChange(nextSelection, event);
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [onSelectionChange, projection]);

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const sourceSelection = currentSourceSelection();
    const files = Array.from(event.clipboardData.files);
    if (files.length > 0 && onPasteFiles) {
      event.preventDefault();
      onPasteFiles(files, sourceSelection, event);
      return;
    }

    const text = event.clipboardData.getData("text/plain");
    if (onPasteText?.(text, sourceSelection, event) === true) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    const visibleAnchor = projection.sourceOffsetToVisible(
      sourceSelection.anchor,
      sourceSelection.anchor <= sourceSelection.head ? "forward" : "backward"
    );
    const visibleHead = projection.sourceOffsetToVisible(
      sourceSelection.head,
      sourceSelection.head < sourceSelection.anchor ? "forward" : "backward"
    );
    const from = Math.min(visibleAnchor, visibleHead);
    const to = Math.max(visibleAnchor, visibleHead);
    const visibleText = `${projection.visibleText.slice(
      0,
      from
    )}${text}${projection.visibleText.slice(to)}`;
    const caret = from + text.length;
    commitVisibleText(visibleText, { anchor: caret, head: caret }, sourceSelection);
  };

  return (
    <div
      ref={editorRef}
      id={id}
      role="textbox"
      aria-label="Markdown block"
      aria-describedby={describedBy}
      aria-multiline="true"
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Meta+Shift+D Control+Shift+D Meta+Shift+Backspace Control+Shift+Backspace"
      data-native-block-editor
      data-native-semantic-editor
      className={className}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      onBeforeInput={(event) => {
        const nativeEvent = event.nativeEvent as InputEvent;
        if (
          nativeEvent.inputType === "insertFromPaste" ||
          nativeEvent.inputType === "insertFromDrop"
        ) {
          event.preventDefault();
        }
      }}
      onInput={() => {
        if (!composingRef.current) commitCurrentDom();
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event, currentSourceSelection());
      }}
      onKeyUp={(event) => {
        if (restoringSelectionRef.current) return;
        const nextSelection = readSourceSelection(event.currentTarget, projection);
        if (nextSelection) onSelectionChange?.(nextSelection, event.nativeEvent);
      }}
      onMouseUp={(event: MouseEvent<HTMLDivElement>) => {
        if (restoringSelectionRef.current) return;
        const nextSelection = readSourceSelection(event.currentTarget, projection);
        if (nextSelection) onSelectionChange?.(nextSelection, event.nativeEvent);
      }}
      onPaste={handlePaste}
      onCompositionStart={(event) => {
        composingRef.current = true;
        onCompositionStart?.(event);
      }}
      onCompositionEnd={(event) => {
        composingRef.current = false;
        onCompositionEnd?.(event);
        commitCurrentDom();
      }}
    >
      <span key={`${source}\u0000${restoreRevision}`} data-semantic-inline-content="">
        {projection.segments.map((segment) => (
          <SemanticSegment
            key={`${segment.sourceFrom}:${segment.sourceTo}:${segment.kind}`}
            segment={segment}
          />
        ))}
      </span>
    </div>
  );
}

function SemanticSegment({ segment }: { segment: MarkdownInlineSegment }) {
  if (segment.kind === "image") {
    return (
      <span
        role="img"
        aria-label={segment.imageAlt || "Markdown image"}
        title={segment.imageAlt || segment.imageTarget}
        data-markdown-inline-segment=""
        data-markdown-inline-image={segment.imageTarget}
        data-source-from={segment.sourceFrom}
        data-source-to={segment.sourceTo}
        data-visible-from={segment.visibleFrom}
        data-visible-to={segment.visibleTo}
        contentEditable={false}
        className="mx-0.5 inline-flex h-6 w-6 select-all items-center justify-center rounded bg-muted text-muted-foreground"
      >
        <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="sr-only">{"\uFFFC"}</span>
      </span>
    );
  }

  let content: ReactNode = segment.text;
  if (segment.marks.code) content = <code>{content}</code>;
  if (segment.marks.bold) content = <strong>{content}</strong>;
  if (segment.marks.italic) content = <em>{content}</em>;
  if (segment.marks.strike) content = <del>{content}</del>;
  if (segment.marks.link) {
    content = (
      <a
        href={segment.linkTarget}
        data-markdown-inline-link={segment.linkTarget}
        className="text-primary underline decoration-primary/40 underline-offset-2"
        onClick={(event) => event.preventDefault()}
      >
        {content}
      </a>
    );
  }
  if (segment.marks.wiki) {
    content = (
      <span
        data-markdown-inline-wiki={segment.wikiTarget}
        className="rounded-sm bg-primary/10 px-0.5 text-primary"
      >
        {content}
      </span>
    );
  }
  return (
    <span
      data-markdown-inline-segment=""
      data-source-from={segment.sourceFrom}
      data-source-to={segment.sourceTo}
      data-visible-from={segment.visibleFrom}
      data-visible-to={segment.visibleTo}
    >
      {content}
    </span>
  );
}

function readSourceSelection(
  editor: HTMLElement,
  projection: MarkdownInlineProjection
): SemanticInlineSelection | null {
  const visibleSelection = readVisibleSelection(editor);
  const domSelection = editor.ownerDocument.defaultView?.getSelection();
  if (!visibleSelection || !domSelection?.anchorNode || !domSelection.focusNode) {
    return null;
  }
  const forward = visibleSelection.anchor <= visibleSelection.head;
  return {
    anchor: sourceOffsetForPoint(
      editor,
      domSelection.anchorNode,
      domSelection.anchorOffset,
      projection,
      forward ? "forward" : "backward"
    ),
    head: sourceOffsetForPoint(
      editor,
      domSelection.focusNode,
      domSelection.focusOffset,
      projection,
      forward ? "backward" : "forward"
    ),
  };
}

function sourceOffsetForPoint(
  editor: HTMLElement,
  node: Node,
  offset: number,
  projection: MarkdownInlineProjection,
  affinity: "backward" | "forward"
): number {
  const visibleOffset = visibleOffsetForPoint(editor, node, offset);
  const element = node instanceof Element ? node : node.parentElement;
  const segment = element?.closest<HTMLElement>("[data-markdown-inline-segment]");
  if (segment && editor.contains(segment)) {
    const visibleFrom = numericDataAttribute(segment, "visibleFrom");
    const visibleTo = numericDataAttribute(segment, "visibleTo");
    const sourceFrom = numericDataAttribute(segment, "sourceFrom");
    const sourceTo = numericDataAttribute(segment, "sourceTo");
    if (visibleFrom !== null && visibleTo !== null && sourceFrom !== null && sourceTo !== null) {
      if (visibleOffset <= visibleFrom) return sourceFrom;
      if (visibleOffset >= visibleTo) return sourceTo;
    }
  }
  return projection.visibleOffsetToSource(visibleOffset, affinity);
}

function readVisibleSelection(editor: HTMLElement): SemanticInlineSelection | null {
  const domSelection = editor.ownerDocument.defaultView?.getSelection();
  if (
    !domSelection?.anchorNode ||
    !domSelection.focusNode ||
    !editor.contains(domSelection.anchorNode) ||
    !editor.contains(domSelection.focusNode)
  ) {
    return null;
  }
  return {
    anchor: visibleOffsetForPoint(editor, domSelection.anchorNode, domSelection.anchorOffset),
    head: visibleOffsetForPoint(editor, domSelection.focusNode, domSelection.focusOffset),
  };
}

function restoreSourceSelection(
  editor: HTMLElement,
  projection: MarkdownInlineProjection,
  sourceSelection: SemanticInlineSelection
) {
  const anchor = projection.sourceOffsetToVisible(
    sourceSelection.anchor,
    sourceSelection.anchor <= sourceSelection.head ? "forward" : "backward"
  );
  const head = projection.sourceOffsetToVisible(
    sourceSelection.head,
    sourceSelection.head < sourceSelection.anchor ? "forward" : "backward"
  );
  const anchorPoint = pointAtVisibleOffset(editor, anchor);
  const headPoint = pointAtVisibleOffset(editor, head);
  const domSelection = editor.ownerDocument.defaultView?.getSelection();
  if (!anchorPoint || !headPoint || !domSelection) return;

  if (typeof domSelection.setBaseAndExtent === "function") {
    domSelection.setBaseAndExtent(
      anchorPoint.node,
      anchorPoint.offset,
      headPoint.node,
      headPoint.offset
    );
    return;
  }

  const range = editor.ownerDocument.createRange();
  if (anchor <= head) {
    range.setStart(anchorPoint.node, anchorPoint.offset);
    range.setEnd(headPoint.node, headPoint.offset);
  } else {
    range.setStart(headPoint.node, headPoint.offset);
    range.setEnd(anchorPoint.node, anchorPoint.offset);
  }
  domSelection.removeAllRanges();
  domSelection.addRange(range);
}

function readVisibleText(root: Node): string {
  if (isInlineImage(root)) return "\uFFFC";
  if (root.nodeType === Node.TEXT_NODE) return root.nodeValue ?? "";
  if (root instanceof HTMLBRElement) return "\n";
  return Array.from(root.childNodes)
    .map((child) => readVisibleText(child))
    .join("");
}

function visibleLength(node: Node): number {
  return readVisibleText(node).length;
}

function visibleOffsetForPoint(root: HTMLElement, target: Node, targetOffset: number): number {
  let result = 0;
  let resolved = false;

  const visit = (node: Node) => {
    if (resolved) return;
    if (node === target) {
      if (node.nodeType === Node.TEXT_NODE) {
        result += Math.min(Math.max(targetOffset, 0), node.nodeValue?.length ?? 0);
      } else if (isInlineImage(node)) {
        result += targetOffset > 0 ? 1 : 0;
      } else {
        const children = Array.from(node.childNodes);
        const boundedOffset = Math.min(Math.max(targetOffset, 0), children.length);
        for (let index = 0; index < boundedOffset; index += 1) {
          result += visibleLength(children[index]);
        }
      }
      resolved = true;
      return;
    }
    if (isInlineImage(node)) {
      result += 1;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.nodeValue?.length ?? 0;
      return;
    }
    if (node instanceof HTMLBRElement) {
      result += 1;
      return;
    }
    for (const child of Array.from(node.childNodes)) visit(child);
  };

  visit(root);
  return result;
}

function pointAtVisibleOffset(
  root: HTMLElement,
  requestedOffset: number
): { node: Node; offset: number } | null {
  const targetOffset = Math.min(Math.max(requestedOffset, 0), visibleLength(root));
  let consumed = 0;
  let result: { node: Node; offset: number } | null = null;

  const visit = (node: Node) => {
    if (result) return;
    if (isInlineImage(node)) {
      const parent = node.parentNode;
      if (!parent) return;
      const index = Array.prototype.indexOf.call(parent.childNodes, node);
      if (targetOffset <= consumed) result = { node: parent, offset: index };
      else if (targetOffset <= consumed + 1) {
        result = { node: parent, offset: index + 1 };
      }
      consumed += 1;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.nodeValue?.length ?? 0;
      if (targetOffset <= consumed + length) {
        result = {
          node,
          offset: Math.min(Math.max(targetOffset - consumed, 0), length),
        };
      }
      consumed += length;
      return;
    }
    if (node instanceof HTMLBRElement) {
      const parent = node.parentNode;
      if (!parent) return;
      const index = Array.prototype.indexOf.call(parent.childNodes, node);
      result =
        targetOffset <= consumed
          ? { node: parent, offset: index }
          : { node: parent, offset: index + 1 };
      consumed += 1;
      return;
    }
    for (const child of Array.from(node.childNodes)) visit(child);
  };

  visit(root);
  if (result) return result;
  return { node: root, offset: root.childNodes.length };
}

function isInlineImage(node: Node): node is HTMLElement {
  return node instanceof HTMLElement && node.hasAttribute("data-markdown-inline-image");
}

function preservesAtomicImages(
  previousSource: string,
  nextSource: string,
  previousProjection: MarkdownInlineProjection
): boolean {
  const previousImages = previousProjection.segments
    .filter((segment) => segment.kind === "image")
    .map((segment) => previousSource.slice(segment.sourceFrom, segment.sourceTo));
  const nextProjection = projectMarkdownInline(nextSource);
  const nextImages = nextProjection.segments
    .filter((segment) => segment.kind === "image")
    .map((segment) => nextSource.slice(segment.sourceFrom, segment.sourceTo));
  return (
    previousImages.length === nextImages.length &&
    previousImages.every((image, index) => image === nextImages[index])
  );
}

function preferMarkedInsertion(
  source: string,
  projection: MarkdownInlineProjection,
  newVisible: string,
  visibleSelection: SemanticInlineSelection,
  sourceSelectionHint: SemanticInlineSelection | undefined,
  patch: MarkdownInlinePatchResult
): MarkdownInlinePatchResult {
  if (
    !patch.applied ||
    !sourceSelectionHint ||
    sourceSelectionHint.anchor !== sourceSelectionHint.head
  ) {
    return patch;
  }

  const difference = minimalVisibleDifference(projection.visibleText, newVisible);
  if (difference.oldFrom !== difference.oldTo || difference.newFrom === difference.newTo) {
    return patch;
  }

  const defaultSourceOffset = projection.visibleOffsetToSource(difference.oldFrom, "forward");
  const preferredSourceOffset = sourceSelectionHint.anchor;
  if (
    preferredSourceOffset >= defaultSourceOffset ||
    preferredSourceOffset < 0 ||
    preferredSourceOffset > source.length
  ) {
    return patch;
  }

  const insertedSourceLength = patch.source.length - source.length;
  if (insertedSourceLength <= 0) return patch;
  if (
    patch.source.slice(0, defaultSourceOffset) !== source.slice(0, defaultSourceOffset) ||
    patch.source.slice(defaultSourceOffset + insertedSourceLength) !==
      source.slice(defaultSourceOffset)
  ) {
    return patch;
  }

  const insertedSource = patch.source.slice(
    defaultSourceOffset,
    defaultSourceOffset + insertedSourceLength
  );
  const candidate = `${source.slice(
    0,
    preferredSourceOffset
  )}${insertedSource}${source.slice(preferredSourceOffset)}`;
  if (projectMarkdownInline(candidate).visibleText !== newVisible) return patch;

  const selection =
    visibleSelection.anchor === difference.newTo && visibleSelection.head === difference.newTo
      ? {
          anchor: preferredSourceOffset + insertedSource.length,
          head: preferredSourceOffset + insertedSource.length,
        }
      : patch.selection;
  return {
    source: candidate,
    ...(selection ? { selection } : {}),
    applied: true,
  };
}

function minimalVisibleDifference(
  previous: string,
  next: string
): {
  oldFrom: number;
  oldTo: number;
  newFrom: number;
  newTo: number;
} {
  let prefix = 0;
  const commonLength = Math.min(previous.length, next.length);
  while (prefix < commonLength && previous[prefix] === next[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous[previous.length - suffix - 1] === next[next.length - suffix - 1]
  ) {
    suffix += 1;
  }
  return {
    oldFrom: prefix,
    oldTo: previous.length - suffix,
    newFrom: prefix,
    newTo: next.length - suffix,
  };
}

function numericDataAttribute(
  element: HTMLElement,
  key: "sourceFrom" | "sourceTo" | "visibleFrom" | "visibleTo"
): number | null {
  const value = element.dataset[key];
  if (value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
