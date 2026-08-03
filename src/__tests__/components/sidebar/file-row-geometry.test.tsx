import { NextIntlClientProvider } from "next-intl";
import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { FileItem } from "@/components/sidebar/file-item";
import { useFileStore } from "@/stores/file-store";
import en from "@/messages/en.json";
import type { FileItem as FileItemType } from "@/types";

const page: FileItemType = {
  id: "page-1",
  name: "A Page With A Name Long Enough To Truncate.md",
  content: "Draft\n",
  isFolder: false,
  parentId: null,
  position: 0,
  isFavorite: false,
  createdAt: "2024-03-12T00:00:00.000Z",
  updatedAt: "2024-03-12T00:00:00.000Z",
  wordCount: 1,
  preview: "Draft",
  documentType: "markdown",
};

function renderRow() {
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <FileItem file={page} />
    </NextIntlClientProvider>
  );
}

function row() {
  return document.querySelector<HTMLElement>(".group\\/file")!;
}

describe("Sidebar file row geometry", () => {
  beforeEach(() => {
    useFileStore.setState({
      files: [page],
      currentFileId: null,
      selectedFileIds: new Set<string>(),
    });
  });

  // A folder row puts its 18px glyph straight in the row; the file row wrapped
  // its own in a 20x20 flex box, which centred the glyph 1px right and pushed
  // the label 2px right of every folder label at the same depth.
  it("puts the glyph straight in the row, at the folder rows' 18px", () => {
    renderRow();

    const glyph = row().querySelector("svg")!;
    expect(glyph.parentElement).toBe(row());
    const classes = glyph.getAttribute("class")!.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(["h-[18px]", "w-[18px]", "shrink-0"]));
  });

  // The stamp used to float over the name's box with 48px (pr-12) reserved for
  // it, against a 71.8px worst case ("Mar 12, 2024") — so any file 30+ days old
  // printed its date through its own truncated name.
  it("lays the relative timestamp out in flow, not over the name", () => {
    renderRow();

    const stamp = row().querySelector<HTMLElement>("span[aria-hidden]")!;
    const classes = stamp.className.split(/\s+/);
    expect(classes).toContain("shrink-0");
    expect(classes).not.toContain("absolute");
    expect(classes.some((name) => name.startsWith("right-"))).toBe(false);

    const nameBox = screen.getByText("A Page With A Name Long Enough To Truncate").parentElement!;
    expect(nameBox.className.split(/\s+/)).not.toContain("pr-12");
  });

  // #ffffff on the sidebar's #f6f6f7 glass is 1.08:1. The lift the design
  // already authored is what makes that chip legible, and it was defined in
  // globals.css and referenced nowhere.
  it("applies the authored active-row lift tokens", () => {
    renderRow();
    expect(row().style.boxShadow).toBe("");

    cleanup();
    useFileStore.setState({ currentFileId: page.id });
    renderRow();

    expect(row().style.boxShadow).toContain("var(--sidebar-active-border)");
    expect(row().style.boxShadow).toContain("var(--sidebar-active-shadow)");
  });

  // Selecting a row must not re-measure its text. Going 500 -> 600 re-truncated
  // a name that had just fit.
  it("keeps the name's weight constant across selection", () => {
    renderRow();
    const inactive = screen
      .getByText("A Page With A Name Long Enough To Truncate")
      .className.split(/\s+/);

    cleanup();
    useFileStore.setState({ currentFileId: page.id });
    renderRow();
    const active = screen
      .getByText("A Page With A Name Long Enough To Truncate")
      .className.split(/\s+/);

    expect(inactive).toContain("font-medium");
    expect(active).toContain("font-medium");
    expect(active).not.toContain("font-semibold");
  });
});
