/**
 * Compute pixel coordinates of a caret position inside a <textarea>.
 * Uses the "mirror div" technique: creates an off-screen div that mirrors
 * the textarea's styling, inserts text up to the caret, and measures the
 * resulting offset.
 */

const MIRROR_PROPS = [
  "boxSizing",
  "width",
  "height",
  "overflowX",
  "overflowY",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "fontSizeAdjust",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "textDecoration",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
  "MozTabSize",
  "whiteSpace",
  "wordWrap",
  "wordBreak",
] as const;

export function getCaretPixelPosition(
  textarea: HTMLTextAreaElement,
  caretIndex: number
): { top: number; left: number } {
  const div = document.createElement("div");
  div.id = "textarea-caret-mirror";

  const style = div.style;
  const computed = window.getComputedStyle(textarea);

  style.position = "absolute";
  style.visibility = "hidden";
  style.whiteSpace = "pre-wrap";
  style.wordWrap = "break-word";
  style.overflow = "hidden";

  for (const prop of MIRROR_PROPS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (style as any)[prop] = (computed as any)[prop];
  }

  div.textContent = textarea.value.substring(0, caretIndex);

  const span = document.createElement("span");
  // Use zero-width space so the span has measurable height
  span.textContent = textarea.value.substring(caretIndex) || "\u200b";
  div.appendChild(span);

  document.body.appendChild(div);

  const spanRect = span.offsetTop;
  const spanLeft = span.offsetLeft;

  document.body.removeChild(div);

  // Account for textarea scroll position
  const rect = textarea.getBoundingClientRect();
  return {
    top: rect.top + spanRect - textarea.scrollTop,
    left: rect.left + spanLeft - textarea.scrollLeft,
  };
}
