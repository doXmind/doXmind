import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const workspaceDir = join(homedir(), "Documents", "doXmind");
const smokeMarkdownPath = join(workspaceDir, "smoke.md");
const smokePdfPath = join(workspaceDir, "smoke.pdf");
const smokeExcelPath = join(workspaceDir, "smoke.xlsx");

test.beforeAll(async () => {
  await ensureSmokeFixtures();
});

test("Markdown opens in read mode and promotes to editable on click", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/doXmind/i);

  await openLooseFile(page, smokeMarkdownPath);

  // Single-renderer model: MarkdownRuntime stays mounted across read↔edit;
  // only `contenteditable` flips. There is no separate browsing-runtime
  // surface to swap in and out.
  const markdownRuntime = page.getByTestId("markdown-runtime");
  await expect(markdownRuntime).toBeVisible();
  await expect(page.locator('div.ProseMirror[contenteditable="true"]')).toHaveCount(0);
  await expect(page.locator('div.ProseMirror[contenteditable="false"]')).toBeVisible();

  await expect(page.getByRole("heading", { name: "doXmind Playwright Smoke" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Deep Section" })).toBeAttached();
  await expect(page.getByRole("link", { name: "Example link" })).toBeVisible();

  // Search highlights use the TipTap search extension's `.search-result`
  // class (src/extensions/search/index.ts).
  await page.getByRole("button", { name: /Find/ }).click();
  await page.getByLabel("Search text").fill("needle");
  await expect(page.locator(".search-result")).toHaveCount(3);
  // Still in read mode while searching.
  await expect(page.locator('div.ProseMirror[contenteditable="true"]')).toHaveCount(0);

  const scroll = page.locator("[data-editor-scroll]");
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
  await expect(page.getByRole("heading", { name: "Deep Section" })).toBeInViewport();

  await scroll.evaluate((el) => {
    el.scrollTop = Math.floor(el.scrollHeight * 0.45);
  });
  const beforeEditScroll = await scroll.evaluate((el) => el.scrollTop);
  const scrollBox = await scroll.boundingBox();
  if (!scrollBox) throw new Error("Editor scroll area was not visible");
  await page.mouse.click(scrollBox.x + scrollBox.width / 2, scrollBox.y + scrollBox.height / 2);

  // Promotion: same runtime instance, contenteditable flips false → true.
  await expect(page.locator('div.ProseMirror[contenteditable="true"]')).toBeVisible();
  await expect(markdownRuntime).toBeVisible();
  await expect
    .poll(() => scroll.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(beforeEditScroll - 80);
});

test("keyboard edit intent promotes Markdown read mode to editable", async ({ page }) => {
  await openLooseFile(page, smokeMarkdownPath);

  const markdownRuntime = page.getByTestId("markdown-runtime");
  await expect(markdownRuntime).toBeVisible();
  await expect(page.locator('div.ProseMirror[contenteditable="true"]')).toHaveCount(0);

  await page.keyboard.type("x");

  await expect(page.locator('div.ProseMirror[contenteditable="true"]')).toBeVisible();
  await expect(markdownRuntime).toBeVisible();
});

test("PDF and Excel loose files use their dedicated runtimes", async ({ page }) => {
  await openLooseFile(page, smokePdfPath);
  await expect(page.getByTestId("pdf-runtime")).toBeVisible();
  await expect(page.getByTestId("markdown-runtime")).toHaveCount(0);

  await openLooseFile(page, smokeExcelPath);
  await expect(page.getByTestId("excel-runtime")).toBeVisible();
  await expect(page.getByTestId("markdown-runtime")).toHaveCount(0);
});

async function openLooseFile(page: Page, absolutePath: string) {
  await page.goto(`/editor?file=${encodeURIComponent(absolutePath)}`);
  await expect(page.locator("text=Loading")).toHaveCount(0);
}

async function ensureSmokeFixtures() {
  await mkdir(workspaceDir, { recursive: true });
  await ensureSmokeMarkdown();
  await ensureSmokePdf();
  await ensureSmokeExcel();
}

async function ensureSmokeMarkdown() {
  const marker = "<!-- doxmind-playwright-smoke:v2 -->";
  if (existsSync(smokeMarkdownPath)) {
    const existing = await readFile(smokeMarkdownPath, "utf8");
    if (existing.includes(marker)) return;
  }

  await writeFile(
    smokeMarkdownPath,
    [
      marker,
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

async function ensureSmokePdf() {
  if (existsSync(smokePdfPath)) return;

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("doXmind PDF smoke fixture", {
    x: 72,
    y: 720,
    size: 18,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });
  await writeFile(smokePdfPath, await pdf.save());
}

async function ensureSmokeExcel() {
  if (existsSync(smokeExcelPath)) return;

  const source = join(process.cwd(), "server", "tests", "fixtures", "budget.xlsx");
  await mkdir(dirname(smokeExcelPath), { recursive: true });
  await writeFile(smokeExcelPath, await readFile(source));
}
