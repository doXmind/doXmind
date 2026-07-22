import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let workspaceDir: string;
let smokeMarkdownPath: string;
let runtimeErrors: string[];

test.beforeAll(async () => {
  workspaceDir = await mkdtemp(join(tmpdir(), "doxmind-browsing-runtime-e2e-"));
  smokeMarkdownPath = join(workspaceDir, "smoke.md");
  await writeSmokeMarkdown();
});

test.beforeEach(async ({ page }) => {
  runtimeErrors = observeRuntimeErrors(page);
  await writeSmokeMarkdown();
});

test.afterEach(async () => {
  expect(runtimeErrors).toEqual([]);
});

test.afterAll(async () => {
  await rm(workspaceDir, { recursive: true, force: true });
});

test("Markdown opens in read mode and promotes to editable on click", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/doXmind/i);

  await openLooseFile(page, smokeMarkdownPath);

  // Inactive Blocks are semantic Markdown previews. Activating one swaps only
  // that Block to its source textarea; the native runtime stays mounted.
  const markdownRuntime = page.getByTestId("markdown-block-runtime");
  const activeEditor = page.locator("[data-native-block-editor]");
  await expect(markdownRuntime).toBeVisible();
  await expect(activeEditor).toHaveCount(0);

  await expect(page.getByRole("heading", { name: "doXmind Playwright Smoke" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Deep Section" })).toBeAttached();
  await expect(
    page.locator('[data-markdown-link][title="https://example.com"]', {
      hasText: "Example link",
    })
  ).toBeVisible();
  // Measure activation only after async Mermaid/image projections settle;
  // otherwise their layout completion can be mistaken for an editor jump.
  await expect(
    page.locator('[data-mermaid-print-ready="false"], [data-native-print-ready="false"]')
  ).toHaveCount(0);

  const scroll = page.locator("[data-native-markdown-scroll]");
  const targetPreview = page.getByText("Spacer paragraph 32 keeps the document scrollable.", {
    exact: true,
  });
  await targetPreview.scrollIntoViewIfNeeded();
  const beforeEditScroll = await scroll.evaluate((element) => element.scrollTop);
  expect(beforeEditScroll).toBeGreaterThan(100);
  await targetPreview.click();

  await expect(activeEditor).toHaveCount(1);
  await expect(activeEditor).toBeFocused();
  await expect(markdownRuntime).toBeVisible();
  await expect
    .poll(() => scroll.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(beforeEditScroll - 80);
  await expect
    .poll(() => scroll.evaluate((element) => element.scrollTop))
    .toBeLessThan(beforeEditScroll + 80);

  // Find operates on Markdown source and selects the active match inside its
  // Block while leaving keyboard focus in the Find field.
  await page.keyboard.press("ControlOrMeta+f");
  const searchInput = page.getByLabel("Search text");
  await searchInput.fill("needle");
  await expect(page.getByText("1 of 3", { exact: true })).toBeVisible();
  await expect(searchInput).toBeFocused();
  await expect(activeEditor).toHaveCount(1);
  await expect
    .poll(() =>
      activeEditor.evaluate((textarea: HTMLTextAreaElement) =>
        textarea.value.slice(textarea.selectionStart, textarea.selectionEnd).toLowerCase()
      )
    )
    .toBe("needle");

  await page.getByRole("button", { name: "Next result" }).click();
  await expect(page.getByText("2 of 3", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      activeEditor.evaluate((textarea: HTMLTextAreaElement) =>
        textarea.value.slice(textarea.selectionStart, textarea.selectionEnd).toLowerCase()
      )
    )
    .toBe("needle");
  await page.getByRole("button", { name: "Close search" }).click();

  await scroll.evaluate((el) => {
    el.scrollTop = 0;
  });
  const beforeOutlineScroll = await scroll.evaluate((el) => el.scrollTop);
  await page.getByTestId("outline-rail-root").hover();
  await page
    .getByRole("navigation", { name: "Document outline" })
    .getByRole("button", { name: "Deep Section" })
    .click();
  await expect
    .poll(() => scroll.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(beforeOutlineScroll + 100);
  await expect(activeEditor).toHaveValue("## Deep Section");
  await expect(activeEditor).toBeInViewport();
});

test("keyboard edit intent promotes Markdown read mode to editable", async ({ page }) => {
  await openLooseFile(page, smokeMarkdownPath);

  const markdownRuntime = page.getByTestId("markdown-block-runtime");
  await expect(markdownRuntime).toBeVisible();
  await expect(page.locator("[data-native-block-editor]")).toHaveCount(0);

  await page.keyboard.type("x");

  await expect(page.locator("[data-native-block-editor]")).toBeVisible();
  await expect(page.locator("[data-native-block-editor]")).toBeFocused();
  await expect(markdownRuntime).toBeVisible();
});

async function openLooseFile(page: Page, absolutePath: string) {
  await page.goto(`/editor?file=${encodeURIComponent(absolutePath)}`);
  await expect(page.locator("text=Loading")).toHaveCount(0);
}

async function writeSmokeMarkdown() {
  await writeFile(
    smokeMarkdownPath,
    [
      "<!-- doxmind-playwright-smoke:v3 -->",
      "",
      "# doXmind Playwright Smoke",
      "",
      "Intro paragraph with needle and an [Example link](https://example.com).",
      "",
      "![Smoke pixel](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=)",
      "",
      "```mermaid",
      "graph TD",
      "  A[Read Mode] --> B[Edit Mode]",
      "```",
      "",
      "$$",
      "E = mc^2",
      "$$",
      "",
      "## Middle Section",
      "",
      "Middle paragraph for edit activation with another needle match.",
      "",
      ...Array.from({ length: 64 }, (_, index) => [
        `Spacer paragraph ${index + 1} keeps the document scrollable.`,
        "",
      ]).flat(),
      "",
      "## Deep Section",
      "",
      "Deep section target with final needle match.",
      "",
    ].join("\n"),
    "utf8"
  );
}

function observeRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}
