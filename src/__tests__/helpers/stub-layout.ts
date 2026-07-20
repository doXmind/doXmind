/**
 * jsdom has no layout engine. ProseMirror measures the selection whenever it
 * scrolls it into view, and Text/Range have no rect methods there at all, so
 * any test that focuses a mounted editor needs these stubs.
 */
const emptyRects = () => ({ length: 0, item: () => null }) as unknown as DOMRectList;
const zeroRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }) as DOMRect;

export function stubLayoutRects(): void {
  for (const proto of [Text.prototype, Element.prototype, Range.prototype]) {
    Object.defineProperty(proto, "getClientRects", { value: emptyRects, configurable: true });
    Object.defineProperty(proto, "getBoundingClientRect", { value: zeroRect, configurable: true });
  }
}
