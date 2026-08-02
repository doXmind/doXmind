import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { OutlineCollapsed } from "@/components/editor/mindlines/outline-collapsed";
import type { Heading } from "@/components/editor/mindlines/types";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 0,
    getVirtualItems: () => [],
    scrollToIndex: vi.fn(),
    measure: vi.fn(),
  }),
}));

vi.mock("framer-motion", () => {
  const motion = new Proxy(
    {},
    {
      get: () => (props: { children?: ReactNode }) => <div>{props.children}</div>,
    }
  );
  return { motion, AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</> };
});

function outline(count: number): Heading[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `h-${index}`,
    level: 1,
    text: `Heading ${index}`,
    pos: index * 10,
  }));
}

function sensorHeight() {
  return screen.getByTestId("outline-rail-hover-sensor").style.height;
}

/**
 * The rail column spans 18vh..86vh whatever the outline holds, but the marks
 * stack from its top. With the hover sensor filling the column, pointing 200px
 * below the last mark opened the outline popover over the text; the sensor now
 * measures the marks it represents.
 */
describe("Outline rail hover sensor", () => {
  it("is sized to the marks it represents, not to the rail column", () => {
    // 3 marks, roomy mode: 2*4 padding + 3*12 marks + 2*5 gaps + 8 grace.
    render(<OutlineCollapsed headings={outline(3)} activeId="h-0" onNavigate={vi.fn()} />);
    expect(sensorHeight()).toBe("min(100%, 62px)");
  });

  it("tracks the compact rail's smaller marks past 28 headings", () => {
    // 41 marks, compact mode: 2*4 padding + 41*8 marks + 40*2 gaps + 8 grace.
    render(<OutlineCollapsed headings={outline(41)} activeId="h-0" onNavigate={vi.fn()} />);
    expect(sensorHeight()).toBe("min(100%, 424px)");
  });

  it("leaves the rail column itself pointer-transparent so it cannot open the popover", () => {
    render(<OutlineCollapsed headings={outline(3)} activeId="h-0" onNavigate={vi.fn()} />);

    const root = screen.getByTestId("outline-rail-root");
    expect(root.className.split(/\s+/)).toContain("pointer-events-none");
    expect(screen.getByTestId("outline-rail-hover-sensor").className.split(/\s+/)).toContain(
      "pointer-events-auto"
    );
  });
});
