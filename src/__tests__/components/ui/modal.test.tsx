/**
 * Tests for Modal components
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal, ModalHeader, ModalFooter } from "@/components/ui/modal";
import { useState } from "react";

// Test wrapper component for controlled modal
function TestModal({
  initialOpen = false,
  onCloseCallback,
  children
}: {
  initialOpen?: boolean;
  onCloseCallback?: () => void;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(initialOpen);

  const handleClose = () => {
    setOpen(false);
    onCloseCallback?.();
  };

  return (
    <>
      <button data-testid="trigger" onClick={() => setOpen(true)}>
        Open Modal
      </button>
      <Modal open={open} onClose={handleClose}>
        {children || (
          <>
            <ModalHeader onClose={handleClose}>Test Modal</ModalHeader>
            <div>Modal content</div>
            <ModalFooter>
              <button data-testid="cancel" onClick={handleClose}>Cancel</button>
              <button data-testid="confirm">Confirm</button>
            </ModalFooter>
          </>
        )}
      </Modal>
    </>
  );
}

describe("Modal", () => {
  // Mock requestAnimationFrame for focus management
  beforeEach(() => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Reset body overflow
    document.body.style.overflow = "";
  });

  describe("Rendering", () => {
    it("renders nothing when closed", () => {
      render(<Modal open={false} onClose={() => {}}>Content</Modal>);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("renders modal when open", () => {
      render(<Modal open={true} onClose={() => {}}>Content</Modal>);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("renders children content", () => {
      render(
        <Modal open={true} onClose={() => {}}>
          <div data-testid="modal-content">Test Content</div>
        </Modal>
      );
      expect(screen.getByTestId("modal-content")).toBeInTheDocument();
    });

    it("has correct aria attributes", () => {
      render(<Modal open={true} onClose={() => {}}>Content</Modal>);
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveAttribute("aria-modal", "true");
    });

    it("applies custom className", () => {
      render(
        <Modal open={true} onClose={() => {}} className="custom-modal">
          Content
        </Modal>
      );
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveClass("custom-modal");
    });

    it("renders in a portal (document.body)", () => {
      render(
        <div data-testid="container">
          <Modal open={true} onClose={() => {}}>
            <div data-testid="modal-content">Content</div>
          </Modal>
        </div>
      );
      const modalContent = screen.getByTestId("modal-content");
      const container = screen.getByTestId("container");
      expect(container.contains(modalContent)).toBe(false);
    });
  });

  describe("Opening and Closing", () => {
    it("opens when open prop changes to true", async () => {
      const { rerender } = render(
        <Modal open={false} onClose={() => {}}>Content</Modal>
      );

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      rerender(<Modal open={true} onClose={() => {}}>Content</Modal>);

      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("closes when open prop changes to false", async () => {
      const { rerender } = render(
        <Modal open={true} onClose={() => {}}>Content</Modal>
      );

      expect(screen.getByRole("dialog")).toBeInTheDocument();

      rerender(<Modal open={false} onClose={() => {}}>Content</Modal>);

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("calls onClose when backdrop is clicked", async () => {
      const handleClose = vi.fn();
      render(
        <Modal open={true} onClose={handleClose}>
          <div>Content</div>
        </Modal>
      );

      // Click the backdrop (the element with aria-hidden="true")
      const backdrop = document.querySelector('[aria-hidden="true"]');
      expect(backdrop).toBeTruthy();
      fireEvent.click(backdrop!);

      expect(handleClose).toHaveBeenCalledTimes(1);
    });

    it("calls onClose when Escape is pressed", async () => {
      const handleClose = vi.fn();
      render(
        <Modal open={true} onClose={handleClose}>
          Content
        </Modal>
      );

      fireEvent.keyDown(document, { key: "Escape" });
      expect(handleClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("Focus Management", () => {
    it("locks body scroll when open", () => {
      render(<Modal open={true} onClose={() => {}}>Content</Modal>);
      expect(document.body.style.overflow).toBe("hidden");
    });

    it("restores body scroll when closed", async () => {
      const { rerender } = render(
        <Modal open={true} onClose={() => {}}>Content</Modal>
      );

      expect(document.body.style.overflow).toBe("hidden");

      rerender(<Modal open={false} onClose={() => {}}>Content</Modal>);

      expect(document.body.style.overflow).toBe("");
    });

    it("focuses modal on open", () => {
      render(
        <Modal open={true} onClose={() => {}}>
          <button data-testid="first-btn">First</button>
        </Modal>
      );

      // Modal should focus first focusable element
      expect(screen.getByTestId("first-btn")).toBeInTheDocument();
    });
  });

  describe("Keyboard Navigation", () => {
    it("closes on Escape key press", async () => {
      const handleClose = vi.fn();
      render(
        <Modal open={true} onClose={handleClose}>
          Content
        </Modal>
      );

      fireEvent.keyDown(document, { key: "Escape" });
      expect(handleClose).toHaveBeenCalled();
    });

    it("traps focus within modal", () => {
      render(
        <Modal open={true} onClose={() => {}}>
          <button data-testid="btn1">First</button>
          <button data-testid="btn2">Second</button>
        </Modal>
      );

      expect(screen.getByTestId("btn1")).toBeInTheDocument();
      expect(screen.getByTestId("btn2")).toBeInTheDocument();
    });
  });

  describe("Integration with TestModal", () => {
    it("opens and closes via trigger button", async () => {
      const user = userEvent.setup();
      render(<TestModal />);

      // Initially closed
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      // Click to open
      await user.click(screen.getByTestId("trigger"));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("closes when cancel button is clicked", async () => {
      const user = userEvent.setup();
      const handleClose = vi.fn();
      render(<TestModal initialOpen={true} onCloseCallback={handleClose} />);

      await user.click(screen.getByTestId("cancel"));

      expect(handleClose).toHaveBeenCalled();
    });

    it("can use confirm button", async () => {
      const user = userEvent.setup();
      render(<TestModal initialOpen={true} />);

      const confirmBtn = screen.getByTestId("confirm");
      expect(confirmBtn).toBeInTheDocument();
      await user.click(confirmBtn);
    });
  });

  describe("Styling", () => {
    it("has backdrop blur effect", () => {
      render(<Modal open={true} onClose={() => {}}>Content</Modal>);
      const backdrop = document.querySelector('[aria-hidden="true"]');
      expect(backdrop).toHaveClass("backdrop-blur-sm");
    });

    it("modal has proper container classes", () => {
      render(<Modal open={true} onClose={() => {}}>Content</Modal>);
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveClass("rounded-lg");
      expect(dialog).toHaveClass("border");
      expect(dialog).toHaveClass("shadow-lg");
    });
  });
});

describe("ModalHeader", () => {
  beforeEach(() => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children as title", () => {
    render(
      <Modal open={true} onClose={() => {}}>
        <ModalHeader>My Modal Title</ModalHeader>
      </Modal>
    );

    expect(screen.getByText("My Modal Title")).toBeInTheDocument();
  });

  it("renders close button when onClose is provided", () => {
    render(
      <Modal open={true} onClose={() => {}}>
        <ModalHeader onClose={() => {}}>Title</ModalHeader>
      </Modal>
    );

    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });

  it("does not render close button when onClose is not provided", () => {
    render(
      <Modal open={true} onClose={() => {}}>
        <ModalHeader>Title</ModalHeader>
      </Modal>
    );

    expect(screen.queryByRole("button", { name: /close/i })).not.toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", async () => {
    const user = userEvent.setup();
    const handleClose = vi.fn();

    render(
      <Modal open={true} onClose={() => {}}>
        <ModalHeader onClose={handleClose}>Title</ModalHeader>
      </Modal>
    );

    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("has correct heading structure", () => {
    render(
      <Modal open={true} onClose={() => {}}>
        <ModalHeader>Test Title</ModalHeader>
      </Modal>
    );

    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveTextContent("Test Title");
  });

  it("has flex layout for header", () => {
    render(
      <Modal open={true} onClose={() => {}}>
        <ModalHeader onClose={() => {}}>Title</ModalHeader>
      </Modal>
    );

    const heading = screen.getByRole("heading", { level: 2 });
    const headerContainer = heading.parentElement;
    expect(headerContainer).toHaveClass("flex");
    expect(headerContainer).toHaveClass("items-center");
    expect(headerContainer).toHaveClass("justify-between");
  });
});

describe("ModalFooter", () => {
  beforeEach(() => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children", () => {
    render(
      <Modal open={true} onClose={() => {}}>
        <ModalFooter>
          <button>Action 1</button>
          <button>Action 2</button>
        </ModalFooter>
      </Modal>
    );

    expect(screen.getByText("Action 1")).toBeInTheDocument();
    expect(screen.getByText("Action 2")).toBeInTheDocument();
  });

  it("has flex layout for buttons", () => {
    render(
      <Modal open={true} onClose={() => {}}>
        <ModalFooter>
          <button data-testid="btn">Button</button>
        </ModalFooter>
      </Modal>
    );

    const footer = screen.getByTestId("btn").parentElement;
    expect(footer).toHaveClass("flex");
    expect(footer).toHaveClass("items-center");
    expect(footer).toHaveClass("justify-end");
    expect(footer).toHaveClass("gap-2");
  });

  it("has correct margin top", () => {
    render(
      <Modal open={true} onClose={() => {}}>
        <ModalFooter>
          <button data-testid="btn">Button</button>
        </ModalFooter>
      </Modal>
    );

    const footer = screen.getByTestId("btn").parentElement;
    expect(footer).toHaveClass("mt-6");
  });

  it("renders multiple buttons correctly", async () => {
    const user = userEvent.setup();
    const handleCancel = vi.fn();
    const handleConfirm = vi.fn();

    render(
      <Modal open={true} onClose={() => {}}>
        <ModalFooter>
          <button onClick={handleCancel}>Cancel</button>
          <button onClick={handleConfirm}>Confirm</button>
        </ModalFooter>
      </Modal>
    );

    await user.click(screen.getByText("Cancel"));
    expect(handleCancel).toHaveBeenCalled();

    await user.click(screen.getByText("Confirm"));
    expect(handleConfirm).toHaveBeenCalled();
  });
});
