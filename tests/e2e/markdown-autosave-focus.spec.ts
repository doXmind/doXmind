import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { tmpdir } from "node:os";

const workspaceDir = join(tmpdir(), "doxmind-autosave-focus-e2e");
const markdownPath = join(workspaceDir, "autosave-focus.md");
const repoMarkdownPath = join(process.cwd(), "__doxmind_autosave_focus_e2e.md");
let runtimeErrors: string[];

test.beforeEach(async ({ page }) => {
  runtimeErrors = observeRuntimeErrors(page);
  await rm(workspaceDir, { recursive: true, force: true });
  await rm(repoMarkdownPath, { force: true });
  await rm(legacyPageSidecarPath(repoMarkdownPath), { force: true });
  await mkdir(workspaceDir, { recursive: true });
  await writeAutosaveFixture(markdownPath);
  await writeAutosaveFixture(repoMarkdownPath);
});

test.afterEach(async () => {
  expect(runtimeErrors).toEqual([]);
  await rm(workspaceDir, { recursive: true, force: true });
  await rm(repoMarkdownPath, { force: true });
  await rm(legacyPageSidecarPath(repoMarkdownPath), { force: true });
});

test("autosave does not refresh the editor or steal focus while typing", async ({ page }) => {
  await expectAutosaveKeepsFocus(page, markdownPath);
});

test("autosave does not refresh when editing a markdown file inside the app repo", async ({
  page,
}) => {
  await expectAutosaveKeepsFocus(page, repoMarkdownPath);
});

async function expectAutosaveKeepsFocus(page: Page, absolutePath: string) {
  const navigations: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });

  await openLooseFile(page, absolutePath);

  const scroll = page.locator("[data-native-markdown-scroll]");
  const targetPreview = page.getByText("Spacer paragraph 40.", { exact: true });
  await targetPreview.scrollIntoViewIfNeeded();
  const beforeEditScroll = await scroll.evaluate((el) => el.scrollTop);
  expect(beforeEditScroll).toBeGreaterThan(100);

  await targetPreview.click();
  const editor = page.locator("[data-native-block-editor]");
  await expect(editor).toBeVisible();
  await expect(editor).toBeFocused();

  const token = " autosave-focus-token";
  await editor.type(token);
  const navigationsBeforeAutosave = navigations.length;
  await expect
    .poll(async () => (await readFile(absolutePath, "utf8")).includes(token), { timeout: 10_000 })
    .toBe(true);

  expect(navigations).toHaveLength(navigationsBeforeAutosave);
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue(/autosave-focus-token/);
  const afterSaveScroll = await scroll.evaluate((el) => el.scrollTop);
  expect(afterSaveScroll).toBeGreaterThan(beforeEditScroll - 100);
  expect(afterSaveScroll).toBeLessThan(beforeEditScroll + 100);

  const savedMarkdown = await readFile(absolutePath, "utf8");
  expect(savedMarkdown).toContain("# Autosave Focus");
  expect(savedMarkdown).toContain("Spacer paragraph 40. autosave-focus-token");
  expect(existsSync(legacyPageSidecarPath(absolutePath))).toBe(false);
}

async function openLooseFile(page: Page, absolutePath: string) {
  await page.goto(`/editor?file=${encodeURIComponent(absolutePath)}`);
  await expect(page.locator("text=Loading")).toHaveCount(0);
  await expect(page.getByTestId("markdown-block-runtime")).toBeVisible();
}

async function writeAutosaveFixture(path: string) {
  await writeFile(
    path,
    [
      "# Autosave Focus",
      "",
      "Intro paragraph.",
      "",
      ...Array.from({ length: 80 }, (_, index) => [`Spacer paragraph ${index + 1}.`, ""]).flat(),
      "",
      "End paragraph.",
      "",
    ].join("\n"),
    "utf8"
  );
}

function legacyPageSidecarPath(markdownFilePath: string) {
  const extension = extname(markdownFilePath);
  const stem = basename(markdownFilePath, extension);
  return join(dirname(markdownFilePath), `.${stem}.doxmind`);
}

function observeRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}
