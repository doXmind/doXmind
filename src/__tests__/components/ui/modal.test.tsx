import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Modal, ModalFooter, ModalHeader } from "@/components/ui/modal";

describe("Modal", () => {
  beforeEach(() => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.style.overflow = "";
  });

  it("renders an accessible portal dialog when open", async () => {
    render(
      <div data-testid="host">
        <Modal open={true} onClose={() => {}}>
          <ModalHeader>Workspace settings</ModalHeader>
          <div>Dialog content</div>
        </Modal>
      </div>
    );

    const dialog = await screen.findByRole("dialog");
    const heading = screen.getByRole("heading", { name: "Workspace settings" });

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", heading.id);
    expect(screen.getByTestId("host").contains(dialog)).toBe(false);
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("does not render while closed and restores body scroll", async () => {
    const { rerender } = render(
      <Modal open={true} onClose={() => {}}>
        Content
      </Modal>
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    rerender(
      <Modal open={false} onClose={() => {}}>
        Content
      </Modal>
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.body.style.overflow).toBe("");
  });

  it("calls onClose from Escape, backdrop, and header close button", async () => {
    const user = userEvent.setup();
    const handleClose = vi.fn();

    render(
      <Modal open={true} onClose={handleClose}>
        <ModalHeader onClose={handleClose}>Title</ModalHeader>
        Content
      </Modal>
    );

    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(document.querySelector('[aria-hidden="true"]') as Element);
    await user.click(screen.getByRole("button", { name: /close/i }));

    expect(handleClose).toHaveBeenCalledTimes(3);
  });

  it("renders footer actions as regular interactive children", async () => {
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

    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(handleCancel).toHaveBeenCalledOnce();
    expect(handleConfirm).toHaveBeenCalledOnce();
  });
});
