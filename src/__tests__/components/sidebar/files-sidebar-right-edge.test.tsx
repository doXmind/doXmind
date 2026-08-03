import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { FilesSidebar } from "@/components/sidebar/files-sidebar";
import { useFileStore } from "@/stores/file-store";
import en from "@/messages/en.json";

/**
 * Every tree row stopped at x=287 while the Settings footer ran to x=298: the
 * tree scrolls inside a container with `scrollbar-gutter: stable`, and the
 * footer sits outside it. Reserving the same gutter on the footer (the property
 * applies to any scroll container, including an `overflow: hidden` one) puts
 * both on one right edge without hard-coding the UA's gutter width.
 */
describe("Sidebar right edge", () => {
  beforeEach(() => {
    useFileStore.setState({
      files: [],
      openTarget: "folder",
      rootPath: "/workspace",
      openFilePath: null,
      isLoading: false,
      isSynced: true,
    });
  });

  it("reserves the tree's scrollbar gutter on the footer row too", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <FilesSidebar />
      </NextIntlClientProvider>
    );

    const footer = screen.getByRole("link", { name: /settings/i }).parentElement!;
    const classes = footer.className.split(/\s+/);
    expect(classes).toContain("autohide-scrollbar");
    expect(classes).toContain("overflow-y-hidden");
    // Same horizontal padding as the tree's scroll content.
    expect(classes).toContain("px-1.5");
  });
});
