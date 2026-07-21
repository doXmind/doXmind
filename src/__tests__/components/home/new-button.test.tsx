import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NewButton } from "@/components/home/new-button";
import en from "@/messages/en.json";

describe("NewButton", () => {
  it("offers pages, folders, and templates without PDF or Excel creation", async () => {
    const user = userEvent.setup();
    const onCreateFile = vi.fn();

    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <NewButton
          onCreateFile={onCreateFile}
          onCreateFolder={vi.fn()}
          onOpenTemplatePicker={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    await user.click(screen.getByLabelText("New page"));

    const pageAction = screen.getByRole("menuitem", { name: "New page" });
    expect(screen.getByRole("menuitem", { name: "New folder" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "From Template" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "PDF" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Excel" })).not.toBeInTheDocument();

    await user.click(pageAction);
    expect(onCreateFile).toHaveBeenCalledOnce();
  });
});
