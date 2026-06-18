const NON_DRAG_SELECTOR =
  'button,a,input,textarea,select,[role="button"],[role="tab"],[role="tablist"],[data-no-drag],[contenteditable="true"],[contenteditable=""]';

export function shouldStartWindowDrag(event: {
  button?: number;
  target: EventTarget | null;
  currentTarget: EventTarget | null;
}): boolean {
  if (typeof event.button === "number" && event.button !== 0) return false;
  if (!(event.target instanceof Element)) return false;
  if (!(event.currentTarget instanceof Element)) return false;
  if (!event.currentTarget.contains(event.target)) return false;
  return !event.target.closest(NON_DRAG_SELECTOR);
}
