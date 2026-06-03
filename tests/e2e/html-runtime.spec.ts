import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const workspaceDir = join(homedir(), "Documents", "doXmind");

const fullDocPath = join(workspaceDir, "smoke-html-full.html");
const fullDocSidecar = join(workspaceDir, ".smoke-html-full.html.doxmind");
const fragmentPath = join(workspaceDir, "smoke-html-fragment.html");
const fragmentSidecar = join(workspaceDir, ".smoke-html-fragment.html.doxmind");

const FULL_DOC = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>h1 { color: rgb(10, 20, 30); } .tag { font-weight: 700; }</style>
<script>window.__doxmindPwned = true;</script>
</head>
<body>
<h1 id="title">Native HTML Heading</h1>
<p id="para">Original paragraph text.</p>
<p class="tag">A styled block.</p>
</body>
</html>`;

const FRAGMENT = `<h2 id="frag-title">Fragment Heading</h2>
<p id="frag-para">Fragment body text.</p>`;

test.beforeAll(async () => {
  await mkdir(workspaceDir, { recursive: true });
  // Start from a clean slate so stale sidecars/edits from a prior run don't
  // mask a regression.
  await Promise.all([rm(fullDocSidecar, { force: true }), rm(fragmentSidecar, { force: true })]);
  await writeFile(fullDocPath, FULL_DOC, "utf8");
  await writeFile(fragmentPath, FRAGMENT, "utf8");
});

async function openLooseFile(page: Page, absolutePath: string) {
  await page.goto(`/editor?file=${encodeURIComponent(absolutePath)}`);
  await expect(page.locator("text=Loading")).toHaveCount(0);
}

test("renders an .html file natively in a sandboxed, editable iframe", async ({ page }) => {
  await openLooseFile(page, fullDocPath);

  // Routed to the native HTML runtime, NOT the TipTap markdown runtime.
  const runtime = page.getByTestId("html-runtime");
  await expect(runtime).toBeVisible();
  await expect(page.getByTestId("markdown-runtime")).toHaveCount(0);

  const iframe = runtime.locator("iframe");
  await expect(iframe).toHaveAttribute("sandbox", "allow-same-origin");

  // The file's own markup renders verbatim inside the frame.
  const frame = page.frameLocator('[data-testid="html-runtime"] iframe');
  await expect(frame.locator("#title")).toHaveText("Native HTML Heading");
  await expect(frame.locator("p.tag")).toHaveText("A styled block.");

  // The file's own <style> applies inside the isolated frame.
  await expect(frame.locator("#title")).toHaveCSS("color", "rgb(10, 20, 30)");

  // The document is editable in place (designMode flag, not a DOM attribute).
  const designMode = await frame
    .locator("body")
    .evaluate((el) => (el.ownerDocument as Document).designMode);
  expect(designMode).toBe("on");

  // Sandbox grants no allow-scripts: the inline <script> never ran.
  const pwned = await page
    .frameLocator('[data-testid="html-runtime"] iframe')
    .locator("body")
    .evaluate(() => (window as unknown as { __doxmindPwned?: boolean }).__doxmindPwned ?? false);
  expect(pwned).toBe(false);
});

test("editing text persists to disk and preserves full-document structure", async ({ page }) => {
  await openLooseFile(page, fullDocPath);

  const frame = page.frameLocator('[data-testid="html-runtime"] iframe');
  const para = frame.locator("#para");
  await expect(para).toBeVisible();

  // Place the caret at the end of the paragraph and append a marker.
  await para.click();
  await page.keyboard.press("End");
  const marker = "APPENDED_BY_E2E_FULL";
  await page.keyboard.type(` ${marker}`);

  // Autosave is debounced (EDITOR_DEBOUNCE_DELAY = 1000ms). Poll the file.
  await expect
    .poll(async () => await readFile(fullDocPath, "utf8"), { timeout: 8_000 })
    .toContain(marker);

  const saved = await readFile(fullDocPath, "utf8");
  // Structure survives the round-trip: doctype, <html>, the <style>, and the
  // original heading are all still present.
  expect(saved).toContain("<!DOCTYPE html>");
  expect(saved).toMatch(/<html[\s>]/i);
  expect(saved).toContain("color: rgb(10, 20, 30)");
  expect(saved).toContain("Native HTML Heading");
  expect(saved).toContain(`Original paragraph text. ${marker}`);

  // No editing affordances must leak into the persisted HTML.
  expect(saved).not.toContain("contenteditable");

  // The sidecar caches the same saved HTML.
  expect(existsSync(fullDocSidecar)).toBe(true);
  const sidecar = JSON.parse(await readFile(fullDocSidecar, "utf8"));
  expect(sidecar.html).toContain(marker);

  // Reopening shows the persisted edit (not the pre-edit fixture).
  await openLooseFile(page, fullDocPath);
  await expect(
    page.frameLocator('[data-testid="html-runtime"] iframe').locator("#para")
  ).toContainText(marker);
});

test("a fragment .html file stays a fragment on save", async ({ page }) => {
  await openLooseFile(page, fragmentPath);

  const frame = page.frameLocator('[data-testid="html-runtime"] iframe');
  const para = frame.locator("#frag-para");
  await expect(para).toHaveText("Fragment body text.");

  await para.click();
  await page.keyboard.press("End");
  const marker = "APPENDED_BY_E2E_FRAG";
  await page.keyboard.type(` ${marker}`);

  await expect
    .poll(async () => await readFile(fragmentPath, "utf8"), { timeout: 8_000 })
    .toContain(marker);

  const saved = await readFile(fragmentPath, "utf8");
  // The body's innerHTML is written back — no <html>/<head>/<body> wrapper is
  // introduced for a file that didn't have one.
  expect(saved).not.toMatch(/<html[\s>]/i);
  expect(saved).not.toMatch(/<body[\s>]/i);
  expect(saved).not.toContain("<!DOCTYPE");
  expect(saved).toContain(`Fragment body text. ${marker}`);
});
