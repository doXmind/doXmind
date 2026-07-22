import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

interface AttachmentFixture {
  sourcePath: string;
  sourceBytes: Buffer;
  editorState?: Record<string, unknown>;
  familyPaths: string[];
  beforeSnapshot: Map<string, FileSnapshot>;
}

interface FileSnapshot {
  bytes: Buffer;
  mtimeNs: bigint;
}

let workspaceDir: string;
let fixtures: Record<"pdf" | "excel" | "html", AttachmentFixture>;

test.beforeEach(async () => {
  workspaceDir = await mkdtemp(join(tmpdir(), "doxmind-attachment-recovery-e2e-"));
  fixtures = {
    pdf: await writeAttachmentFixture("Spec.pdf", Buffer.from("%PDF-1.4\n%%EOF\n"), {
      version: 1,
      edits: { "2:0": { text: "Recovered PDF text" } },
      highlights: [{ page: 2, color: "yellow" }],
    }),
    excel: await writeAttachmentFixture("Budget.xlsx", Buffer.from("PK\u0003\u0004fixture"), {
      version: 1,
      activeSheetId: "Sheet1",
      cells: { Sheet1: { A1: { value: "Recovered total" } } },
      frozen: { rows: 1, columns: 0 },
    }),
    html: await writeAttachmentFixture(
      "Archive.html",
      Buffer.from("<!doctype html><title>Archive</title><p>Read only</p>"),
      undefined
    ),
  };
});

test.afterEach(async () => {
  await rm(workspaceDir, { recursive: true, force: true });
});

for (const kind of ["pdf", "excel"] as const) {
  test(`${kind.toUpperCase()} stays read-only and exports exact legacy editor JSON without touching its artifact family`, async ({
    page,
  }, testInfo) => {
    const runtimeErrors = observeRuntimeErrors(page);
    const fixture = fixtures[kind];

    await openLooseFile(page, fixture.sourcePath);
    await expect(
      page.getByText(kind === "pdf" ? "PDF attachment" : "Spreadsheet attachment")
    ).toBeVisible();
    await expect(page.getByText(/read-only in doXmind/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Open externally" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reveal in Finder" })).toBeVisible();
    await expect(page.getByTestId("markdown-block-runtime")).toHaveCount(0);
    await expect(page.locator("[contenteditable='true'], [data-native-block-editor]")).toHaveCount(
      0
    );

    await page.getByRole("button", { name: "Check legacy recovery" }).click();
    await expect(page.getByText("Legacy doXmind edits found")).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export recovery report" }).click(),
    ]);
    const sourceName = fixture.sourcePath.split("/").pop();
    expect(download.suggestedFilename()).toBe(`${sourceName}.doxmind-recovery.md`);
    const downloadedPath = await download.path();
    expect(downloadedPath).not.toBeNull();
    const report = await readFile(downloadedPath!, "utf8");
    const exactState = /## Exact editor state\n\n```json\n([\s\S]*?)\n```/.exec(report);
    expect(exactState).not.toBeNull();
    expect(JSON.parse(exactState![1])).toEqual(fixture.editorState);

    expect(await snapshotFiles(fixture.familyPaths)).toEqual(fixture.beforeSnapshot);
    expect(runtimeErrors).toEqual([]);
    await testInfo.attach(`${kind}-read-only-recovery`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });
}

test("HTML stays on the read-only attachment surface and never offers an editor recovery export", async ({
  page,
}, testInfo) => {
  const runtimeErrors = observeRuntimeErrors(page);
  const fixture = fixtures.html;

  await openLooseFile(page, fixture.sourcePath);
  await expect(page.getByText("HTML attachment")).toBeVisible();
  await expect(page.getByText(/read-only in doXmind/i)).toBeVisible();
  await expect(page.getByTestId("markdown-block-runtime")).toHaveCount(0);
  await expect(page.locator("[contenteditable='true'], [data-native-block-editor]")).toHaveCount(0);

  await page.getByRole("button", { name: "Check legacy recovery" }).click();
  await expect(page.getByText("No legacy doXmind edits were found.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Export recovery report" })).toHaveCount(0);

  expect(await snapshotFiles(fixture.familyPaths)).toEqual(fixture.beforeSnapshot);
  expect(runtimeErrors).toEqual([]);
  await testInfo.attach("html-read-only", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});

async function writeAttachmentFixture(
  name: string,
  sourceBytes: Buffer,
  editorState: Record<string, unknown> | undefined
): Promise<AttachmentFixture> {
  const sourcePath = join(workspaceDir, name);
  const sidecarPath = join(workspaceDir, `.${name}.doxmind`);
  const kind = name.endsWith(".pdf") ? "pdf" : name.endsWith(".xlsx") ? "excel" : "html";
  const sidecarBytes = Buffer.from(
    JSON.stringify(
      editorState
        ? {
            version: 1,
            source_path: name,
            [`${kind}_editor`]: editorState,
            [`${kind}_parsed_cache`]: { sourceHash: "preserved-cache" },
          }
        : { version: 1, source_path: name, archived: true },
      null,
      2
    ) + "\n"
  );
  const files = [
    { path: sourcePath, bytes: sourceBytes },
    { path: sidecarPath, bytes: sidecarBytes },
    { path: `${sidecarPath}.bak`, bytes: Buffer.from("preserved backup\n") },
    { path: `${sidecarPath}.lock`, bytes: Buffer.from([0, 1, 2, 255]) },
    { path: `${sidecarPath}.corrupt-2026-a`, bytes: Buffer.from("preserved corrupt A\n") },
    { path: `${sidecarPath}.corrupt-2026-b`, bytes: Buffer.from("preserved corrupt B\n") },
  ];
  await Promise.all(files.map((file) => writeFile(file.path, file.bytes)));
  const familyPaths = files.map((file) => file.path);
  return {
    sourcePath,
    sourceBytes,
    editorState,
    familyPaths,
    beforeSnapshot: await snapshotFiles(familyPaths),
  };
}

async function snapshotFiles(paths: string[]): Promise<Map<string, FileSnapshot>> {
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

async function openLooseFile(page: Page, absolutePath: string): Promise<void> {
  await page.goto(`/editor?file=${encodeURIComponent(absolutePath)}`, { waitUntil: "networkidle" });
  await expect(page.locator("text=Loading")).toHaveCount(0);
}
