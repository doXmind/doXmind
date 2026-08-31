import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceHeader } from "@/components/sidebar/workspace-header";
import { useFileStore } from "@/stores/file-store";
import en from "@/messages/en.json";

function renderHeader() {
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <WorkspaceHeader
        onCreateFile={vi.fn()}
        onCreateFolder={vi.fn()}
        onOpenTemplatePicker={vi.fn()}
        onCollapseAll={vi.fn()}
        onOpenSearch={vi.fn()}
      />
    </NextIntlClientProvider>
  );
}

/**
 * "New page" and "Collapse all" are two 28px buttons in one cluster. One was a
 * `Button variant="ghost"` and the other a bare `<button>`, so the ghost
 * variant's hover fill won on the first and `.sidebar-action-button`'s opaque
 * --sidebar-hover won on the second: rgba(33,33,33,0.06) next to
 * rgb(236,238,241), a visible hue shift between neighbours.
 */
describe("Sidebar action cluster", () => {
  beforeEach(() => {
    useFileStore.setState({ openTarget: "folder", rootPath: "/workspace", openFilePath: null });
  });

  it("builds both cluster buttons from the same component and classes", () => {
    renderHeader();

    const newPage = screen.getByRole("button", { name: /new/i });
    const search = screen.getByRole("button", { name: /^search$/i });
    const collapse = screen.getByRole("button", { name: /collapse all/i });

    for (const button of [newPage, search, collapse]) {
      const classes = button.className.split(/\s+/);
      expect(classes).toContain("sidebar-action-button");
      expect(classes).toContain("h-7");
      expect(classes).toContain("w-7");
      expect(classes).toContain("rounded-lg");
      // The ghost variant's own hover fill — present on both means one fill.
      expect(classes).toContain("hover:bg-foreground/[0.06]");
    }
  });

  it("gives both cluster glyphs the one 16px chrome size", () => {
    renderHeader();

    for (const name of [/new/i, /^search$/i, /collapse all/i]) {
      const glyph = screen.getByRole("button", { name }).querySelector("svg")!;
      expect(glyph.getAttribute("class")?.split(/\s+/)).toEqual(
        expect.arrayContaining(["h-4", "w-4"])
      );
    }
  });
});
