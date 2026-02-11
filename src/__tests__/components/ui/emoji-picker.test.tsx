import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EmojiPicker } from "@/components/ui/emoji-picker";

describe("EmojiPicker", () => {
  const defaultProps = {
    onSelect: vi.fn(),
    onClose: vi.fn(),
    anchorRect: new DOMRect(100, 100, 40, 40),
  };

  it("renders with search input", () => {
    render(<EmojiPicker {...defaultProps} />);
    expect(screen.getByPlaceholderText("Search emoji...")).toBeInTheDocument();
  });

  it("renders category labels", () => {
    render(<EmojiPicker {...defaultProps} />);
    expect(screen.getByText("Documents")).toBeInTheDocument();
    expect(screen.getByText("Objects")).toBeInTheDocument();
    expect(screen.getByText("Symbols")).toBeInTheDocument();
    expect(screen.getByText("Nature")).toBeInTheDocument();
    expect(screen.getByText("Faces")).toBeInTheDocument();
    expect(screen.getByText("Food")).toBeInTheDocument();
  });

  it("renders remove icon button", () => {
    render(<EmojiPicker {...defaultProps} />);
    expect(screen.getByText("Remove icon")).toBeInTheDocument();
  });

  it("calls onSelect with emoji when clicked", () => {
    const onSelect = vi.fn();
    render(<EmojiPicker {...defaultProps} onSelect={onSelect} />);

    // Click the first emoji (📄)
    const emojiButtons = screen.getAllByRole("button");
    // Find a button with emoji content
    const emojiButton = emojiButtons.find((btn) => btn.textContent === "📄");
    expect(emojiButton).toBeDefined();

    fireEvent.click(emojiButton!);
    expect(onSelect).toHaveBeenCalledWith("📄");
  });

  it("calls onSelect with null when Remove icon is clicked", () => {
    const onSelect = vi.fn();
    render(<EmojiPicker {...defaultProps} onSelect={onSelect} />);

    fireEvent.click(screen.getByText("Remove icon"));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("closes on Escape key", () => {
    const onClose = vi.fn();
    render(<EmojiPicker {...defaultProps} onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("filters emojis based on search input", () => {
    render(<EmojiPicker {...defaultProps} />);

    const input = screen.getByPlaceholderText("Search emoji...");
    // Type something that won't match any emoji
    fireEvent.change(input, { target: { value: "xyznonexistent" } });

    expect(screen.getByText("No emoji found")).toBeInTheDocument();
  });

  it("shows emojis when search is cleared", () => {
    render(<EmojiPicker {...defaultProps} />);

    const input = screen.getByPlaceholderText("Search emoji...");
    // Type to filter
    fireEvent.change(input, { target: { value: "xyznonexistent" } });
    expect(screen.getByText("No emoji found")).toBeInTheDocument();

    // Clear search
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByText("Documents")).toBeInTheDocument();
  });
});
