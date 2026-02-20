import type { Editor } from "@tiptap/core";

/**
 * Scroll the editor view to make a position visible.
 * Centers the target in the scroll container with smooth scrolling.
 * Works with custom scroll containers (like ScrollArea).
 */
export function scrollToPosition(editor: Editor, pos: number): void {
  const view = editor.view;
  if (!view) return;

  // Use requestAnimationFrame to ensure DOM is updated after state change
  requestAnimationFrame(() => {
    try {
      const coords = view.coordsAtPos(pos);
      const editorElement = view.dom;

      // Find the scrollable container (parent with overflow-y: auto)
      let scrollContainer: HTMLElement | null = editorElement.parentElement;
      while (scrollContainer) {
        const style = window.getComputedStyle(scrollContainer);
        if (style.overflowY === "auto" || style.overflowY === "scroll") {
          break;
        }
        scrollContainer = scrollContainer.parentElement;
      }

      if (!scrollContainer) {
        // Fallback to window scroll
        window.scrollTo({
          top: coords.top - window.innerHeight / 2,
          behavior: "smooth",
        });
        return;
      }

      // Calculate position relative to scroll container
      const containerRect = scrollContainer.getBoundingClientRect();
      const relativeTop = coords.top - containerRect.top;
      const containerHeight = scrollContainer.clientHeight;

      // Only scroll if the position is outside the visible area
      if (relativeTop < 50 || relativeTop > containerHeight - 50) {
        // Scroll to center the match in the viewport
        const targetScrollTop = scrollContainer.scrollTop + relativeTop - containerHeight / 2;
        scrollContainer.scrollTo({
          top: targetScrollTop,
          behavior: "smooth",
        });
      }
    } catch (error) {
      console.warn("[Editor] Could not scroll to position:", error);
    }
  });
}
