import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PageCollectionPreview } from "@/editor/markdown-block/page-collection-preview";
import { projectPageCollection } from "@/lib/page-collection";
import type { WorkspaceCatalogPage } from "@/lib/workspace-page-catalog";

vi.mock("@/lib/page-collection", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/page-collection")>();
  return { ...actual, projectPageCollection: vi.fn(actual.projectPageCollection) };
});

function collectionSource(definition: unknown): string {
  return `\`\`\`doxmind-collection\n${JSON.stringify(definition)}\n\`\`\`\n`;
}

const pages: WorkspaceCatalogPage[] = [
  {
    id: "task-b",
    path: "Tasks/B.md",
    title: "Later task",
    aliases: [],
    properties: { type: "task", status: "todo", due: "2026-08-01" },
    markdown: "",
    revision: null,
  },
  {
    id: "task-a",
    path: "Tasks/A.md",
    title: "First task",
    aliases: [],
    properties: { type: "task", status: "doing", due: "2026-07-30" },
    markdown: "",
    revision: null,
  },
  {
    id: "note",
    path: "Notes/Idea.md",
    title: "Idea",
    aliases: [],
    properties: { type: "note" },
    markdown: "",
    revision: null,
  },
];

describe("PageCollectionPreview", () => {
  it.each([1, 2] as const)(
    "projects a v%s table and opens every Page from a native keyboard button",
    async (version) => {
      const user = userEvent.setup();
      const onOpenPage = vi.fn();
      const source = collectionSource({
        version,
        view: "table",
        filters: [{ property: "type", operator: "equals", value: "task" }],
        columns: ["status", "due"],
        sort: [{ property: "due", direction: "asc" }],
      });

      render(
        <PageCollectionPreview source={source} context={{ status: "ready", pages, onOpenPage }} />
      );

      const table = screen.getByRole("table", { name: "Page collection table" });
      expect(table).toHaveTextContent("First taskdoing2026-07-30");
      expect(table).toHaveTextContent("Later tasktodo2026-08-01");
      expect(table).not.toHaveTextContent("Idea");
      await user.tab();
      expect(screen.getByRole("button", { name: "First task" })).toHaveFocus();
      await user.keyboard("{Enter}");
      expect(onOpenPage).toHaveBeenCalledWith("task-a");
      expect(screen.getByTestId("collection-block")).toHaveAttribute(
        "data-native-print-ready",
        "true"
      );
    }
  );

  it("projects a v2 board into property columns and keeps missing values visible", async () => {
    const user = userEvent.setup();
    const onOpenPage = vi.fn();
    const source = collectionSource({
      version: 2,
      view: "board",
      groupBy: "status",
      filters: [{ property: "type", operator: "equals", value: "task" }],
      columns: ["due"],
      sort: [{ property: "due", direction: "asc" }],
    });
    const boardPages: WorkspaceCatalogPage[] = [
      ...pages,
      {
        id: "task-missing",
        path: "Tasks/Unsorted.md",
        title: "Unsorted task",
        aliases: [],
        properties: { type: "task" },
        markdown: "",
        revision: null,
      },
    ];

    render(
      <PageCollectionPreview
        source={source}
        context={{ status: "ready", pages: boardPages, onOpenPage }}
      />
    );

    const board = screen.getByRole("region", { name: "Page collection board" });
    expect(
      within(screen.getByRole("group", { name: "doing" })).getByRole("button")
    ).toHaveTextContent("First task");
    expect(
      within(screen.getByRole("group", { name: "todo" })).getByRole("button")
    ).toHaveTextContent("Later task");
    expect(
      within(screen.getByRole("group", { name: "Missing" })).getByRole("button")
    ).toHaveTextContent("Unsorted task");
    expect(board).not.toHaveTextContent("Idea");
    const unsortedButton = screen.getByRole("button", { name: "Unsorted task" });
    unsortedButton.focus();
    await user.keyboard(" ");
    expect(onOpenPage).toHaveBeenCalledWith("task-missing");
  });

  it("projects a v2 calendar by day and exposes undated Pages as Unscheduled", () => {
    const source = collectionSource({
      version: 2,
      view: "calendar",
      dateBy: "due",
      filters: [],
      columns: ["status"],
      sort: [{ property: "due", direction: "asc" }],
    });

    render(<PageCollectionPreview source={source} context={{ status: "ready", pages }} />);

    const calendar = screen.getByRole("region", { name: "Page collection calendar" });
    expect(
      within(screen.getByRole("group", { name: "2026-07-30" })).getByRole("button", {
        name: "First task",
      })
    ).toBeVisible();
    expect(
      within(screen.getByRole("group", { name: "2026-08-01" })).getByRole("button", {
        name: "Later task",
      })
    ).toBeVisible();
    expect(
      within(screen.getByRole("group", { name: "Unscheduled" })).getByRole("button", {
        name: "Idea",
      })
    ).toBeVisible();
    expect(within(calendar).getAllByRole("button")).toHaveLength(3);
  });

  it("renders computed values, navigable relations, and fail-closed diagnostics", async () => {
    const user = userEvent.setup();
    const onOpenPage = vi.fn();
    const source = collectionSource({
      version: 2,
      view: "table",
      filters: [{ property: "type", operator: "equals", value: "task" }],
      columns: ["project", "score", "budgetTotal"],
      sort: [],
      computed: {
        version: 1,
        properties: {
          project: { type: "relation" },
          score: {
            type: "formula",
            expression: {
              type: "arithmetic",
              operator: "*",
              left: { type: "property", name: "estimate" },
              right: { type: "literal", value: 2 },
            },
          },
          budgetTotal: {
            type: "rollup",
            relation: "project",
            property: "budget",
            calculate: "sum",
          },
        },
      },
    });
    const computedPages: WorkspaceCatalogPage[] = [
      {
        id: "task-resolved",
        path: "Tasks/Resolved.md",
        title: "Resolved task",
        aliases: [],
        properties: { type: "task", project: "[[Plans/Roadmap]]", estimate: 3 },
        markdown: "",
        revision: null,
      },
      {
        id: "task-unresolved",
        path: "Tasks/Unresolved.md",
        title: "Unresolved task",
        aliases: [],
        properties: { type: "task", project: "[[Missing]]", estimate: 2 },
        markdown: "",
        revision: null,
      },
      {
        id: "roadmap",
        path: "Plans/Roadmap.md",
        title: "Roadmap",
        aliases: [],
        properties: { type: "plan", budget: 50 },
        markdown: "",
        revision: null,
      },
    ];

    render(
      <PageCollectionPreview
        source={source}
        context={{ status: "ready", pages: computedPages, onOpenPage }}
      />
    );

    const resolvedRow = screen.getByRole("button", { name: "Resolved task" }).closest("tr");
    expect(resolvedRow).not.toBeNull();
    expect(resolvedRow).toHaveTextContent("Roadmap650");
    await user.click(
      within(resolvedRow as HTMLTableRowElement).getByRole("button", { name: "Roadmap" })
    );
    expect(onOpenPage).toHaveBeenCalledWith("roadmap");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Relation project cannot resolve [[Missing]]."
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      "Page Plans/Roadmap.md has no source property estimate."
    );
    expect(screen.queryByRole("button", { name: "Missing" })).not.toBeInTheDocument();
  });

  it("re-projects only when the fence or the catalog content changes", () => {
    // The projection is quadratic in catalog size for computed relations, and
    // the editor hands this component a freshly built catalog array on every
    // keystroke. Re-running it per render froze typing in large workspaces.
    const projectSpy = vi.mocked(projectPageCollection);
    projectSpy.mockClear();
    const source = collectionSource({
      version: 2,
      view: "table",
      filters: [{ property: "type", operator: "equals", value: "task" }],
      columns: ["status"],
      sort: [],
    });
    const context = { status: "ready", pages } as const;

    const { rerender } = render(<PageCollectionPreview source={source} context={context} />);
    expect(projectSpy).toHaveBeenCalledTimes(1);

    rerender(<PageCollectionPreview source={source} context={context} />);
    expect(projectSpy).toHaveBeenCalledTimes(1);

    // A keystroke in the open Page rebuilds the catalog with fresh objects but
    // leaves every value the projection reads untouched.
    const retyped = pages.map((page) =>
      page.id === "note" ? { ...page, markdown: "typed" } : page
    );
    rerender(
      <PageCollectionPreview source={source} context={{ status: "ready", pages: retyped }} />
    );
    expect(projectSpy).toHaveBeenCalledTimes(1);

    const edited = pages.map((page) =>
      page.id === "task-a" ? { ...page, properties: { ...page.properties, status: "done" } } : page
    );
    rerender(
      <PageCollectionPreview source={source} context={{ status: "ready", pages: edited }} />
    );
    expect(projectSpy).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("table", { name: "Page collection table" })).toHaveTextContent(
      "First taskdone"
    );
  });

  it("reports loading and catalog errors with deterministic print readiness", () => {
    const source = collectionSource({
      version: 1,
      view: "table",
      filters: [],
      columns: [],
      sort: [],
    });
    const { rerender } = render(
      <PageCollectionPreview source={source} context={{ status: "loading", pages: null }} />
    );

    expect(screen.getByTestId("collection-block")).toHaveTextContent(/^Loading Page collection…$/);
    expect(screen.getByTestId("collection-block")).toHaveAttribute(
      "data-native-print-ready",
      "false"
    );

    rerender(<PageCollectionPreview source={source} context={{ status: "error", pages: null }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/^Page collection is unavailable\.$/);
    expect(screen.getByTestId("collection-block")).toHaveAttribute(
      "data-native-print-ready",
      "true"
    );
  });

  it.each([
    ["table", { version: 2, view: "table", filters: [], columns: [], sort: [] }],
    ["board", { version: 2, view: "board", groupBy: "status", filters: [], columns: [], sort: [] }],
    [
      "calendar",
      { version: 2, view: "calendar", dateBy: "due", filters: [], columns: [], sort: [] },
    ],
  ] as const)("renders an empty %s as a completed read-only projection", (view, definition) => {
    render(
      <PageCollectionPreview
        source={collectionSource(definition)}
        context={{ status: "ready", pages: [] }}
      />
    );

    expect(screen.getByLabelText(`Page collection ${view}`)).toContainElement(
      screen.getByText(/^No matching Pages$/)
    );
    expect(screen.getByTestId("collection-block")).toHaveAttribute(
      "data-native-print-ready",
      "true"
    );
  });
});
