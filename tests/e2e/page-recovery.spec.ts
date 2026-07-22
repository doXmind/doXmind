import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let workspaceDir: string;
let pagePath: string;
let sidecarPath: string;
let family: Array<{ path: string; bytes: Buffer }>;
let beforeSnapshot: Map<string, { bytes: Buffer; mtimeNs: bigint }>;

const pageBytes = Buffer.from("# Portable Page\n", "utf8");
const sidecarBytes = Buffer.from('{"html":"legacy ``` state"}\n', "utf8");
const backupBytes = Buffer.from('{"html":"backup legacy state"}\n', "utf8");
const lockBytes = Buffer.from([0, 255, 1, 2]);
const corruptABytes = Buffer.from([3, 4, 5, 6]);
const corruptBBytes = Buffer.from('{"corrupt":true}\n', "utf8");

test.beforeEach(async () => {
  workspaceDir = await mkdtemp(join(tmpdir(), "doxmind-page-recovery-e2e-"));
  pagePath = join(workspaceDir, "Recovered.md");
  sidecarPath = join(workspaceDir, ".Recovered.doxmind");
  family = [
    { path: pagePath, bytes: pageBytes },
    { path: sidecarPath, bytes: sidecarBytes },
    { path: `${sidecarPath}.bak`, bytes: backupBytes },
    { path: `${sidecarPath}.lock`, bytes: lockBytes },
    { path: `${sidecarPath}.corrupt-2026-a`, bytes: corruptABytes },
    { path: `${sidecarPath}.corrupt-2026-b`, bytes: corruptBBytes },
  ];
  await Promise.all(family.map((entry) => writeFile(entry.path, entry.bytes)));
  beforeSnapshot = await snapshotFamily(family.map((entry) => entry.path));
});

test.afterEach(async () => {
  await rm(workspaceDir, { recursive: true, force: true });
});

test("exports a byte-for-byte Page recovery report without changing the Page family", async ({
  page,
}) => {
  const runtimeErrors = observeRuntimeErrors(page);
  await page.goto(`/editor?file=${encodeURIComponent(pagePath)}`);
  await expect(page.getByTestId("markdown-block-runtime")).toBeVisible();
  await page.getByRole("button", { name: "Check legacy recovery" }).click();
  const notice = page.getByTestId("page-legacy-recovery");
  await expect(notice).toContainText("Legacy Page recovery artifacts found");
  await expect(notice).toContainText(".Recovered.doxmind.lock");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export Page recovery report" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("Recovered.md.doxmind-page-recovery.md");
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  const report = await readFile(downloadedPath!, "utf8");
  const payloads = Array.from(report.matchAll(/```base64\n([A-Za-z0-9+/=\n]*)\n```/g), (match) =>
    Buffer.from(match[1].replaceAll("\n", ""), "base64")
  );
  expect(payloads).toEqual([sidecarBytes, backupBytes, lockBytes, corruptABytes, corruptBBytes]);

  expect(await snapshotFamily(family.map((entry) => entry.path))).toEqual(beforeSnapshot);
  expect((await readdir(workspaceDir)).sort()).toEqual([
    ".Recovered.doxmind",
    ".Recovered.doxmind.bak",
    ".Recovered.doxmind.corrupt-2026-a",
    ".Recovered.doxmind.corrupt-2026-b",
    ".Recovered.doxmind.lock",
    "Recovered.md",
  ]);
  expect(runtimeErrors).toEqual([]);
});

async function snapshotFamily(
  paths: string[]
): Promise<Map<string, { bytes: Buffer; mtimeNs: bigint }>> {
  const entries = await Promise.all(
    paths.map(async (path) => {
      const [bytes, metadata] = await Promise.all([readFile(path), stat(path, { bigint: true })]);
      return [path, { bytes, mtimeNs: metadata.mtimeNs }] as const;
    })
  );
  return new Map(entries);
}

function observeRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}
