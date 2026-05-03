/**
 * Find the nearest scrollable ancestor of an element.
 * Walks up the DOM tree checking for overflow-y: auto or scroll.
 *
 * Returns document.documentElement as a fallback so callers can always
 * read/assign scrollTop without null-checking.
 */
export function getScrollParent(element: HTMLElement): HTMLElement {
  let current = element.parentElement;
  while (current) {
    const { overflowY } = getComputedStyle(current);
    if (overflowY === "auto" || overflowY === "scroll") return current;
    current = current.parentElement;
  }
  return document.documentElement;
}
