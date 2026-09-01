import * as React from "react";
import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { TagsSidebar } from "@/components/sidebar/tags-sidebar";
import en from "@/messages/en.json";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";

const withIntl = (node: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
    {node}
  </NextIntlClientProvider>
);

const page = (id: string, tags: string[]) => ({ id, name: id, isFolder: false, tags });

describe("TagsSidebar", () => {
  beforeEach(() => {
    useLayoutStore.setState({ sidebarView: "tags", sidebarSearchRequest: null });
    useFileStore.setState({
      files: [
        page("a", ["project/web"]),
        page("b", ["project/api"]),
        page("c", ["inbox"]),
        { ...page("d", ["ignored"]), isAsset: true },
      ] as never,
    });
  });

  it("counts a nested tag towards its parent, once per Page", () => {
    render(withIntl(<TagsSidebar />));

    // `project` is carried by two Pages through two different children.
    expect(screen.getByRole("button", { name: "Search for tag project" }).textContent).toContain(
      "2"
    );
    expect(
      screen.getByRole("button", { name: "Search for tag project/web" }).textContent
    ).toContain("1");
  });

  it("leaves workspace files out, since they carry no Page tags", () => {
    render(withIntl(<TagsSidebar />));
    expect(screen.queryByRole("button", { name: "Search for tag ignored" })).toBeNull();
  });

  it("runs the search for a tag when it is clicked", async () => {
    const user = userEvent.setup();
    render(withIntl(<TagsSidebar />));

    await user.click(screen.getByRole("button", { name: "Search for tag inbox" }));

    expect(useLayoutStore.getState().sidebarView).toBe("search");
    expect(useLayoutStore.getState().sidebarSearchRequest?.query).toBe("tag:inbox");
  });

  it("re-runs the same tag on a second click instead of looking inert", async () => {
    const user = userEvent.setup();
    render(withIntl(<TagsSidebar />));
    const inbox = screen.getByRole("button", { name: "Search for tag inbox" });

    await user.click(inbox);
    const first = useLayoutStore.getState().sidebarSearchRequest?.token;
    await user.click(inbox);

    expect(useLayoutStore.getState().sidebarSearchRequest?.token).toBeGreaterThan(first!);
  });
});
