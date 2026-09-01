import * as React from "react";
import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { QuickSwitcher } from "@/components/ui/quick-switcher";
import en from "@/messages/en.json";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";

const navigateToEditorFile = vi.fn((_id: string | null) => Promise.resolve(true));
const createPageForContext = vi.fn((_context: unknown, _name?: string) =>
  Promise.resolve("new-id")
);

vi.mock("@/lib/editor-navigation", () => ({
  navigateToEditorFile: (id: string | null) => navigateToEditorFile(id),
}));
vi.mock("@/lib/new-page", () => ({
  createPageForContext: (context: unknown, name?: string) => createPageForContext(context, name),
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const withIntl = (node: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
    {node}
  </NextIntlClientProvider>
);

function page(id: string, name: string, relPath: string, updatedAt: string) {
  return {
    id,
    name,
    isFolder: false,
    updatedAt,
    storageHandle: { mode: "disk", id, kind: "document", path: relPath, relPath },
  };
}

describe("Quick switcher search", () => {
  beforeEach(() => {
    navigateToEditorFile.mockClear();
    createPageForContext.mockClear();
    useLayoutStore.setState({ isQuickSwitcherOpen: true });
    useFileStore.setState({
      currentFileId: "a",
      files: [
        page("a", "Alpha", "Alpha.md", "2026-03-03T00:00:00.000Z"),
        page("b", "Roadmap", "Projects/Roadmap.md", "2026-03-02T00:00:00.000Z"),
        page("c", "Roadmap", "Personal/Roadmap.md", "2026-03-01T00:00:00.000Z"),
      ] as never,
    });
  });

  it("focuses its input on the first commit, so typing never reaches the Page behind it", () => {
    render(withIntl(<QuickSwitcher />));

    expect(screen.getByLabelText("Find or create a Page…")).toHaveFocus();
  });

  it("narrows as the user types and disambiguates repeated names by folder", async () => {
    const user = userEvent.setup();
    render(withIntl(<QuickSwitcher />));

    await user.type(screen.getByLabelText("Find or create a Page…"), "roadmap");

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    // Both are called Roadmap, so both show where they live. Alpha is gone.
    expect(options[0].textContent).toContain("Projects");
    expect(options[1].textContent).toContain("Personal");
  });

  it("shows no folder when the name is already unambiguous", async () => {
    const user = userEvent.setup();
    render(withIntl(<QuickSwitcher />));

    await user.type(screen.getByLabelText("Find or create a Page…"), "alpha");

    // An always-on path turns the list into a wall of directories, so a unique name shows none.
    const row = screen.getAllByRole("option")[0].textContent ?? "";
    expect(row).toContain("Alpha");
    expect(row).not.toContain("Projects");
    expect(row).not.toContain("Personal");
  });

  it("offers to create the Page the user was looking for, and opens it", async () => {
    const user = userEvent.setup();
    render(withIntl(<QuickSwitcher />));

    await user.type(screen.getByLabelText("Find or create a Page…"), "Brand new");
    const create = screen.getByRole("option", { name: /Create/ });
    expect(create).toBeTruthy();

    await user.keyboard("{Enter}");

    expect(createPageForContext).toHaveBeenCalledWith(expect.anything(), "Brand new");
    expect(useLayoutStore.getState().isQuickSwitcherOpen).toBe(false);
  });

  it("does not offer to create when the query already found something", async () => {
    const user = userEvent.setup();
    render(withIntl(<QuickSwitcher />));

    await user.type(screen.getByLabelText("Find or create a Page…"), "alpha");

    expect(screen.queryByRole("option", { name: /Create/ })).toBeNull();
  });

  it("preselects the previous Page with no query, so ⌘O ↵ toggles between two Pages", async () => {
    const user = userEvent.setup();
    render(withIntl(<QuickSwitcher />));

    await user.keyboard("{Enter}");

    // "a" is current and sorts first; the selection starts on the one after it.
    expect(navigateToEditorFile).toHaveBeenCalledWith("b");
  });

  it("never opens a Page merely because a modifier was released", async () => {
    const user = userEvent.setup();
    render(withIntl(<QuickSwitcher />));

    // The old switcher confirmed on Ctrl/Meta keyup, which made ⌘O unusable as a plain opener:
    // letting go of the key you opened it with immediately navigated away.
    await user.keyboard("{Control>}{/Control}");
    await user.keyboard("{Meta>}{/Meta}");

    expect(navigateToEditorFile).not.toHaveBeenCalled();
    expect(useLayoutStore.getState().isQuickSwitcherOpen).toBe(true);
  });
});
