import { expect, test, type Page } from "@playwright/test";
import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, extname, join } from "node:path";
import { tmpdir } from "node:os";

interface ImportFixture {
  sourcePath: string;
  sourceBytes: Buffer;
  incomingBytes: Buffer;
  artifactPaths: string[];
  beforeArtifacts: Map<string, FileSnapshot>;
}

interface FileSnapshot {
  bytes: Buffer;
  mtimeNs: bigint;
}

let workspaceDir: string;
let fixtures: Record<"replace" | "keep" | "skip" | "cancel", ImportFixture>;

test.beforeEach(async () => {
  workspaceDir = await mkdtemp(join(tmpdir(), "doxmind-import-conflict-e2e-"));
  fixtures = {
    replace: await writeImportFixture("Replace.md"),
    keep: await writeImportFixture("Keep.md"),
    skip: await writeImportFixture("Skip.md"),
    cancel: await writeImportFixture("Cancel.md"),
  };
});

test.afterEach(async () => {
  await rm(workspaceDir, { recursive: true, force: true });
});

test("applies Replace / Keep both / Skip while preserving every pre-existing legacy artifact", async ({
  page,
}, testInfo) => {
  const runtimeErrors = observeRuntimeErrors(page);
  await openWorkspace(page);

  await dropFiles(page, [fixtures.replace, fixtures.keep, fixtures.skip]);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const replaceGroup = dialog.getByRole("radiogroup", { name: "Replace.md" });
  const keepGroup = dialog.getByRole("radiogroup", { name: "Keep.md" });
  const skipGroup = dialog.getByRole("radiogroup", { name: "Skip.md" });
  await expect(replaceGroup.getByRole("radio", { name: "Keep both" })).toBeChecked();
  await expect(keepGroup.getByRole("radio", { name: "Keep both" })).toBeChecked();
  await expect(skipGroup.getByRole("radio", { name: "Keep both" })).toBeChecked();

  await replaceGroup.getByRole("radio", { name: "Replace" }).focus();
  await page.keyboard.press("Space");
  await skipGroup.getByRole("radio", { name: "Skip" }).focus();
  await page.keyboard.press("Space");
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(dialog).toHaveCount(0);

  await expect
    .poll(() => readFile(fixtures.replace.sourcePath))
    .toEqual(fixtures.replace.incomingBytes);
  expect(await readFile(fixtures.keep.sourcePath)).toEqual(fixtures.keep.sourceBytes);
  expect(await readFile(fixtures.skip.sourcePath)).toEqual(fixtures.skip.sourceBytes);
  expect(await readFile(join(workspaceDir, "Keep (2).md"))).toEqual(fixtures.keep.incomingBytes);

  for (const fixture of [fixtures.replace, fixtures.keep, fixtures.skip]) {
    expect(await snapshotFiles(fixture.artifactPaths)).toEqual(fixture.beforeArtifacts);
  }
  await expectMissing(join(workspaceDir, ".Keep (2).doxmind"));
  expect(runtimeErrors).toEqual([]);
  await testInfo.attach("import-conflict-decisions", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});

test("Cancel all and Escape close the collision batch without any filesystem write", async ({
  page,
}) => {
  const runtimeErrors = observeRuntimeErrors(page);
  const fixture = fixtures.cancel;
  const beforeSource = await snapshotFiles([fixture.sourcePath]);
  await openWorkspace(page);

  await dropFiles(page, [fixture]);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  expect(await snapshotFiles([fixture.sourcePath])).toEqual(beforeSource);
  expect(await snapshotFiles(fixture.artifactPaths)).toEqual(fixture.beforeArtifacts);
  await expectMissing(join(workspaceDir, "Cancel (2).md"));
  expect(runtimeErrors).toEqual([]);
});

async function writeImportFixture(name: string): Promise<ImportFixture> {
  const sourcePath = join(workspaceDir, name);
  const sourceBytes = Buffer.from(`# ${name} original\n`, "utf8");
  const incomingBytes = Buffer.from(`# ${name} incoming\n`, "utf8");
  const stem = basename(name, extname(name));
  const sidecarPath = join(workspaceDir, `.${stem}.doxmind`);
  const artifacts = [
    { path: sidecarPath, bytes: Buffer.from(`{"source":"${name}","legacy":true}\n`) },
    { path: `${sidecarPath}.bak`, bytes: Buffer.from(`backup:${name}\n`) },
    { path: `${sidecarPath}.lock`, bytes: Buffer.from([0, 255, name.length]) },
    { path: `${sidecarPath}.corrupt-2026-a`, bytes: Buffer.from(`corrupt-a:${name}\n`) },
    { path: `${sidecarPath}.corrupt-2026-b`, bytes: Buffer.from(`corrupt-b:${name}\n`) },
  ];
  await writeFile(sourcePath, sourceBytes);
  await Promise.all(artifacts.map((artifact) => writeFile(artifact.path, artifact.bytes)));
  const artifactPaths = artifacts.map((artifact) => artifact.path);
  return {
    sourcePath,
    sourceBytes,
    incomingBytes,
    artifactPaths,
    beforeArtifacts: await snapshotFiles(artifactPaths),
  };
}

async function dropFiles(page: Page, fixturesToDrop: ImportFixture[]): Promise<void> {
  const dataTransfer = await page.evaluateHandle(
    (payloads) => {
      const transfer = new DataTransfer();
      for (const payload of payloads) {
        const binary = window.atob(payload.base64);
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        transfer.items.add(new File([bytes], payload.name, { type: "text/markdown" }));
      }
      return transfer;
    },
    fixturesToDrop.map((fixture) => ({
      name: basename(fixture.sourcePath),
      base64: fixture.incomingBytes.toString("base64"),
    }))
  );
  const target = page.getByTestId("folder-tree-drop-root");
  await expect(target).toBeVisible();
  await target.dispatchEvent("dragover", { dataTransfer });
  await target.dispatchEvent("drop", { dataTransfer });
  await dataTransfer.dispose();
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

async function expectMissing(path: string): Promise<void> {
  await expect(access(path, constants.F_OK)).rejects.toThrow();
}

function observeRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function openWorkspace(page: Page): Promise<void> {
  await page.goto(`/editor?folder=${encodeURIComponent(workspaceDir)}`, {
    waitUntil: "networkidle",
  });
  await expect(page.locator("text=Loading")).toHaveCount(0);
  await expect(page.getByTestId("folder-tree-drop-root")).toBeVisible();
}
