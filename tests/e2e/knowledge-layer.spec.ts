import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let workspaceDir: string;
let targetPath: string;
let sourcePath: string;
let runtimeErrors: string[];

test.beforeEach(async ({ page }) => {
  workspaceDir = await mkdtemp(join(tmpdir(), "doxmind-knowledge-layer-e2e-"));
  targetPath = join(workspaceDir, "Target.md");
  sourcePath = join(workspaceDir, "Source.md");
  runtimeErrors = observeRuntimeErrors(page);
  await writeFile(targetPath, "# Target\n\nPortable body.\n", "utf8");
  await writeFile(sourcePath, "# Source\n\nSee [[Target]] and [[Missing]].\n", "utf8");
});

test.afterEach(async () => {
  expect(runtimeErrors).toEqual([]);
  await rm(workspaceDir, { recursive: true, force: true });
});

test("edits portable properties and rebuilds backlinks from Markdown files", async ({ page }) => {
  await page.goto(`/editor?file=${encodeURIComponent(targetPath)}`);
  await expect(page.getByTestId("markdown-block-runtime")).toBeVisible();

  await page.getByRole("button", { name: "Page properties" }).click();
  await page.getByLabel("Tags").fill("local, knowledge");
  await page.getByLabel("Aliases").fill("Home");
  await page.getByRole("button", { name: "Save properties" }).click();

  await expect
    .poll(() => readFile(targetPath, "utf8"))
    .toMatch(
      /---\nid: [0-9a-f-]+\naliases: \["Home"\]\ntags: \["local","knowledge"\]\n---\n\n# Target\n\nPortable body\.\n/
    );

  await page.getByRole("button", { name: "Backlinks" }).click();
  const sourceLink = page.getByRole("button", { name: /Source\.md: Target/ });
  await expect(sourceLink).toBeVisible();
  await sourceLink.click();

  await expect(page.getByTestId("markdown-block-runtime")).toContainText("See Target and Missing.");
  await page.getByRole("button", { name: "Backlinks" }).click();
  await expect(page.getByText("Unresolved links")).toBeVisible();
  await expect(
    page.getByLabel("Unresolved links").getByText("Missing", { exact: true })
  ).toBeVisible();

  expect((await readdir(workspaceDir)).sort()).toEqual(["Source.md", "Target.md"]);
});

function observeRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}
