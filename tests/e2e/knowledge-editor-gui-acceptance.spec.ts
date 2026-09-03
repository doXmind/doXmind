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

  // The Collection half of this test is gone with the feature: the block set was trimmed to what
  // Typora writes, which removed the Collection, Callout, Toggle, Embed and Wiki link commands, and
  // `doxmind-collection` is no longer a shape this editor produces. What is left below is the same
  // gesture on a command that still exists — a query the menu answers, and Escape leaving the typed
  // text in the file untouched.

  await page.getByText("Gamma", { exact: true }).click();
  editor = page.locator("[data-native-block-editor]");
  await editor.fill("/quote");
  await expect(page.getByRole("listbox", { name: "Block commands" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox", { name: "Block commands" })).toHaveCount(0);
  await expect.poll(() => readFile(slashPath, "utf8")).toContain("\n\n/quote\n");

  await screenshot(page, "slash-inserted-blocks.png");
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
