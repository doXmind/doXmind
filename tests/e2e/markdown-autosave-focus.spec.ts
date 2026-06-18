import { expect, test, type Page } from "@playwright/test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const workspaceDir = join(tmpdir(), "doxmind-autosave-focus-e2e");
const markdownPath = join(workspaceDir, "autosave-focus.md");
const repoMarkdownPath = join(process.cwd(), "__doxmind_autosave_focus_e2e.md");

test.beforeEach(async () => {
  await rm(workspaceDir, { recursive: true, force: true });
  await rm(repoMarkdownPath, { force: true });
  await rm(join(process.cwd(), ".__doxmind_autosave_focus_e2e.doxmind"), { force: true });
  await mkdir(workspaceDir, { recursive: true });
  await writeAutosaveFixture(markdownPath);
  await writeAutosaveFixture(repoMarkdownPath);
});

test.afterEach(async () => {
  await rm(repoMarkdownPath, { force: true });
  await rm(join(process.cwd(), ".__doxmind_autosave_focus_e2e.doxmind"), { force: true });
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

  const editor = page.locator(".ProseMirror");
  const scroll = page.locator("[data-editor-scroll]");
  await expect(editor).toBeVisible();
  await expect(page.locator('div.ProseMirror[contenteditable="false"]')).toBeVisible();

  await scroll.evaluate((el) => {
    el.scrollTop = Math.floor(el.scrollHeight * 0.45);
  });
  const beforeEditScroll = await scroll.evaluate((el) => el.scrollTop);
  expect(beforeEditScroll).toBeGreaterThan(100);

  const box = await scroll.boundingBox();
  if (!box) throw new Error("editor scroll area was not visible");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('div.ProseMirror[contenteditable="true"]')).toBeVisible();

  await page.keyboard.type(" autosave-focus-token");
  const navigationsBeforeAutosave = navigations.length;
  await page.waitForTimeout(1_700);

  expect(navigations).toHaveLength(navigationsBeforeAutosave);
  await expect(page.locator('div.ProseMirror[contenteditable="true"]')).toBeFocused();
  await expect(editor).toContainText("autosave-focus-token");
  const afterSaveScroll = await scroll.evaluate((el) => el.scrollTop);
  expect(afterSaveScroll).toBeGreaterThan(beforeEditScroll - 100);
}

async function openLooseFile(page: Page, absolutePath: string) {
  await page.goto(`/editor?file=${encodeURIComponent(absolutePath)}`);
  await expect(page.locator("text=Loading")).toHaveCount(0);
  await expect(page.getByTestId("markdown-runtime")).toBeVisible();
}

async function writeAutosaveFixture(path: string) {
  await writeFile(
    path,
    [
      "# Autosave Focus",
      "",
      "Intro paragraph.",
      "",
      ...Array.from({ length: 80 }, (_, index) => `Spacer paragraph ${index + 1}.`),
      "",
      "End paragraph.",
      "",
    ].join("\n"),
    "utf8"
  );
}
