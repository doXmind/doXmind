import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workspaceDir: string;
let collectionPath: string;
let embedPath: string;
let keyboardPath: string;
let tightBoundaryPath: string;
let runtimeErrors: string[];

const keyboardSource = "First\n\nSecond\n\nThird\n";
const tightBoundarySource = "# Heading\nParagraph\n## Next\nText";

test.beforeEach(async ({ page }) => {
  runtimeErrors = observeRuntimeErrors(page);
  workspaceDir = await mkdtemp(join(tmpdir(), "doxmind-native-markdown-gui-e2e-"));
  collectionPath = join(workspaceDir, "Collection Matrix.md");
  embedPath = join(workspaceDir, "Embed Matrix.md");
  keyboardPath = join(workspaceDir, "Keyboard Matrix.md");
  tightBoundaryPath = join(workspaceDir, "Tight Boundaries.md");
  await seedWorkspace();
});

test.afterEach(async () => {
  expect(runtimeErrors).toEqual([]);
  await rm(workspaceDir, { recursive: true, force: true });
});

test("projects Table, Board, and Calendar with computed navigation and fail-closed diagnostics", async ({
  page,
}) => {
  await openWorkspacePage(page, "Collection Matrix");

  const table = page.getByRole("table", { name: "Page collection table" });
  await expect(table).toBeVisible();
  const resolvedRow = table.getByRole("row").filter({
    has: page.getByRole("button", { name: "Resolved task", exact: true }),
  });
  await expect(resolvedRow).toContainText("Roadmap");
  await expect(resolvedRow).toContainText("6");
  await expect(resolvedRow).toContainText("50");

  const diagnostics = page.getByRole("alert", { name: "Collection diagnostics" });
  await expect(diagnostics).toContainText("Relation project cannot resolve [[Missing]].");
  await expect(page.getByRole("button", { name: "Missing", exact: true })).toHaveCount(0);

  const board = page.getByRole("region", { name: "Page collection board" });
  await expect(board).toBeVisible();
  await expect(
    board.getByRole("group", { name: "doing" }).getByRole("button", {
      name: "Resolved task",
      exact: true,
    })
  ).toBeVisible();
  await expect(
    board.getByRole("group", { name: "Missing" }).getByRole("button", {
      name: "Broken task",
      exact: true,
    })
  ).toBeVisible();

  const calendar = page.getByRole("region", { name: "Page collection calendar" });
  await expect(calendar).toBeVisible();
  await expect(
    calendar.getByRole("group", { name: "2026-07-30" }).getByRole("button", {
      name: "Resolved task",
      exact: true,
    })
  ).toBeVisible();
  await expect(
    calendar.getByRole("group", { name: "Unscheduled" }).getByRole("button", {
      name: "Broken task",
      exact: true,
    })
  ).toBeVisible();

  await resolvedRow.getByRole("button", { name: "Roadmap", exact: true }).click();
  await expect(page).toHaveTitle("Roadmap");
  await expect(page.getByRole("heading", { name: "Roadmap plan" })).toBeVisible();

  expect(await readFile(collectionPath, "utf8")).toBe(collectionFixture());
});

test("renders Page, heading, and unique ^block-id embeds from canonical Markdown", async ({
  page,
}) => {
  await openWorkspacePage(page, "Embed Matrix");

  const wholePage = wikiEmbed(page, "![[Target]]");
  await expect(wholePage).toContainText("Whole Page introduction.");
  await expect(wholePage).toContainText("Later section must stay out of the heading projection.");

  const heading = wikiEmbed(page, "![[Target#Details]]");
  await expect(heading).toContainText("Heading projection body.");
  await expect(heading).toContainText("Nested detail body.");
  await expect(heading).not.toContainText("Later section must stay out of the heading projection.");

  const block = wikiEmbed(page, "![[Target#^stable-block]]");
  const blockContent = block.locator("[data-wiki-embed-content]");
  await expect(blockContent).toContainText("Anchored exact body.");
  await expect(blockContent).not.toContainText("^stable-block");

  await block.getByRole("button", { name: "Open embedded Page: Target" }).click();
  await expect(page).toHaveTitle("Target");
  await expect(page.getByRole("heading", { name: "Target Page" })).toBeVisible();

  expect(await readFile(embedPath, "utf8")).toBe(embedFixture());
});

test("moves, duplicates, deletes, and undoes Blocks through native keyboard commands", async ({
  page,
}) => {
  await openWorkspacePage(page, "Keyboard Matrix");
  await page.getByText("First", { exact: true }).click();

  let editor = page.locator("[data-native-block-editor]");
  await expect(editor).toBeFocused();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(editor).toHaveValue("First");
  await expectSource(keyboardPath, "Second\n\nFirst\n\nThird\n");

  await page.keyboard.press("ControlOrMeta+z");
  await expectSource(keyboardPath, keyboardSource);

  await page.keyboard.press("ControlOrMeta+Shift+d");
  editor = page.locator("[data-native-block-editor]");
  await expect(editor).toHaveValue("First");
  await expectSource(keyboardPath, "First\n\nFirst\n\nSecond\n\nThird\n");

  await page.keyboard.press("ControlOrMeta+z");
  await expectSource(keyboardPath, keyboardSource);

  await page.keyboard.press("ControlOrMeta+Shift+Backspace");
  editor = page.locator("[data-native-block-editor]");
  await expect(editor).toHaveValue("Second");
  await expectSource(keyboardPath, "Second\n\nThird\n");

  await page.keyboard.press("ControlOrMeta+z");
  await expectSource(keyboardPath, keyboardSource);
  await expect(page.locator("[data-native-block-row]")).toHaveCount(3);
});

test("pastes multiple Blocks as one source-backed operation and undoes in one step", async ({
  page,
}) => {
  await openWorkspacePage(page, "Keyboard Matrix");
  await page.getByText("First", { exact: true }).click();

  let editor = page.locator("[data-native-block-editor]");
  await editor.evaluate((element) => {
    const textarea = element as HTMLTextAreaElement;
    textarea.setSelectionRange(0, textarea.value.length);
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "Alpha\r\n\r\nBeta\n\nGamma");
    textarea.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData })
    );
  });

  editor = page.locator("[data-native-block-editor]");
  await expect(editor).toHaveValue("Gamma");
  await expect(editor).toBeFocused();
  await expectSource(keyboardPath, "Alpha\n\nBeta\n\nGamma\n\nSecond\n\nThird\n");

  await page.keyboard.press("ControlOrMeta+z");
  await expectSource(keyboardPath, keyboardSource);
});

test("edits adjacent headings and paragraphs as four source-backed Blocks", async ({ page }) => {
  await openWorkspacePage(page, "Tight Boundaries");

  await expect(page.locator("[data-native-block-row]")).toHaveCount(4);
  await expect(page.getByRole("heading", { name: "Heading", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Next", exact: true })).toBeVisible();

  await page.getByText("Paragraph", { exact: true }).click();
  const editor = page.locator("[data-native-block-editor]");
  await expect(editor).toHaveValue("Paragraph");
  await editor.fill("Paragraph!");

  await expectSource(tightBoundaryPath, "# Heading\nParagraph!\n## Next\nText");
  await expect(page.locator("[data-native-block-row]")).toHaveCount(4);
});

async function openWorkspacePage(page: Page, pageName: string) {
  await page.goto(`/editor?folder=${encodeURIComponent(workspaceDir)}`);
  const entry = page.getByText(pageName, { exact: true }).first();
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page.getByTestId("markdown-block-runtime")).toBeVisible();
  await expect(page).toHaveTitle(pageName);
}

function wikiEmbed(page: Page, source: string): Locator {
  return page.locator("[data-wiki-embed]").filter({
    has: page.locator("code", { hasText: source }),
  });
}

async function expectSource(path: string, source: string) {
  await expect.poll(() => readFile(path, "utf8")).toBe(source);
}

function observeRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function seedWorkspace() {
  await Promise.all([
    writeFile(collectionPath, collectionFixture(), "utf8"),
    writeFile(embedPath, embedFixture(), "utf8"),
    writeFile(keyboardPath, keyboardSource, "utf8"),
    writeFile(tightBoundaryPath, tightBoundarySource, "utf8"),
    writeFile(
      join(workspaceDir, "Resolved task.md"),
      pageFixture(
        {
          id: "task-resolved",
          title: "Resolved task",
          type: "task",
          status: "doing",
          due: "2026-07-30",
          estimate: 3,
          project: "[[Roadmap]]",
        },
        "# Resolved task body\n"
      ),
      "utf8"
    ),
    writeFile(
      join(workspaceDir, "Broken task.md"),
      pageFixture(
        {
          id: "task-broken",
          title: "Broken task",
          type: "task",
          estimate: 2,
          project: "[[Missing]]",
        },
        "# Broken task body\n"
      ),
      "utf8"
    ),
    writeFile(
      join(workspaceDir, "Roadmap.md"),
      pageFixture(
        { id: "roadmap", title: "Roadmap", type: "plan", budget: 50 },
        "# Roadmap plan\n\nPortable plan body.\n"
      ),
      "utf8"
    ),
    writeFile(
      join(workspaceDir, "Target.md"),
      pageFixture(
        { id: "target", title: "Target" },
        [
          "# Target Page",
          "",
          "Whole Page introduction.",
          "",
          "## Details",
          "",
          "Heading projection body.",
          "",
          "### Nested detail",
          "",
          "Nested detail body.",
          "",
          "Anchored exact body. ^stable-block",
          "",
          "## Later",
          "",
          "Later section must stay out of the heading projection.",
          "",
        ].join("\n")
      ),
      "utf8"
    ),
  ]);
}

function collectionFixture(): string {
  return [
    "# Collection GUI Matrix",
    "",
    collectionBlock({
      version: 2,
      view: "table",
      filters: [{ property: "type", operator: "equals", value: "task" }],
      columns: ["project", "score", "budgetTotal"],
      sort: [],
      computed: computedDefinition(),
    }),
    collectionBlock({
      version: 2,
      view: "board",
      groupBy: "status",
      filters: [{ property: "type", operator: "equals", value: "task" }],
      columns: ["due"],
      sort: [],
    }),
    collectionBlock({
      version: 2,
      view: "calendar",
      dateBy: "due",
      filters: [{ property: "type", operator: "equals", value: "task" }],
      columns: ["status"],
      sort: [],
    }),
  ].join("\n");
}

function computedDefinition() {
  return {
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
  };
}

function collectionBlock(definition: unknown): string {
  return ["```doxmind-collection", JSON.stringify(definition, null, 2), "```", ""].join("\n");
}

function embedFixture(): string {
  return [
    "# Embed GUI Matrix",
    "",
    "![[Target]]",
    "",
    "![[Target#Details]]",
    "",
    "![[Target#^stable-block]]",
    "",
  ].join("\n");
}

function pageFixture(properties: Record<string, string | number | boolean>, body: string): string {
  const frontmatter = Object.entries(properties).map(
    ([key, value]) => `${key}: ${typeof value === "string" ? JSON.stringify(value) : value}`
  );
  return ["---", ...frontmatter, "---", "", body].join("\n");
}
