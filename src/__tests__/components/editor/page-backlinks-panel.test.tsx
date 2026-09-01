import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  PageBacklinksPanel,
  type PageBacklinksServices,
} from "@/components/editor/page-backlinks-panel";
import type { KnowledgeIndex } from "@/lib/knowledge-index";
import en from "@/messages/en.json";
import type { FileItem } from "@/types";

const page: FileItem = {
  id: "target",
  name: "Target.md",
  content: "# Target\n",
  sourceRevision: "sha256:one",
  meta: { id: "target" },
  isFolder: false,
  parentId: null,
  position: 0,
  isFavorite: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  wordCount: 2,
  preview: "Target",
  documentType: "markdown",
  storageHandle: {
    mode: "disk",
    id: "target",
    kind: "document",
    documentType: "markdown",
    path: "Notes/Target.md",
    relPath: "Notes/Target.md",
  },
};

const index: KnowledgeIndex = {
  pages: [
    { id: "source", path: "Notes/Source.md", title: "Source", aliases: [] },
    { id: "target", path: "Notes/Target.md", title: "Target", aliases: [] },
  ],
  links: [
    {
      kind: "wiki",
      sourceId: "source",
      sourcePath: "Notes/Source.md",
      targetId: "target",
      targetPath: "Notes/Target.md",
      targetText: "Target",
      alias: "the target",
      fragment: null,
      status: "resolved",
      range: { from: 4, to: 25 },
    },
    {
      kind: "wiki",
      sourceId: "target",
      sourcePath: "Notes/Target.md",
      targetId: null,
      targetPath: null,
      targetText: "Missing",
      alias: null,
      fragment: null,
      status: "unresolved",
      range: { from: 10, to: 21 },
    },
  ],
  backlinks: [
    {
      targetId: "target",
      targetPath: "Notes/Target.md",
      links: [
        {
          kind: "wiki",
          sourceId: "source",
          sourcePath: "Notes/Source.md",
          targetId: "target",
          targetPath: "Notes/Target.md",
          targetText: "Target",
          alias: "the target",
          fragment: null,
          status: "resolved",
          range: { from: 4, to: 25 },
        },
      ],
    },
  ],
  unlinkedMentions: [],
};

const mention = {
  sourceId: "source",
  sourcePath: "Notes/Source.md",
  targetId: "target",
  targetPath: "Notes/Target.md",
  text: "Target",
  range: { from: 6, to: 12 },
};

const indexWithMention: KnowledgeIndex = { ...index, unlinkedMentions: [mention] };

function services(overrides: Partial<PageBacklinksServices> = {}): PageBacklinksServices {
  return {
    saveCurrentPage: vi.fn().mockResolvedValue(true),
    rebuild: vi.fn().mockResolvedValue(index),
    navigate: vi.fn().mockResolvedValue(true),
    linkMention: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderPanel(value = services()) {
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <PageBacklinksPanel file={page} services={value} />
    </NextIntlClientProvider>
  );
  return value;
}

describe("PageBacklinksPanel", () => {
  it("flushes the Page, rebuilds from files, and navigates an incoming occurrence", async () => {
    const user = userEvent.setup();
    const value = renderPanel();

    await user.click(screen.getByRole("button", { name: "Backlinks" }));

    expect(value.saveCurrentPage).toHaveBeenCalledWith("target");
    expect(value.rebuild).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: /Notes\/Source\.md/ })).toBeInTheDocument();
    expect(screen.getByText("Unresolved links")).toBeInTheDocument();
    expect(screen.getByText("Missing")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Notes\/Source\.md/ }));
    expect(value.navigate).toHaveBeenCalledWith("source", "Notes/Source.md");
  });

  it("matches the current Page by path while its in-memory id transitions from path fallback", async () => {
    const user = userEvent.setup();
    renderPanel({
      ...services(),
      rebuild: vi.fn().mockResolvedValue({
        ...index,
        backlinks: [
          {
            ...index.backlinks[0],
            targetId: "new-frontmatter-id",
          },
        ],
      }),
    });

    await user.click(screen.getByRole("button", { name: "Backlinks" }));

    expect(await screen.findByRole("button", { name: /Notes\/Source\.md/ })).toBeInTheDocument();
  });

  it("shows an unlinked mention and opens its source Page", async () => {
    const user = userEvent.setup();
    const value = renderPanel({
      ...services(),
      rebuild: vi.fn().mockResolvedValue({
        ...index,
        unlinkedMentions: [
          {
            sourceId: "source",
            sourcePath: "Notes/Source.md",
            targetId: "target",
            targetPath: "Notes/Target.md",
            text: "Target",
            range: { from: 32, to: 38 },
          },
        ],
      }),
    });

    await user.click(screen.getByRole("button", { name: "Backlinks" }));

    expect(await screen.findByText("Unlinked mentions (1)")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Unlinked mention from Notes/Source.md: Target" })
    );
    expect(value.navigate).toHaveBeenCalledWith("source", "Notes/Source.md");
  });

  it("does not scan stale disk state when the active Page cannot be saved", async () => {
    const user = userEvent.setup();
    const value = renderPanel(services({ saveCurrentPage: vi.fn().mockResolvedValue(false) }));

    await user.click(screen.getByRole("button", { name: "Backlinks" }));

    expect(value.rebuild).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("Save the Page before rebuilding");
  });
});

describe("linking an unlinked mention", () => {
  const openPanel = async (overrides: Partial<PageBacklinksServices> = {}) => {
    const svc = services({ rebuild: vi.fn().mockResolvedValue(indexWithMention), ...overrides });
    const user = userEvent.setup();
    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <PageBacklinksPanel file={page} services={svc} />
      </NextIntlClientProvider>
    );
    await user.click(screen.getByRole("button", { name: /backlinks/i }));
    return { user, svc };
  };

  it("offers a Link action for a mention the detector already located", async () => {
    const { user, svc } = await openPanel();

    await user.click(await screen.findByRole("button", { name: /Link the mention of Target/ }));

    expect(svc.linkMention).toHaveBeenCalledWith(mention);
    // The mention stops existing once it is a link, so the list is rebuilt rather than left stale.
    expect(svc.rebuild).toHaveBeenCalledTimes(2);
  });

  it("reports a refusal instead of leaving the row looking done", async () => {
    const { user } = await openPanel({
      linkMention: vi.fn().mockRejectedValue(new Error("This Page changed since the index")),
    });

    await user.click(await screen.findByRole("button", { name: /Link the mention of Target/ }));

    expect(await screen.findByText(/This Page changed since the index/)).toBeInTheDocument();
  });
});
