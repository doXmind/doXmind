/**
 * Tests for Textarea component
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Textarea } from "@/components/ui/textarea";
import { createRef } from "react";

describe("Textarea", () => {
  describe("Rendering", () => {
    it("renders correctly", () => {
      render(<Textarea placeholder="Enter text" />);
      expect(screen.getByPlaceholderText("Enter text")).toBeInTheDocument();
    });

    it("renders as textarea element", () => {
      render(<Textarea data-testid="textarea" />);
      const textarea = screen.getByTestId("textarea");
      expect(textarea.tagName).toBe("TEXTAREA");
    });

    it("applies custom className", () => {
      render(<Textarea className="custom-class" data-testid="textarea" />);
      const textarea = screen.getByTestId("textarea");
      expect(textarea).toHaveClass("custom-class");
    });

    it("has correct display name", () => {
      expect(Textarea.displayName).toBe("Textarea");
    });
  });

  describe("Props and Attributes", () => {
    it("forwards ref correctly", () => {
      const ref = createRef<HTMLTextAreaElement>();
      render(<Textarea ref={ref} />);
      expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
    });

    it("accepts value prop", () => {
      render(<Textarea value="test value" onChange={() => {}} data-testid="textarea" />);
      const textarea = screen.getByTestId("textarea");
      expect(textarea).toHaveValue("test value");
    });

    it("accepts defaultValue prop", () => {
      render(<Textarea defaultValue="default text" data-testid="textarea" />);
      const textarea = screen.getByTestId("textarea");
      expect(textarea).toHaveValue("default text");
    });

    it("accepts disabled prop", () => {
      render(<Textarea disabled data-testid="textarea" />);
      const textarea = screen.getByTestId("textarea");
      expect(textarea).toBeDisabled();
    });

    it("accepts readOnly prop", () => {
      render(<Textarea readOnly data-testid="textarea" />);
      const textarea = screen.getByTestId("textarea");
      expect(textarea).toHaveAttribute("readonly");
    });

    it("accepts required prop", () => {
      render(<Textarea required data-testid="textarea" />);
      const textarea = screen.getByTestId("textarea");
      expect(textarea).toBeRequired();
    });

    it("accepts rows prop", () => {
      render(<Textarea rows={10} data-testid="textarea" />);
      const textarea = screen.getByTestId("textarea");
      expect(textarea).toHaveAttribute("rows", "10");
    });

    it("accepts cols prop", () => {
      render(<Textarea cols={50} data-testid="textarea" />);
      const textarea = screen.getByTestId("textarea");
      expect(textarea).toHaveAttribute("cols", "50");
    });

    it("accepts maxLength prop", () => {
      render(<Textarea maxLength={500} data-testid="textarea" />);
      const textarea = screen.getByTestId("textarea");
      expect(textarea).toHaveAttribute("maxlength", "500");
    });

    it("accepts minLength prop", () => {
      render(<Textarea minLength={10} data-testid="textarea" />);
      const textarea = screen.getByTestId("textarea");
      expect(textarea).toHaveAttribute("minlength", "10");
    });

    it("accepts name prop", () => {
      render(<Textarea name="description" data-testid="textarea" />);
      const textarea = screen.getByTestId("textarea");
      expect(textarea).toHaveAttribute("name", "description");
    });

    it("accepts id prop", () => {
      render(<Textarea id="my-textarea" data-testid="textarea" />);
      const textarea = screen.getByTestId("textarea");
      expect(textarea).toHaveAttribute("id", "my-textarea");
    });

    it("accepts wrap prop", () => {
      render(<Textarea wrap="hard" data-testid="textarea" />);
      const textarea = screen.getByTestId("textarea");
      expect(textarea).toHaveAttribute("wrap", "hard");
    });

    it("accepts autoComplete prop", () => {
      render(<Textarea autoComplete="off" data-testid="textarea" />);
      const textarea = screen.getByTestId("textarea");
      expect(textarea).toHaveAttribute("autocomplete", "off");
    });

    it("accepts spellCheck prop", () => {
      render(<Textarea spellCheck={false} data-testid="textarea" />);
      const textarea = screen.getByTestId("textarea");
      expect(textarea).toHaveAttribute("spellcheck", "false");
    });
  });

  describe("Events", () => {
    it("calls onChange when value changes", async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();
      render(<Textarea onChange={handleChange} data-testid="textarea" />);

      const textarea = screen.getByTestId("textarea");
      await user.type(textarea, "hello world");

      expect(handleChange).toHaveBeenCalled();
    });

    it("calls onFocus when focused", async () => {
      const user = userEvent.setup();
      const handleFocus = vi.fn();
      render(<Textarea onFocus={handleFocus} data-testid="textarea" />);

      const textarea = screen.getByTestId("textarea");
      await user.click(textarea);

      expect(handleFocus).toHaveBeenCalledTimes(1);
    });

    it("calls onBlur when blurred", async () => {
      const user = userEvent.setup();
      const handleBlur = vi.fn();
      render(<Textarea onBlur={handleBlur} data-testid="textarea" />);

      const textarea = screen.getByTestId("textarea");
      await user.click(textarea);
      await user.tab();

      expect(handleBlur).toHaveBeenCalledTimes(1);
    });

    it("calls onKeyDown when key is pressed", async () => {
      const user = userEvent.setup();
      const handleKeyDown = vi.fn();
      render(<Textarea onKeyDown={handleKeyDown} data-testid="textarea" />);

      const textarea = screen.getByTestId("textarea");
      await user.click(textarea);
      await user.keyboard("a");

      expect(handleKeyDown).toHaveBeenCalled();
    });

    it("does not call onChange when disabled", async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();
      render(<Textarea onChange={handleChange} disabled data-testid="textarea" />);

      const textarea = screen.getByTestId("textarea");
      await user.click(textarea);

      expect(handleChange).not.toHaveBeenCalled();
    });

    it("handles multiline input correctly", async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();
      render(<Textarea onChange={handleChange} data-testid="textarea" />);

      const textarea = screen.getByTestId("textarea");
      await user.type(textarea, "line1{enter}line2{enter}line3");

      expect(textarea).toHaveValue("line1\nline2\nline3");
    });
  });

  describe("Styling", () => {
    it("has base styling classes", () => {
      render(<Textarea data-testid="textarea" />);
      const textarea = screen.getByTestId("textarea");
      expect(textarea).toHaveClass("flex");
      expect(textarea).toHaveClass("rounded-md");
      expect(textarea).toHaveClass("border");
    });

    it("has min-height class", () => {
      render(<Textarea data-testid="textarea" />);
      const textarea = screen.getByTestId("textarea");
      expect(textarea).toHaveClass("min-h-[60px]");
    });

    it("merges custom className with base classes", () => {
      render(<Textarea className="my-custom-class" data-testid="textarea" />);
      const textarea = screen.getByTestId("textarea");
      expect(textarea).toHaveClass("my-custom-class");
      expect(textarea).toHaveClass("flex");
    });
  });

  describe("Accessibility", () => {
    it("can be focused with keyboard", async () => {
      const user = userEvent.setup();
      render(
        <>
          <button>Before</button>
          <Textarea data-testid="textarea" />
        </>
      );

      await user.tab();
      await user.tab();

      const textarea = screen.getByTestId("textarea");
      expect(textarea).toHaveFocus();
    });

    it("supports aria-label", () => {
      render(<Textarea aria-label="Description" data-testid="textarea" />);
      const textarea = screen.getByTestId("textarea");
      expect(textarea).toHaveAttribute("aria-label", "Description");
    });

    it("supports aria-describedby", () => {
      render(<Textarea aria-describedby="helper" data-testid="textarea" />);
      const textarea = screen.getByTestId("textarea");
      expect(textarea).toHaveAttribute("aria-describedby", "helper");
    });

    it("supports aria-invalid for error state", () => {
      render(<Textarea aria-invalid="true" data-testid="textarea" />);
      const textarea = screen.getByTestId("textarea");
      expect(textarea).toHaveAttribute("aria-invalid", "true");
    });
  });
});
