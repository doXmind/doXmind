import { render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { MarkdownBlockDocument } from "@/editor/markdown-block/markdown-block-document";
import { MarkdownBlockRow } from "@/editor/markdown-block/markdown-block-row";

/**
 * The order in which a Page's gutter alignment touches layout.
 *
 * Measuring one row and writing to it before measuring the next is what made opening a Page cost
 * the square of its length: the write dirties layout for the whole document and the next row's
 * measurement forces it again. Measured in the packaged app on a 1000-Block Page, that was 304
 * forced layouts and 3.005s inside layout, with the window still showing the previous screen 3.9s
 * after the click. The shape the fix has to keep is what this asserts — every measurement first,
 * then every write — because it is the shape, not the milliseconds, that survives a change of
 * machine or build.
 */

/** Every required callback as a no-op, so a test only names the handlers it asserts on. */
function handlers() {
  return {
    onActivate: vi.fn(),
    onChange: vi.fn(),
    onPaste: vi.fn(),
    onCompositionStart: vi.fn(),
    onCompositionEnd: vi.fn(),
    onSplit: vi.fn(),
    onMergeBackward: vi.fn(),
    onInsertAfter: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onSetTaskChecked: vi.fn(),
    onMove: vi.fn(),
    onSetKind: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onDragStart: vi.fn(),
    onDragEnd: vi.fn(),
  } satisfies Partial<ComponentProps<typeof MarkdownBlockRow>>;
}

/**
 * Log every gutter measurement and every gutter write, in the order they happen.
 *
 * jsdom lays nothing out, so the line box each Block measures is stubbed per text run — the same
 * technique `firstLineBox`'s own tests use. `Range.getClientRects` is only reached from the gutter
 * measurement while a Block is at rest, so a "read" in this log is unambiguously one row asking
 * where its first line is. Content boxes stay at jsdom's origin, which makes a stubbed line top of
 * 14 a lead of 2 (`top + height / 2 - 12`) against a declared lead of 0 in a document with no
 * stylesheet.
 */
function instrument(lineTops: ReadonlyMap<string, number>) {
  const log: string[] = [];
  const originalRects = Range.prototype.getClientRects;
  Range.prototype.getClientRects = function getClientRects() {
    const top = lineTops.get(this.startContainer.nodeValue ?? "");
    if (top === undefined) return [] as unknown as DOMRectList;
    log.push("read");
    return [new DOMRect(0, top, 100, 20)] as unknown as DOMRectList;
  };
  const setProperty = CSSStyleDeclaration.prototype.setProperty;
  const removeProperty = CSSStyleDeclaration.prototype.removeProperty;
  CSSStyleDeclaration.prototype.setProperty = function (this: CSSStyleDeclaration, ...args) {
    if (args[0] === "--controls-lead") log.push(`write ${args[1]}`);
    return setProperty.apply(this, args);
  };
  CSSStyleDeclaration.prototype.removeProperty = function (this: CSSStyleDeclaration, name) {
    if (name === "--controls-lead") log.push("clear");
    return removeProperty.call(this, name);
  };
  return {
    log,
    restore: () => {
      Range.prototype.getClientRects = originalRects;
      CSSStyleDeclaration.prototype.setProperty = setProperty;
      CSSStyleDeclaration.prototype.removeProperty = removeProperty;
    },
  };
}

function page(markdown: string) {
  const { blocks } = MarkdownBlockDocument.fromMarkdown(markdown).getSnapshot();
  return (
    <>
      {blocks.map((block) => (
        <MarkdownBlockRow key={block.id} block={block} active={false} {...handlers()} />
      ))}
    </>
  );
}

describe("gutter alignment across a Page", () => {
  it("measures every Block before it writes to any of them", async () => {
    const { log, restore } = instrument(
      new Map([
        ["Alpha", 14],
        ["Bravo", 14],
        ["Charlie", 14],
      ])
    );
    try {
      render(page("Alpha\n\nBravo\n\nCharlie\n"));
      // The corrections land in the microtask checkpoint that follows the commit, which is still
      // before the browser would paint.
      await Promise.resolve();
      expect(log.filter((entry) => entry === "read")).toHaveLength(3);
      expect(log.filter((entry) => entry.startsWith("write"))).toHaveLength(3);
      // Not `read write read write read write`, which is the interleave that costs a forced layout
      // per Block.
      expect(log.lastIndexOf("read")).toBeLessThan(log.findIndex((e) => e.startsWith("write")));
      // Clearing the last correction is a write too, and it belongs with the commit rather than
      // between two measurements.
      expect(log.lastIndexOf("clear")).toBeLessThan(log.indexOf("read"));
    } finally {
      restore();
    }
  });

  it("writes nothing to a Block already sitting where the stylesheet puts it", async () => {
    // A line top of 12 is a lead of 12 + 10 - 12 = 10 against a declared 0; a line top of 2 is a
    // lead of 0, which is what the Block already has. Measured in the running app this is the
    // common case rather than a corner: paragraphs, lists and quotes all measure the lead
    // editor.css already gives them, so most of a Page writes nothing at all.
    const { log, restore } = instrument(
      new Map([
        ["Alpha", 12],
        ["Bravo", 2],
      ])
    );
    try {
      render(page("Alpha\n\nBravo\n"));
      await Promise.resolve();
      expect(log.filter((entry) => entry.startsWith("write"))).toEqual(["write 10px"]);
    } finally {
      restore();
    }
  });
});
