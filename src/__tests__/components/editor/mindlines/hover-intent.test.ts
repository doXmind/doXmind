import { describe, expect, it } from "vitest";
import {
  isPointInOutlineSafeArea,
  isPointInRect,
  projectLeftAnchoredPopoverRect,
  type HoverRect,
} from "@/components/editor/mindlines/hover-intent";

const triggerRect: HoverRect = {
  left: 920,
  right: 944,
  top: 220,
  bottom: 340,
  width: 24,
  height: 120,
};

describe("outline hover intent geometry", () => {
  it("projects the popover leftward from the rail edge", () => {
    expect(projectLeftAnchoredPopoverRect(triggerRect, 260, 320)).toEqual({
      left: 684,
      right: 944,
      top: 220,
      bottom: 540,
      width: 260,
      height: 320,
    });
  });

  it("includes padded trigger and popover rects", () => {
    const popoverRect = projectLeftAnchoredPopoverRect(triggerRect, 260, 320);

    expect(isPointInRect({ x: 680, y: 300 }, popoverRect)).toBe(false);
    expect(isPointInRect({ x: 680, y: 300 }, popoverRect, 8)).toBe(true);
  });

  it("keeps pointer movement through the rail-to-popover corridor warm", () => {
    const popoverRect = projectLeftAnchoredPopoverRect(triggerRect, 260, 320);

    expect(
      isPointInOutlineSafeArea({
        point: { x: 780, y: 350 },
        triggerRect,
        popoverRect,
      })
    ).toBe(true);
  });

  it("rejects pointer movement clearly outside the outline hover area", () => {
    const popoverRect = projectLeftAnchoredPopoverRect(triggerRect, 260, 320);

    expect(
      isPointInOutlineSafeArea({
        point: { x: 540, y: 760 },
        triggerRect,
        popoverRect,
      })
    ).toBe(false);
  });
});
