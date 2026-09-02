import { expect, test, type Page } from "@playwright/test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const screenshotDir = join(process.cwd(), "test-results", "gui-acceptance");
const runtimeFailures = new WeakMap<Page, string[]>();
const workspaceDirs: string[] = [];

let workspaceDir: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await mkdir(screenshotDir, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  workspaceDir = await mkdtemp(join(tmpdir(), "doxmind-knowledge-editor-gui-"));
  workspaceDirs.push(workspaceDir);

  const failures: string[] = [];
  runtimeFailures.set(page, failures);
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
});

test.afterEach(async ({ page }, testInfo) => {
  expect
    .soft(runtimeFailures.get(page) ?? [], `${testInfo.title}: browser runtime errors`)
    .toEqual([]);
});

test.afterAll(async () => {
  await Promise.all(
    workspaceDirs.map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

test("filters and drives the Slash menu entirely from the keyboard", async ({ page }) => {
  const slashPath = join(workspaceDir, "Slash.md");
  await writeFile(slashPath, "Alpha\n\nBeta\n\nGamma\n", "utf8");

  await openWorkspacePage(page, "Slash");
  await page.getByText("Alpha", { exact: true }).click();

  let editor = page.locator("[data-native-block-editor]");
  await editor.fill("/heading");
  const headingMenu = page.getByRole("listbox", { name: "Block commands" });
  await expect(headingMenu).toBeVisible();
  await expect(headingMenu.getByRole("option")).toHaveCount(3);
  await expect(headingMenu.getByRole("option", { name: /Heading 1/ })).toHaveAttribute(
    "aria-selected",
    "true"
  );

  await page.keyboard.press("ArrowDown");
  await expect(headingMenu.getByRole("option", { name: /Heading 2/ })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await screenshot(page, "slash-menu-keyboard.png");
  await page.keyboard.press("Enter");
  editor = page.locator("[data-native-block-editor]");
  await expectSource(slashPath, "## \n\nBeta\n\nGamma\n");
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue("");
  await page.keyboard.type("Acceptance heading");
  await expectSource(slashPath, "## Acceptance heading\n\nBeta\n\nGamma\n");

  await page.getByText("Beta", { exact: true }).click();
  editor = page.locator("[data-native-block-editor]");
  await editor.fill("/kanban");
  const boardMenu = page.getByRole("listbox", { name: "Block commands" });
  await expect(boardMenu.getByRole("option")).toHaveCount(1);
  await expect(boardMenu.getByRole("option", { name: /Collection board/ })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await page.keyboard.press("Tab");
  await expect
    .poll(() => readFile(slashPath, "utf8"))
    .toContain('```doxmind-collection\n{\n  "version": 2,\n  "view": "board"');

  await page.getByText("Gamma", { exact: true }).click();
  editor = page.locator("[data-native-block-editor]");
  await editor.fill("/quote");
  await expect(page.getByRole("listbox", { name: "Block commands" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox", { name: "Block commands" })).toHaveCount(0);
  await expect.poll(() => readFile(slashPath, "utf8")).toContain("\n\n/quote\n");

  await screenshot(page, "slash-inserted-blocks.png");
});

test("persists Relation properties as exact portable Wiki Links", async ({ page }) => {
  const relationPath = join(workspaceDir, "Relations.md");
  const original = [
    "---",
    "id: relation-source",
    "title: Relation Source",
    'future_schema: {"deep":{"flag":true}}',
    "# authored frontmatter comment",
    "---",
    "",
    "# Relation Source",
    "",
    "Portable body.",
    "",
  ].join("\n");
  const expected = original.replace(
    "# authored frontmatter comment\n---",
    '# authored frontmatter comment\nproject: ["[[Plans/Roadmap]]","[[Reference/Spec]]"]\n---'
  );
  await mkdir(join(workspaceDir, "Plans"), { recursive: true });
  await mkdir(join(workspaceDir, "Reference"), { recursive: true });
  await Promise.all([
    writeFile(relationPath, original, "utf8"),
    writeFile(
      join(workspaceDir, "Plans", "Roadmap.md"),
      pageFixture("roadmap-page", "Roadmap", "# Roadmap\n\nPlan body.\n"),
      "utf8"
    ),
    writeFile(
      join(workspaceDir, "Reference", "Spec.md"),
      pageFixture("spec-page", "Spec", "# Spec\n\nReference body.\n"),
      "utf8"
    ),
  ]);

  await openWorkspacePage(page, "Relations");
  await page.getByRole("button", { name: "Page properties" }).click();
  await page.getByRole("button", { name: "Add property" }).click();
  await page.getByLabel("Property name 1").fill("project");
  await page.getByLabel("Property type 1").selectOption("relation");
  await page.getByLabel("Relate property 1 to Roadmap").check();
  await page.getByLabel("Relate property 1 to Spec").check();
  await page.getByRole("button", { name: "Save properties" }).click();

  await expectSource(relationPath, expected);

  await page.getByRole("button", { name: "Page properties" }).click();
  await expect(page.getByLabel("Relate property 1 to Roadmap")).toBeChecked();
  await expect(page.getByLabel("Relate property 1 to Spec")).toBeChecked();
  await screenshot(page, "relation-properties.png");
  await page.getByRole("button", { name: "Cancel" }).click();

  expect(await readdir(workspaceDir)).toEqual(["Plans", "Reference", "Relations.md"]);
});

test("navigates Wiki Links, Backlinks, unlinked mentions, and Graph nodes", async ({ page }) => {
  const fixtures = {
    "Target.md": pageFixture("target-page", "Target", "# Target Page\n\nCanonical target.\n"),
    "Navigator.md": pageFixture(
      "navigator-page",
      "Navigator",
      "# Navigator\n\nOpen [[Target|linked target]].\n"
    ),
    "Mention.md": pageFixture(
      "mention-page",
      "Mention",
      "# Mention\n\nTarget appears here without brackets.\n"
    ),
    "Graph Source.md": pageFixture(
      "graph-source-page",
      "Graph Source",
      "# Graph Source\n\nFollow [[Target]].\n"
    ),
  };
  await Promise.all(
    Object.entries(fixtures).map(([name, source]) =>
      writeFile(join(workspaceDir, name), source, "utf8")
    )
  );

  await openWorkspacePage(page, "Navigator");
  await page.getByRole("button", { name: "Open Page: linked target" }).click();
  await expect(page).toHaveTitle("Target");
  await expect(page.getByRole("heading", { name: "Target Page" })).toBeVisible();

  await page.getByRole("button", { name: "Backlinks" }).click();
  await expect(page.getByText("Incoming links (2)")).toBeVisible();
  await expect(page.getByText("Unlinked mentions (1)")).toBeVisible();
  const unlinkedMention = page.getByRole("button", {
    name: "Unlinked mention from Mention.md: Target",
  });
  await expect(unlinkedMention).toBeVisible();
  await screenshot(page, "backlinks-and-unlinked.png");
  await unlinkedMention.click();
  await expect(page).toHaveTitle("Mention");
  await expect(page.getByRole("heading", { name: "Mention" })).toBeVisible();

  await page.locator('[data-drop-target-id="target-page"]').click();
  await expect(page).toHaveTitle("Target");
  await page.getByRole("button", { name: "Graph" }).click();
  await expect(page.getByRole("img", { name: "Knowledge graph" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Page: Navigator" })).toBeVisible();
  await screenshot(page, "knowledge-graph.png");
  await page.getByRole("button", { name: "Open Page: Navigator" }).click();
  await expect(page).toHaveTitle("Navigator");
  await expect(page.getByRole("heading", { name: "Navigator" })).toBeVisible();

  for (const [name, source] of Object.entries(fixtures)) {
    expect(await readFile(join(workspaceDir, name), "utf8")).toBe(source);
  }
});

test("creates and reopens today's ordinary Markdown Daily Note", async ({ page }) => {
  const seedPath = join(workspaceDir, "Seed.md");
  await writeFile(seedPath, pageFixture("seed-page", "Seed", "# Seed\n\nWorkspace seed.\n"));

  await page.goto(`/editor?folder=${encodeURIComponent(workspaceDir)}`, {
    waitUntil: "networkidle",
  });
  await expect(page.getByRole("heading", { name: "This folder is ready." })).toBeVisible();
  const key = await page.evaluate(() => {
    const date = new Date();
    return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
      .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, "0"))
      .join("-");
  });

  await page.getByRole("button", { name: "Today's Daily Note" }).click();
  await expect(page).toHaveTitle(key);
  await expect(page.getByRole("heading", { name: key })).toBeVisible();

  const dailyPath = join(workspaceDir, "Daily Notes", `${key}.md`);
  await expect.poll(() => readFile(dailyPath, "utf8")).toContain(`# ${key}\n\n`);
  const persistedSource = await readFile(dailyPath, "utf8");
  const sourceMatch = persistedSource.match(
    new RegExp(
      [
        "^---",
        "id: ([0-9a-f-]+)",
        'created: "([^"\\r\\n]+)"',
        `date: "${key}"`,
        `title: "${key}"`,
        'updated: "([^"\\r\\n]+)"',
        "---",
        "",
        `# ${key}`,
        "",
        "$",
      ].join("\\n")
    )
  );
  expect(sourceMatch).not.toBeNull();
  expect(Date.parse(sourceMatch?.[2] ?? "")).not.toBeNaN();
  expect(sourceMatch?.[3]).toBe(sourceMatch?.[2]);

  await page.locator('[data-drop-target-id="seed-page"]').click();
  await expect(page).toHaveTitle("Seed");
  await page.keyboard.press("ControlOrMeta+p");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await palette.getByLabel("Search commands").fill("daily");
  await palette.getByRole("option", { name: /Open today's Daily Note/ }).click();
  await expect(page).toHaveTitle(key);
  await expect(page.getByRole("heading", { name: key })).toBeVisible();

  expect(await readFile(dailyPath, "utf8")).toBe(persistedSource);
  expect(await readdir(join(workspaceDir, "Daily Notes"))).toEqual([`${key}.md`]);
  await screenshot(page, "daily-note.png");
});

async function openWorkspacePage(page: Page, pageName: string) {
  await page.goto(`/editor?folder=${encodeURIComponent(workspaceDir)}`, {
    waitUntil: "networkidle",
  });
  const entry = page.getByText(pageName, { exact: true }).first();
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page.getByTestId("markdown-block-runtime")).toBeVisible();
  await expect(page).toHaveTitle(pageName);
}

async function expectSource(path: string, source: string) {
  await expect.poll(() => readFile(path, "utf8")).toBe(source);
}

async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: join(screenshotDir, name), fullPage: true });
}

function pageFixture(id: string, title: string, body: string): string {
  return ["---", `id: ${id}`, `title: ${title}`, "---", "", body].join("\n");
}
