import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LineNumbers } from "@/components/editor/code-block/line-numbers";

describe("LineNumbers", () => {
  it("renders one preformatted gutter using the same line breaks as code content", () => {
    const { container } = render(<LineNumbers count={3} />);

    const gutter = container.querySelector(".line-numbers");
    expect(gutter).not.toBeNull();
    expect(gutter?.tagName).toBe("PRE");
    expect(gutter?.textContent).toBe("1\n2\n3");
    expect(gutter).toHaveClass("line-numbers");
  });
});
