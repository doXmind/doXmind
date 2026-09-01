import { expect, test, type Page } from "@playwright/test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const workspaceDir = join(tmpdir(), "doxmind-audit-print-chrome");
const leftPath = join(workspaceDir, "Left.md");

test.beforeEach(async () => {
  await rm(workspaceDir, { recursive: true, force: true });
  await mkdir(workspaceDir, { recursive: true });
  const body = Array.from({ length: 150 }, (_, i) => `Paragraph ${i} of the left page.`).join(
    "\n\n"
  );
  await writeFile(leftPath, `# Left\n\n${body}\n\nGo to [[Second]].\n`, "utf8");
});

test.afterEach(async () => {
  await rm(workspaceDir, { recursive: true, force: true });
});

async function runCommand(page: Page, label: string) {
  await page.keyboard.press("ControlOrMeta+p");
  const search = page.getByLabel("Search commands");
  await expect(search).toBeVisible();
  await search.fill(label);
  await page.getByRole("option").first().click();
  await expect(search).toHaveCount(0);
}

const PROBE = `(() => {
  const paneEl = document.querySelector('[data-editor-pane]');
  const host = paneEl ? paneEl.parentElement : null;
  const kids = host ? Array.from(host.children) : [];
  const handle = kids.find((el) => !el.hasAttribute('data-editor-pane')) || null;
  const sep = handle ? handle.querySelector('div.absolute.inset-y-0.left-0') : null;
  const bar = document.querySelector('[data-editor-pane="active"] > span[aria-hidden]');
  const activeDoc = document.querySelector('[data-native-markdown-document][data-pane-active="true"]');
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top),
             display: cs.display, bg: cs.backgroundColor };
  };
  return {
    hostDisplay: host ? getComputedStyle(host).display : null,
    handleClass: handle ? handle.className : null,
    handle: box(handle),
    separator: box(sep),
    activeBar: box(bar),
    activePane: box(paneEl),
    activeDoc: box(activeDoc),
    bodyH: Math.round(document.body.getBoundingClientRect().height),
  };
})()`;

test("audit: split chrome under print media, at HEAD and with the working-tree fix", async ({
  page,
}) => {
  await page.goto(`/editor?file=${encodeURIComponent(leftPath)}`);
  await expect(page.getByTestId("markdown-block-runtime").first()).toBeVisible();
  await page.getByText("Second", { exact: true }).first().click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await runCommand(page, "Split right");
  await expect(page.locator("[data-native-markdown-document]")).toHaveCount(2);

  await page.emulateMedia({ media: "print" });
  await page.waitForTimeout(800);

  const withFix = await page.evaluate(PROBE);

  // Reproduce HEAD exactly: both working-tree fixes are attribute-driven, so stripping the
  // two attributes makes every selector they added stop matching.
  await page.evaluate(() => {
    document
      .querySelectorAll("[data-editor-split-host]")
      .forEach((el) => el.removeAttribute("data-editor-split-host"));
    document
      .querySelectorAll("[data-editor-pane] > span[aria-hidden][data-native-editor-chrome]")
      .forEach((el) => el.removeAttribute("data-native-editor-chrome"));
  });
  await page.waitForTimeout(500);
  const atHead = await page.evaluate(PROBE);

  console.log("AUDIT_WITH_WORKING_TREE_FIX " + JSON.stringify(withFix));
  console.log("AUDIT_AT_HEAD " + JSON.stringify(atHead));
});
