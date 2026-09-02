import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PagePropertiesPanel } from "@/components/editor/page-properties-panel";
import en from "@/messages/en.json";
import { useFileStore } from "@/stores/file-store";
import type { FileItem } from "@/types";

const page: FileItem = {
  id: "page-1",
  name: "Page.md",
  content: "Body\n",
  sourceRevision: "sha256:one",
  meta: { id: "page-1", aliases: ["Home"], status: "idea" },
  isFolder: false,
  parentId: null,
  position: 0,
  isFavorite: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  wordCount: 1,
  preview: "Body",
  documentType: "markdown",
};

function renderPanel(saveProperties = vi.fn().mockResolvedValue(true)) {
  useFileStore.setState({
    files: [
      page,
      {
        ...page,
        id: "roadmap",
        name: "Roadmap.md",
        storageHandle: {
          mode: "disk",
          id: "roadmap",
          kind: "document",
          documentType: "markdown",
          path: "Plans/Roadmap.md",
          relPath: "Plans/Roadmap.md",
        },
      },
    ],
  });
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <PagePropertiesPanel file={page} saveProperties={saveProperties} />
    </NextIntlClientProvider>
  );
  return saveProperties;
}

describe("PagePropertiesPanel", () => {
  it("shows current aliases and saves only changed fields", async () => {
    const user = userEvent.setup();
    const saveProperties = renderPanel();

    await user.click(screen.getByRole("button", { name: "Page properties" }));
    expect(screen.getByLabelText("Aliases")).toHaveValue("Home");

    await user.clear(screen.getByLabelText("Aliases"));
    await user.type(screen.getByLabelText("Aliases"), "Home, Start");
    await user.click(screen.getByRole("button", { name: "Save properties" }));

    expect(saveProperties).toHaveBeenCalledWith("page-1", {
      aliases: ["Home", "Start"],
    });
  });

  it("does not offer a write when no property changed", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Page properties" }));
    expect(screen.getByRole("button", { name: "Save properties" })).toBeDisabled();
  });

  it("edits and adds typed custom properties without rewriting unchanged fields", async () => {
    const user = userEvent.setup();
    const saveProperties = renderPanel();

    await user.click(screen.getByRole("button", { name: "Page properties" }));
    expect(screen.getByLabelText("Property name 1")).toHaveValue("status");
    await user.clear(screen.getByLabelText("Property value 1"));
    await user.type(screen.getByLabelText("Property value 1"), "doing");

    await user.click(screen.getByRole("button", { name: "Add property" }));
    await user.type(screen.getByLabelText("Property name 2"), "published");
    await user.selectOptions(screen.getByLabelText("Property type 2"), "checkbox");
    await user.click(screen.getByLabelText("Property value 2"));
    await user.click(screen.getByRole("button", { name: "Save properties" }));

    expect(saveProperties).toHaveBeenCalledWith("page-1", {
      published: true,
      status: "doing",
    });
  });

  it("authors a portable Page relation as exact Wiki Link frontmatter", async () => {
    const user = userEvent.setup();
    const saveProperties = renderPanel();

    await user.click(screen.getByRole("button", { name: "Page properties" }));
    await user.click(screen.getByRole("button", { name: "Add property" }));
    await user.type(screen.getByLabelText("Property name 2"), "project");
    await user.selectOptions(screen.getByLabelText("Property type 2"), "relation");
    await user.click(screen.getByLabelText("Relate property 2 to Roadmap"));
    await user.click(screen.getByRole("button", { name: "Save properties" }));

    expect(saveProperties).toHaveBeenCalledWith("page-1", {
      project: ["[[Plans/Roadmap]]"],
    });
  });
});
