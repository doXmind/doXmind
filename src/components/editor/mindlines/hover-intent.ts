export interface Point {
  x: number;
  y: number;
}

export interface HoverRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

interface SafeAreaOptions {
  point: Point;
  triggerRect: HoverRect;
  popoverRect: HoverRect;
  padding?: number;
}

export function rectFromDomRect(rect: DOMRect | HoverRect): HoverRect {
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

export function projectLeftAnchoredPopoverRect(
  anchorRect: HoverRect,
  width: number,
  height: number
): HoverRect {
  return {
    left: anchorRect.right - width,
    right: anchorRect.right,
    top: anchorRect.top,
    bottom: anchorRect.top + height,
    width,
    height,
  };
}

export function isPointInRect(point: Point, rect: HoverRect, padding = 0): boolean {
  return (
    point.x >= rect.left - padding &&
    point.x <= rect.right + padding &&
    point.y >= rect.top - padding &&
    point.y <= rect.bottom + padding
  );
}

export function isPointInOutlineSafeArea({
  point,
  triggerRect,
  popoverRect,
  padding = 8,
}: SafeAreaOptions): boolean {
  if (isPointInRect(point, triggerRect, padding)) return true;
  if (isPointInRect(point, popoverRect, padding)) return true;

  const bridgeRect: HoverRect = {
    left: Math.min(triggerRect.left, popoverRect.left),
    right: Math.max(triggerRect.right, popoverRect.right),
    top: Math.max(Math.min(triggerRect.top, popoverRect.top), point.y - padding),
    bottom: Math.min(Math.max(triggerRect.bottom, popoverRect.bottom), point.y + padding),
    width: Math.abs(triggerRect.right - popoverRect.left),
    height: padding * 2,
  };

  return isPointInRect(point, bridgeRect, padding);
}
