import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const workspaceDir = join(tmpdir(), "doxmind-split-panes-e2e");
const leftPath = join(workspaceDir, "Left.md");

test.beforeEach(async () => {
  await rm(workspaceDir, { recursive: true, force: true });
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(leftPath, "# Left\n\nLeft body paragraph.\n\nGo to [[Second]].\n", "utf8");
});

test.afterEach(async () => {
  await rm(workspaceDir, { recursive: true, force: true });
});

/**
 * With two panes open, every bare `[data-native-markdown-document]` locator matches twice
 * and fails Playwright's strict mode. Everything below is scoped to one pane.
 */
const pane = (page: Page, which: "active" | "inactive") =>
  page.locator(`[data-editor-pane="${which}"]`);
const documentIn = (paneLocator: Locator) => paneLocator.locator("[data-native-markdown-document]");

test("a split shows two different Pages, and only one of them is active", async ({ page }) => {
  await openBothAndSplit(page);

  await expect(page.locator("[data-editor-pane]")).toHaveCount(2);
  await expect(pane(page, "active")).toHaveCount(1);
  await expect(pane(page, "inactive")).toHaveCount(1);

  const activeFile = await documentIn(pane(page, "active")).getAttribute("data-file-id");
  const otherFile = await documentIn(pane(page, "inactive")).getAttribute("data-file-id");
  expect(activeFile).toBeTruthy();
  // One Page per pane. Two panes over one file would give it two independent edit
  // histories and let a save from either overwrite the other.
  expect(activeFile).not.toBe(otherFile);
});

test("the active pane is marked, and both panes reserve the same space for it", async ({
  page,
}) => {
  await openBothAndSplit(page);

  const bars = await page.locator("[data-editor-pane] > span[aria-hidden]").evaluateAll((els) =>
    els.map((el) => ({
      transparent: getComputedStyle(el).backgroundColor.endsWith(", 0)"),
      height: el.getBoundingClientRect().height,
    }))
  );

  expect(bars).toHaveLength(2);
  expect(bars.filter((bar) => !bar.transparent)).toHaveLength(1);
  // Equal heights, so focus moving between panes never shifts a line of text.
  expect(new Set(bars.map((bar) => bar.height)).size).toBe(1);
});

test("clicking a pane moves the active marker to it", async ({ page }) => {
  await openBothAndSplit(page);
  const before = await documentIn(pane(page, "active")).getAttribute("data-file-id");

  // Well below the top: the tab strip is absolutely positioned over the panes and
  // intercepts a click near their top edge.
  await pane(page, "inactive").click({ position: { x: 200, y: 300 } });

  await expect
    .poll(() => documentIn(pane(page, "active")).getAttribute("data-file-id"))
    .not.toBe(before);
  await expect(pane(page, "active")).toHaveCount(1);
  await expect(documentIn(pane(page, "inactive"))).toHaveAttribute("data-file-id", before!);
});

test("a save reaches the file of the pane that was clicked into", async ({ page }) => {
  await openBothAndSplit(page);
  // The Page backed by a file is in the other pane; clicking into it is what makes the
  // save target it, so this exercises the focus change and the save together.
  const filePane = pane(page, "inactive");
  await expect(documentIn(filePane)).toHaveAttribute("data-file-id", /^path:/);
  await filePane.click({ position: { x: 200, y: 300 } });
  await expect(documentIn(pane(page, "active"))).toHaveAttribute("data-file-id", /^path:/);

  const otherBefore = await documentIn(pane(page, "inactive")).innerText();
  await pane(page, "active").getByText("Left body paragraph.").first().click();
  const editor = pane(page, "active").locator("[data-native-block-editor]");
  await expect(editor).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.type(" split-pane-token");
  await page.keyboard.press("ControlOrMeta+s");

  await expect
    .poll(() => readFile(leftPath, "utf8"), { timeout: 20_000 })
    .toContain("split-pane-token");
  expect(await documentIn(pane(page, "inactive")).innerText()).toBe(otherBefore);
});

test("closing the other pane leaves a single document", async ({ page }) => {
  await openBothAndSplit(page);
  await runCommand(page, "Close the other pane");

  await expect(page.locator("[data-native-markdown-document]")).toHaveCount(1);
  // The pane wrappers only exist while split; unsplit there is nothing to distinguish.
  await expect(page.locator("[data-editor-pane]")).toHaveCount(0);
});

/**
 * Two Pages open as tabs, then split, so each pane holds one of them.
 *
 * The second tab comes from following a wiki link rather than from navigating: a full
 * page load starts a fresh session with a single tab, and a split needs two. Opened this
 * way the second Page is transient — a loose `?file=` has no folder behind it, so the
 * link resolves to nothing and following it starts an unsaved Page. Only one of the two
 * panes therefore has a file behind it, which is why the save test below clicks into that
 * one rather than typing wherever the split happened to leave the focus.
 */
async function openBothAndSplit(page: Page) {
  await page.goto(`/editor?file=${encodeURIComponent(leftPath)}`);
  await expect(page.getByTestId("markdown-block-runtime").first()).toBeVisible();

  await page.getByText("Second", { exact: true }).first().click();
  await expect(page.getByRole("tab")).toHaveCount(2);

  await runCommand(page, "Split right");
  await expect(page.locator("[data-native-markdown-document]")).toHaveCount(2);
}

async function runCommand(page: Page, label: string) {
  await page.keyboard.press("ControlOrMeta+p");
  const search = page.getByLabel("Search commands");
  await expect(search).toBeVisible();
  await search.fill(label);
  // The first result of the palette's own filtering, not a name match: an option's
  // accessible name also carries its description and shortcut.
  await page.getByRole("option").first().click();
  await expect(search).toHaveCount(0);
}
