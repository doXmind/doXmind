import { NextIntlClientProvider } from "next-intl";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ImportConflictModal } from "@/components/sidebar/import-conflict-modal";
import en from "@/messages/en.json";
import type { CollisionItem, CollisionResolution } from "@/lib/external-import-resolver";

const collisions: CollisionItem[] = [
  {
    item: { name: "Replace.md", bytes: new Uint8Array([1]) },
    extension: ".md",
    existingName: "Replace.md",
  },
  {
    item: { name: "Keep.md", bytes: new Uint8Array([2]) },
    extension: ".md",
    existingName: "Keep.md",
  },
  {
    item: { name: "Skip.md", bytes: new Uint8Array([3]) },
    extension: ".md",
    existingName: "Skip.md",
  },
];

function renderModal(
  onApply = vi.fn<(decisions: Record<string, CollisionResolution>) => void>(),
  onCancelAll = vi.fn(),
  applying = false
) {
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <ImportConflictModal
        open
        collisions={collisions}
        applying={applying}
        onApply={onApply}
        onCancelAll={onCancelAll}
      />
    </NextIntlClientProvider>
  );
  return { onApply, onCancelAll };
}

describe("ImportConflictModal", () => {
  it("applies an explicit Replace / Keep both / Skip decision for every collision", async () => {
    const user = userEvent.setup();
    const { onApply } = renderModal();

    const replaceGroup = await screen.findByRole("radiogroup", { name: "Replace.md" });
    const keepGroup = screen.getByRole("radiogroup", { name: "Keep.md" });
    const skipGroup = screen.getByRole("radiogroup", { name: "Skip.md" });

    expect(within(replaceGroup).getByRole("radio", { name: "Keep both" })).toBeChecked();
    expect(within(keepGroup).getByRole("radio", { name: "Keep both" })).toBeChecked();
    expect(within(skipGroup).getByRole("radio", { name: "Keep both" })).toBeChecked();

    await user.click(within(replaceGroup).getByRole("radio", { name: "Replace" }));
    await user.click(within(skipGroup).getByRole("radio", { name: "Skip" }));
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply).toHaveBeenCalledWith({
      "Replace.md": "replace",
      "Keep.md": "keep-both",
      "Skip.md": "skip",
    });
  });

  it("supports keyboard selection, Escape cancellation, focus containment, and focus restore", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn<(decisions: Record<string, CollisionResolution>) => void>();
    const onCancelAll = vi.fn();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
          <button type="button" onClick={() => setOpen(true)}>
            Import files
          </button>
          <ImportConflictModal
            open={open}
            collisions={collisions.slice(0, 1)}
            onApply={onApply}
            onCancelAll={() => {
              onCancelAll();
              setOpen(false);
            }}
          />
        </NextIntlClientProvider>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Import files" });
    await user.click(opener);

    const close = await screen.findByRole("button", { name: "Close dialog" });
    await waitFor(() => expect(close).toHaveFocus());

    await user.tab();
    const replace = screen.getByRole("radio", { name: "Replace" });
    expect(replace).toHaveFocus();
    await user.keyboard(" ");
    expect(replace).toBeChecked();

    await user.tab({ shift: true });
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Apply" })).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(onCancelAll).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
    expect(onApply).not.toHaveBeenCalled();
  });

  it("treats Cancel all as a zero-apply operation", async () => {
    const user = userEvent.setup();
    const { onApply, onCancelAll } = renderModal();

    await user.click(await screen.findByRole("button", { name: "Cancel all" }));

    expect(onCancelAll).toHaveBeenCalledOnce();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("prevents duplicate decisions and cancellation while the batch is applying", async () => {
    const { onApply, onCancelAll } = renderModal(undefined, undefined, true);

    expect(await screen.findByRole("button", { name: "Apply" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel all" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Close dialog" })).not.toBeInTheDocument();
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toBeDisabled();
    }
    expect(onApply).not.toHaveBeenCalled();
    expect(onCancelAll).not.toHaveBeenCalled();
  });
});
