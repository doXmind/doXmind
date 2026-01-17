/**
 * Tests for Input component
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input } from "@/components/ui/input";
import { createRef } from "react";

describe("Input", () => {
  describe("Rendering", () => {
    it("renders correctly", () => {
      render(<Input placeholder="Enter text" />);
      expect(screen.getByPlaceholderText("Enter text")).toBeInTheDocument();
    });

    it("renders without explicit type when not specified", () => {
      render(<Input data-testid="input" />);
      const input = screen.getByTestId("input");
      // Input component doesn't set a default type attribute explicitly
      // The browser defaults to "text" behavior
      expect(input).toBeInTheDocument();
      expect(input.tagName).toBe("INPUT");
    });

    it("renders with specified type", () => {
      render(<Input type="password" data-testid="input" />);
      const input = screen.getByTestId("input");
      expect(input).toHaveAttribute("type", "password");
    });

    it("renders with email type", () => {
      render(<Input type="email" data-testid="input" />);
      const input = screen.getByTestId("input");
      expect(input).toHaveAttribute("type", "email");
    });

    it("renders with number type", () => {
      render(<Input type="number" data-testid="input" />);
      const input = screen.getByTestId("input");
      expect(input).toHaveAttribute("type", "number");
    });

    it("applies custom className", () => {
      render(<Input className="custom-class" data-testid="input" />);
      const input = screen.getByTestId("input");
      expect(input).toHaveClass("custom-class");
    });

    it("has correct display name", () => {
      expect(Input.displayName).toBe("Input");
    });
  });

  describe("Props and Attributes", () => {
    it("forwards ref correctly", () => {
      const ref = createRef<HTMLInputElement>();
      render(<Input ref={ref} />);
      expect(ref.current).toBeInstanceOf(HTMLInputElement);
    });

    it("accepts value prop", () => {
      render(<Input value="test value" onChange={() => {}} data-testid="input" />);
      const input = screen.getByTestId("input");
      expect(input).toHaveValue("test value");
    });

    it("accepts defaultValue prop", () => {
      render(<Input defaultValue="default" data-testid="input" />);
      const input = screen.getByTestId("input");
      expect(input).toHaveValue("default");
    });

    it("accepts disabled prop", () => {
      render(<Input disabled data-testid="input" />);
      const input = screen.getByTestId("input");
      expect(input).toBeDisabled();
    });

    it("accepts readOnly prop", () => {
      render(<Input readOnly data-testid="input" />);
      const input = screen.getByTestId("input");
      expect(input).toHaveAttribute("readonly");
    });

    it("accepts required prop", () => {
      render(<Input required data-testid="input" />);
      const input = screen.getByTestId("input");
      expect(input).toBeRequired();
    });

    it("accepts maxLength prop", () => {
      render(<Input maxLength={10} data-testid="input" />);
      const input = screen.getByTestId("input");
      expect(input).toHaveAttribute("maxlength", "10");
    });

    it("accepts min and max for number type", () => {
      render(<Input type="number" min={0} max={100} data-testid="input" />);
      const input = screen.getByTestId("input");
      expect(input).toHaveAttribute("min", "0");
      expect(input).toHaveAttribute("max", "100");
    });

    it("accepts pattern prop", () => {
      render(<Input pattern="[A-Za-z]+" data-testid="input" />);
      const input = screen.getByTestId("input");
      expect(input).toHaveAttribute("pattern", "[A-Za-z]+");
    });

    it("accepts autoComplete prop", () => {
      render(<Input autoComplete="email" data-testid="input" />);
      const input = screen.getByTestId("input");
      expect(input).toHaveAttribute("autocomplete", "email");
    });

    it("accepts name prop", () => {
      render(<Input name="email" data-testid="input" />);
      const input = screen.getByTestId("input");
      expect(input).toHaveAttribute("name", "email");
    });

    it("accepts id prop", () => {
      render(<Input id="my-input" data-testid="input" />);
      const input = screen.getByTestId("input");
      expect(input).toHaveAttribute("id", "my-input");
    });

    it("accepts aria-label prop", () => {
      render(<Input aria-label="Search" data-testid="input" />);
      const input = screen.getByTestId("input");
      expect(input).toHaveAttribute("aria-label", "Search");
    });

    it("accepts aria-describedby prop", () => {
      render(<Input aria-describedby="helper-text" data-testid="input" />);
      const input = screen.getByTestId("input");
      expect(input).toHaveAttribute("aria-describedby", "helper-text");
    });
  });

  describe("Events", () => {
    it("calls onChange when value changes", async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();
      render(<Input onChange={handleChange} data-testid="input" />);

      const input = screen.getByTestId("input");
      await user.type(input, "hello");

      expect(handleChange).toHaveBeenCalledTimes(5);
    });

    it("calls onFocus when focused", async () => {
      const user = userEvent.setup();
      const handleFocus = vi.fn();
      render(<Input onFocus={handleFocus} data-testid="input" />);

      const input = screen.getByTestId("input");
      await user.click(input);

      expect(handleFocus).toHaveBeenCalledTimes(1);
    });

    it("calls onBlur when blurred", async () => {
      const user = userEvent.setup();
      const handleBlur = vi.fn();
      render(<Input onBlur={handleBlur} data-testid="input" />);

      const input = screen.getByTestId("input");
      await user.click(input);
      await user.tab();

      expect(handleBlur).toHaveBeenCalledTimes(1);
    });

    it("calls onKeyDown when key is pressed", async () => {
      const user = userEvent.setup();
      const handleKeyDown = vi.fn();
      render(<Input onKeyDown={handleKeyDown} data-testid="input" />);

      const input = screen.getByTestId("input");
      await user.click(input);
      await user.keyboard("a");

      expect(handleKeyDown).toHaveBeenCalled();
    });

    it("calls onKeyUp when key is released", async () => {
      const user = userEvent.setup();
      const handleKeyUp = vi.fn();
      render(<Input onKeyUp={handleKeyUp} data-testid="input" />);

      const input = screen.getByTestId("input");
      await user.click(input);
      await user.keyboard("a");

      expect(handleKeyUp).toHaveBeenCalled();
    });

    it("does not call onChange when disabled", async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();
      render(<Input onChange={handleChange} disabled data-testid="input" />);

      const input = screen.getByTestId("input");
      await user.click(input);

      expect(handleChange).not.toHaveBeenCalled();
    });
  });

  describe("Styling", () => {
    it("has base styling classes", () => {
      render(<Input data-testid="input" />);
      const input = screen.getByTestId("input");
      expect(input).toHaveClass("flex");
      expect(input).toHaveClass("rounded-md");
      expect(input).toHaveClass("border");
    });

    it("merges custom className with base classes", () => {
      render(<Input className="my-custom-class" data-testid="input" />);
      const input = screen.getByTestId("input");
      expect(input).toHaveClass("my-custom-class");
      expect(input).toHaveClass("flex");
    });
  });

  describe("File Input", () => {
    it("renders file input type", () => {
      render(<Input type="file" data-testid="input" />);
      const input = screen.getByTestId("input");
      expect(input).toHaveAttribute("type", "file");
    });

    it("accepts file input props", () => {
      render(<Input type="file" accept=".pdf,.doc" data-testid="input" />);
      const input = screen.getByTestId("input");
      expect(input).toHaveAttribute("accept", ".pdf,.doc");
    });

    it("accepts multiple files", () => {
      render(<Input type="file" multiple data-testid="input" />);
      const input = screen.getByTestId("input");
      expect(input).toHaveAttribute("multiple");
    });
  });

  describe("Accessibility", () => {
    it("can be focused with keyboard", async () => {
      const user = userEvent.setup();
      render(
        <>
          <button>Before</button>
          <Input data-testid="input" />
        </>
      );

      await user.tab();
      await user.tab();

      const input = screen.getByTestId("input");
      expect(input).toHaveFocus();
    });

    it("supports aria-invalid for error state", () => {
      render(<Input aria-invalid="true" data-testid="input" />);
      const input = screen.getByTestId("input");
      expect(input).toHaveAttribute("aria-invalid", "true");
    });

    it("supports aria-required", () => {
      render(<Input aria-required="true" data-testid="input" />);
      const input = screen.getByTestId("input");
      expect(input).toHaveAttribute("aria-required", "true");
    });
  });
});
