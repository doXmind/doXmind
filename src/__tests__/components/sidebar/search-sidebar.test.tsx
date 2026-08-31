import * as React from "react";
import { NextIntlClientProvider } from "next-intl";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SearchSidebar } from "@/components/sidebar/search-sidebar";
import en from "@/messages/en.json";
import { useFileStore } from "@/stores/file-store";
import { usePageSessionStore } from "@/stores/page-session-store";

const searchMarkdown = vi.fn();
const navigateToEditorFile = vi.fn((_id: string | null) => Promise.resolve(true));

vi.mock("@/lib/storage", () => ({
  createStorageAdapter: () => ({}),
  searchMarkdown: (adapter: unknown, query: string, options: unknown) =>
    searchMarkdown(adapter, query, options),
}));
vi.mock("@/lib/editor-navigation", () => ({
  navigateToEditorFile: (id: string | null) => navigateToEditorFile(id),
}));

const withIntl = (node: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
    {node}
  </NextIntlClientProvider>
);

const threeHits = {
  results: [
    {
      id: "a:2",
      content: "needle one",
      metadata: { fileId: "a", name: "Framed", path: "Framed.md", chunkIndex: 2 },
      score: 1,
      matches: [
        { line: 2, preview: "needle one" },
        { line: 4, preview: "and needle two" },
      ],
      matchCount: 2,
    },
    {
      id: "b:1",
      content: "needle here",
      metadata: { fileId: "b", name: "Plain", path: "Plain.md", chunkIndex: 1 },
      score: 1,
      matches: [{ line: 1, preview: "needle here" }],
      matchCount: 1,
    },
  ],
};

describe("SearchSidebar", () => {
  beforeEach(() => {
    searchMarkdown.mockReset();
    navigateToEditorFile.mockClear();
    usePageSessionStore.setState({ outlineSession: null, revealRequest: null });
    useFileStore.setState({ rootPath: "/workspace" });
  });

  it("does not search a query too short to narrow a workspace", async () => {
    const user = userEvent.setup();
    render(withIntl(<SearchSidebar />));

    await user.type(screen.getByLabelText("Search"), "n");
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(searchMarkdown).not.toHaveBeenCalled();
  });

  it("groups every hit under its Page, with per-Page and total counts", async () => {
    searchMarkdown.mockResolvedValue(threeHits);
    const user = userEvent.setup();
    render(withIntl(<SearchSidebar />));

    await user.type(screen.getByLabelText("Search"), "needle");

    // Three hits across two Pages — the adapter used to discard everything but the first per file.
    await waitFor(() => expect(screen.getByText("3 results in 2 Pages")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Framed/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "and needle two" })).toBeInTheDocument();
  });

  it("collapses one Page's hits without touching the others", async () => {
    searchMarkdown.mockResolvedValue(threeHits);
    const user = userEvent.setup();
    render(withIntl(<SearchSidebar />));

    await user.type(screen.getByLabelText("Search"), "needle");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "and needle two" })).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: /Framed/ }));

    expect(screen.queryByRole("button", { name: "and needle two" })).toBeNull();
    expect(screen.getByRole("button", { name: "needle here" })).toBeInTheDocument();
  });

  it("asks the editor for the hit's line, then navigates", async () => {
    searchMarkdown.mockResolvedValue(threeHits);
    const user = userEvent.setup();
    render(withIntl(<SearchSidebar />));

    await user.type(screen.getByLabelText("Search"), "needle");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "and needle two" })).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: "and needle two" }));

    // The reveal is queued first: navigation may need to save a dirty Page before it resolves.
    expect(usePageSessionStore.getState().revealRequest).toMatchObject({ pageId: "a", line: 4 });
    expect(navigateToEditorFile).toHaveBeenCalledWith("a");
  });
});
