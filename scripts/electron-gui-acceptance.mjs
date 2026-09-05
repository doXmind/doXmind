#!/usr/bin/env node

/**
 * Packaged Electron GUI acceptance test.
 *
 * This launches the built application (not the development Electron binary)
 * with isolated user data and a temporary workspace. Pass a non-standard
 * executable with `--app /absolute/path/to/executable`.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { _electron as electron } from "@playwright/test";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT_DIR = path.join(REPO_ROOT, "test-results", "electron-gui-acceptance");
const execFileAsync = promisify(execFile);
const PAGE_NAME = "Acceptance.md";
const COLLECTION_NAME = "Collection Matrix.md";
const BLOCK_EDITOR_PAGE_NAME = "Beacon FDE.md";
const PAGE_SOURCE = [
  "# Electron GUI Acceptance",
  "",
  "First block.",
  "",
  "Second block.",
  "",
  "Drop target.",
  "",
].join("\n");
const BLOCK_EDITOR_SUBTREE_SOURCE = [
  "- Markdown is the only source of truth",
  "  - Blocks remain portable",
  "    - Nested ideas move with their parent",
  "",
].join("\n");
const BLOCK_EDITOR_SUBTREE_BODY = BLOCK_EDITOR_SUBTREE_SOURCE.trimEnd();
const BLOCK_EDITOR_PAGE_SOURCE = [
  "# Beacon FDE — Q&A",
  "",
  "---",
  "",
  "## 自我介绍",
  "",
  "**90 秒**",
  "",
  "I'm Wangzhang (Steve) Wu. I graduated from the **University of Toronto** with *High Distinction* and now build `Markdown` tools for a [local-first workspace](https://example.com/local) without ~~cloud sidecars~~.",
  "",
  BLOCK_EDITOR_SUBTREE_BODY,
  "- Independent sibling",
  "",
].join("\n");
const COLLECTION_SOURCE = [
  "# Packaged Collection Matrix",
  "",
  "![[Target#^stable-block]]",
  "",
  "```doxmind-collection",
  JSON.stringify({
    version: 2,
    view: "table",
    filters: [{ property: "type", operator: "equals", value: "task" }],
    columns: ["status", "project", "score", "budgetTotal"],
    sort: [{ property: "due", direction: "asc" }],
    computed: {
      version: 1,
      properties: {
        project: { type: "relation" },
        score: {
          type: "formula",
          expression: {
            type: "arithmetic",
            operator: "*",
            left: { type: "property", name: "estimate" },
            right: { type: "literal", value: 2 },
          },
        },
        budgetTotal: {
          type: "rollup",
          relation: "project",
          property: "budget",
          calculate: "sum",
        },
      },
    },
  }),
  "```",
  "",
  "```doxmind-collection",
  JSON.stringify({
    version: 2,
    view: "board",
    groupBy: "status",
    filters: [{ property: "type", operator: "equals", value: "task" }],
    columns: ["due", "project"],
    sort: [],
    computed: { version: 1, properties: { project: { type: "relation" } } },
  }),
  "```",
  "",
  "```doxmind-collection",
  JSON.stringify({
    version: 2,
    view: "calendar",
    dateBy: "due",
    filters: [{ property: "type", operator: "equals", value: "task" }],
    columns: ["status"],
    sort: [],
  }),
  "```",
  "",
].join("\n");
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

const options = parseArguments(process.argv.slice(2));
const executablePath = options.app ?? findPackagedExecutable();
const runRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "doxmind-electron-gui-"));
const workspacePath = path.join(runRoot, "workspace");
const userDataPath = path.join(runRoot, "user-data");
const pagePath = path.join(workspacePath, PAGE_NAME);
const collectionPath = path.join(workspacePath, COLLECTION_NAME);
const blockEditorPagePath = path.join(workspacePath, BLOCK_EDITOR_PAGE_NAME);
const attachmentPath = path.join(workspacePath, "Reference.pdf");
const exportedPdfPath = path.join(runRoot, "Electron GUI Acceptance.pdf");
const cancelledPdfPath = path.join(runRoot, "Cancelled Electron GUI Acceptance.pdf");
const sidecarPath = path.join(workspacePath, ".Acceptance.doxmind");
const lockPath = `${sidecarPath}.lock`;
const sidecarBytes = Buffer.from('{"html":"legacy state"}\n', "utf8");
const lockBytes = Buffer.from([0, 255, 1, 2]);
const modifier = process.platform === "darwin" ? "Meta" : "Control";
const pageErrors = [];
const consoleErrors = [];
const passed = [];
let pdfExportEvidence = null;
let electronApp;
let page;

try {
  await fsp.mkdir(workspacePath, { recursive: true });
  await fsp.mkdir(userDataPath, { recursive: true });
  await fsp.writeFile(pagePath, PAGE_SOURCE, "utf8");
  await Promise.all([
    fsp.writeFile(collectionPath, COLLECTION_SOURCE, "utf8"),
    fsp.writeFile(blockEditorPagePath, BLOCK_EDITOR_PAGE_SOURCE, "utf8"),
    fsp.writeFile(
      path.join(workspacePath, "Resolved task.md"),
      pageFixture(
        {
          id: "task-resolved",
          title: "Resolved task",
          type: "task",
          status: "doing",
          due: "2026-07-30",
          estimate: 3,
          project: "[[Roadmap]]",
        },
        "# Resolved task body\n"
      ),
      "utf8"
    ),
    fsp.writeFile(
      path.join(workspacePath, "Broken task.md"),
      pageFixture(
        {
          id: "task-broken",
          title: "Broken task",
          type: "task",
          estimate: 2,
          project: "[[Missing]]",
        },
        "# Broken task body\n"
      ),
      "utf8"
    ),
    fsp.writeFile(
      path.join(workspacePath, "Roadmap.md"),
      pageFixture(
        { id: "roadmap", title: "Roadmap", type: "plan", budget: 50 },
        "# Roadmap plan\n\nPortable plan body.\n"
      ),
      "utf8"
    ),
    fsp.writeFile(
      path.join(workspacePath, "Target.md"),
      pageFixture(
        { id: "target", title: "Target" },
        "# Target Page\n\nAnchored exact body. ^stable-block\n"
      ),
      "utf8"
    ),
  ]);
  await fsp.writeFile(attachmentPath, "%PDF-1.4\n%%EOF\n", "utf8");
  await fsp.writeFile(sidecarPath, sidecarBytes);
  await fsp.writeFile(lockPath, lockBytes);

  electronApp = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userDataPath}`, pagePath],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
    timeout: 30_000,
  });
  page = await electronApp.firstWindow({ timeout: 30_000 });
  page.setDefaultTimeout(10_000);
  page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.waitForLoadState("domcontentloaded");
  await page.getByTestId("markdown-block-runtime").waitFor({ state: "visible" });

  await check("uses the packaged app and isolated user-data directory", async () => {
    assert.ok(path.isAbsolute(executablePath));
    if (!options.app) assert.ok(executablePath.includes("dist-electron"), executablePath);
    const actualUserData = await electronApp.evaluate(({ app }) => app.getPath("userData"));
    assert.equal(await fsp.realpath(actualUserData), await fsp.realpath(userDataPath));
  });

  await check("enforces sandboxed renderer preferences", async () => {
    const preferences = await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return window?.webContents.getLastWebPreferences();
    });
    assert.equal(preferences?.sandbox, true);
    assert.equal(preferences?.contextIsolation, true);
    assert.equal(preferences?.nodeIntegration, false);
  });

  await check("exposes only the narrow preload bridge and performs real IPC", async () => {
    const rendererBoundary = await page.evaluate(() => ({
      bridge: typeof window.__DOXMIND_DESKTOP__,
      invoke: typeof window.__DOXMIND_DESKTOP__?.invoke,
      listen: typeof window.__DOXMIND_DESKTOP__?.listen,
      platform: window.__DOXMIND_DESKTOP__?.platform,
      process: typeof window.process,
      require: typeof window.require,
    }));
    assert.deepEqual(rendererBoundary, {
      bridge: "object",
      invoke: "function",
      listen: "function",
      platform:
        process.platform === "darwin"
          ? "macos"
          : process.platform === "win32"
            ? "windows"
            : "linux",
      process: "undefined",
      require: "undefined",
    });

    const result = await page.evaluate(
      async ({ root, pageName }) => {
        const bridge = window.__DOXMIND_DESKTOP__;
        const target = await bridge.invoke("current_window_open_target");
        const scan = await bridge.invoke("workspace_scan", { root });
        const read = await bridge.invoke("doc_read", { root, path: pageName });
        return { target, documents: scan.documents.map((document) => document.path), read };
      },
      { root: workspacePath, pageName: PAGE_NAME }
    );
    assert.deepEqual(result.target, { kind: "file", path: pagePath });
    assert.ok(result.documents.includes(PAGE_NAME));
    assert.ok(result.documents.includes("Reference.pdf"));
    assert.equal(result.read.markdown, PAGE_SOURCE);
    assert.match(result.read.revision, /^sha256:/);
  });

  await check("opens the Page in the native Block editor", async () => {
    await page.getByText("Electron GUI Acceptance", { exact: true }).waitFor();
    assert.equal(await page.locator("[data-native-block-row]").count(), 4);
    assert.match(page.url(), /\/editor\//);
  });

  await check("drives native Edit and View menu actions into the focused window", async () => {
    await clickApplicationMenu("Edit", "Find in Document…");
    await page.getByLabel("Search text").waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Close search" }).click();

    await clickApplicationMenu("Edit", "Command Palette…");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.waitFor({ state: "visible" });
    await palette.getByRole("button", { name: "Close" }).click();

    await page.getByRole("button", { name: "Hide files" }).waitFor({ state: "visible" });
    await clickApplicationMenu("View", "Toggle Sidebar");
    await page.getByRole("button", { name: "Show files" }).waitFor({ state: "visible" });
    await clickApplicationMenu("View", "Toggle Sidebar");
    await page.getByRole("button", { name: "Hide files" }).waitFor({ state: "visible" });

    await clickApplicationMenu("View", "Toggle Focus Mode");
    const exitFocus = page.getByRole("button", { name: "Exit focus mode" });
    await exitFocus.waitFor({ state: "visible" });
    await saveArtifactScreenshot("focus-mode.png");
    await exitFocus.click();
    await page.getByRole("button", { name: "More actions" }).waitFor({ state: "visible" });
  });

  await check("deduplicates the current target and opens one native new window", async () => {
    const initialWindowCount = electronApp.windows().length;
    await page.evaluate(
      async (target) => window.__DOXMIND_DESKTOP__.invoke("open_window_for_target", { target }),
      { kind: "file", path: pagePath }
    );
    await waitForWindowCount(initialWindowCount);

    const newWindowPromise = electronApp.waitForEvent("window");
    await clickApplicationMenu("File", "New Window");
    const newWindow = await newWindowPromise;
    await newWindow.waitForLoadState("domcontentloaded");
    await waitForWindowCount(initialWindowCount + 1);
    await fsp.mkdir(ARTIFACT_DIR, { recursive: true });
    await newWindow.screenshot({ path: path.join(ARTIFACT_DIR, "new-window.png"), fullPage: true });
    await newWindow.close();
    await waitForWindowCount(initialWindowCount);
  });

  await check("duplicates a Block from the keyboard and undoes it in one step", async () => {
    let editor = await activateBlock("First block.");
    await editor.press(`${modifier}+Shift+D`);
    assert.equal(await page.locator("[data-native-block-row]").count(), 5);
    await saveAndWait((source) => occurrences(source, "First block.") === 2);

    editor = page.locator("[data-native-block-editor]");
    await editor.press(`${modifier}+z`);
    assert.equal(await page.locator("[data-native-block-row]").count(), 4);
    await saveAndWait((source) => occurrences(source, "First block.") === 1);
  });

  await check("moves a Block from the keyboard and restores order with undo", async () => {
    let editor = await activateBlock("First block.");
    await editor.press("Alt+ArrowDown");
    await saveAndWait((source) => source.indexOf("Second block.") < source.indexOf("First block."));

    editor = page.locator("[data-native-block-editor]");
    await editor.press(`${modifier}+z`);
    await saveAndWait((source) => source.indexOf("First block.") < source.indexOf("Second block."));
  });

  await check("deletes a Block from the keyboard and restores it with undo", async () => {
    let editor = await activateBlock("First block.");
    await editor.press(`${modifier}+Shift+Backspace`);
    await saveAndWait((source) => !source.includes("First block."));

    editor = page.locator("[data-native-block-editor]");
    await editor.press(`${modifier}+z`);
    await saveAndWait((source) => source.includes("First block."));
  });

  await check("autosaves an edit and shows it after reopening the Page", async () => {
    const editor = await activateBlock("First block.");
    await editor.press("End");
    await editor.type(" autosaved");
    await waitForPageSource((source) => source.includes("First block. autosaved"));

    await openFileInRenderer(attachmentPath);
    await page.getByRole("button", { name: "Open externally" }).waitFor();
    await openFileInRenderer(pagePath);
    await page.getByTestId("markdown-block-runtime").waitFor({ state: "visible" });
    await page.getByText("First block. autosaved", { exact: true }).waitFor();
  });

  await check(
    "projects Collections, computed fields, and block embeds through packaged IPC",
    async () => {
      await openFileInRenderer(collectionPath);
      const table = page.getByRole("table", { name: "Page collection table" });
      await table.waitFor({ state: "visible" });
      const resolvedRow = table.getByRole("row").filter({
        has: page.getByRole("button", { name: "Resolved task", exact: true }),
      });
      assert.match(await resolvedRow.innerText(), /Roadmap/);
      assert.match(await resolvedRow.innerText(), /6/);
      assert.match(await resolvedRow.innerText(), /50/);

      const diagnostics = page
        .locator("[data-native-block-row]")
        .filter({ has: table })
        .getByRole("alert", { name: "Collection diagnostics" });
      assert.match(
        await diagnostics.innerText(),
        /Relation project cannot resolve \[\[Missing\]\]\./
      );
      assert.doesNotMatch(
        await diagnostics.innerText(),
        /Page Roadmap\.md has no source property estimate\./
      );

      await page.getByRole("region", { name: "Page collection board" }).waitFor();
      await page.getByRole("region", { name: "Page collection calendar" }).waitFor();
      const embed = page.locator("[data-wiki-embed]").filter({
        has: page.locator("code", { hasText: "![[Target#^stable-block]]" }),
      });
      await embed.getByText("Anchored exact body.", { exact: true }).waitFor();
      await saveArtifactScreenshot("collections-and-embed.png");

      await resolvedRow.getByRole("button", { name: "Roadmap", exact: true }).click();
      await page.getByRole("heading", { name: "Roadmap plan" }).waitFor();
      await openFileInRenderer(pagePath);
      await page.getByTestId("markdown-block-runtime").waitFor({ state: "visible" });
    }
  );

  await check("imports a pasted image into assets and inserts portable Markdown", async () => {
    const editor = await activateBlock("Second block.");
    await editor.press("End");
    const paste = await dispatchImageEvent(editor, "paste", "pasted image.png");
    assert.equal(paste.files, 1);
    assert.equal(paste.defaultPrevented, true);

    await waitForPageSource(
      (source) => source.includes("![pasted image](assets/pasted%20image.png)"),
      15_000
    );
    assert.deepEqual(
      await fsp.readFile(path.join(workspacePath, "assets", "pasted image.png")),
      PNG_BYTES
    );
    await activateBlock("Drop target.");
    await page.locator('[data-testid="local-image-block"]').first().waitFor({ state: "visible" });
  });

  await check("imports a dropped image through the same safe asset boundary", async () => {
    const row = page.locator("[data-native-block-row]").filter({ hasText: "Drop target." });
    assert.equal(await row.count(), 1);
    const dragover = await dispatchImageEvent(row, "dragover", "dropped.png");
    assert.equal(dragover.defaultPrevented, true);
    const drop = await dispatchImageEvent(row, "drop", "dropped.png");
    assert.equal(drop.files, 1);
    assert.equal(drop.defaultPrevented, true);

    await waitForPageSource((source) => source.includes("![dropped](assets/dropped.png)"), 15_000);
    assert.deepEqual(
      await fsp.readFile(path.join(workspacePath, "assets", "dropped.png")),
      PNG_BYTES
    );
    await activateBlock("First block. autosaved");
    assert.equal(await page.locator('[data-testid="local-image-block"]').count(), 2);
  });

  await check(
    "exports the live Markdown Page to a real local PDF without printer services",
    async () => {
      const pageBytesBefore = await fsp.readFile(pagePath);
      const sidecarBytesBefore = await fsp.readFile(sidecarPath);
      const lockBytesBefore = await fsp.readFile(lockPath);
      const workspaceFilesBefore = await listRelativeFiles(workspacePath);
      await fsp.rm(exportedPdfPath, { force: true });
      await fsp.mkdir(ARTIFACT_DIR, { recursive: true });
      const pdfArtifactPath = path.join(ARTIFACT_DIR, "page-export.pdf");
      const previewArtifactPath = path.join(ARTIFACT_DIR, "page-export-first-page.png");
      await Promise.all([
        fsp.rm(pdfArtifactPath, { force: true }),
        fsp.rm(previewArtifactPath, { force: true }),
      ]);

      await stubSaveDialog({ canceled: false, filePath: exportedPdfPath });
      await page.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "Export as PDF" }).click();
      const saveCalls = await waitForSaveDialogCalls(1);
      assert.equal(saveCalls[0].options.title, "Export Page as PDF");
      assert.match(saveCalls[0].options.defaultPath, /Acceptance\.pdf$/);
      assert.deepEqual(saveCalls[0].options.filters, [
        { name: "PDF Document", extensions: ["pdf"] },
      ]);
      assert.equal(typeof saveCalls[0].ownerWindowId, "number");
      await waitForFile(exportedPdfPath, 30_000);

      const pdfBytes = await fsp.readFile(exportedPdfPath);
      assert.equal(pdfBytes.subarray(0, 5).toString("latin1"), "%PDF-");
      assert.ok(pdfBytes.subarray(-2048).includes(Buffer.from("%%EOF")), "PDF has no EOF marker");
      assert.ok(pdfBytes.length > 1_000, `generated PDF is unexpectedly small: ${pdfBytes.length}`);

      const [{ stdout: pdfInfo }, { stdout: extractedText }] = await Promise.all([
        execFileAsync("pdfinfo", [exportedPdfPath], { maxBuffer: 4 * 1024 * 1024 }),
        execFileAsync("pdftotext", ["-layout", exportedPdfPath, "-"], {
          maxBuffer: 16 * 1024 * 1024,
        }),
      ]);
      const pagesMatch = pdfInfo.match(/^Pages:\s+(\d+)\s*$/m);
      assert.ok(pagesMatch, `pdfinfo did not report a page count:\n${pdfInfo}`);
      const pages = Number.parseInt(pagesMatch[1], 10);
      assert.ok(pages >= 1, `expected at least one PDF page, received ${pages}`);

      const normalizedText = extractedText.replace(/\s+/g, " ").trim();
      assert.match(normalizedText, /Electron GUI Acceptance/);
      assert.match(normalizedText, /First block\. autosaved/);
      const excludedChrome = [
        "Collection Matrix",
        "Reference.pdf",
        "More actions",
        "Hide files",
      ];
      for (const text of excludedChrome) {
        assert.equal(normalizedText.includes(text), false, `PDF leaked app chrome text: ${text}`);
      }

      assert.deepEqual(await fsp.readFile(pagePath), pageBytesBefore);
      assert.deepEqual(await fsp.readFile(sidecarPath), sidecarBytesBefore);
      assert.deepEqual(await fsp.readFile(lockPath), lockBytesBefore);
      assert.deepEqual(await listRelativeFiles(workspacePath), workspaceFilesBefore);

      await fsp.copyFile(exportedPdfPath, pdfArtifactPath);
      const firstPage = await renderFirstPdfPage(exportedPdfPath, previewArtifactPath);
      pdfExportEvidence = {
        artifact: path.basename(pdfArtifactPath),
        bytes: pdfBytes.length,
        pages,
        header: "%PDF-",
        eof: true,
        text: {
          title: "Electron GUI Acceptance",
          body: "First block. autosaved",
          excludedChrome,
        },
        firstPagePng: firstPage,
        sourceBytesUnchanged: true,
        legacyArtifactBytesUnchanged: true,
        workspaceFilesUnchanged: true,
        cancelledExport: null,
      };
    }
  );

  await check("cancels local Page PDF export with zero writes", async () => {
    const pageBytesBefore = await fsp.readFile(pagePath);
    const sidecarBytesBefore = await fsp.readFile(sidecarPath);
    const lockBytesBefore = await fsp.readFile(lockPath);
    const workspaceFilesBefore = await listRelativeFiles(workspacePath);
    await fsp.rm(cancelledPdfPath, { force: true });

    await stubSaveDialog({ canceled: true, filePath: cancelledPdfPath });
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Export as PDF" }).click();
    await waitForSaveDialogCalls(1);
    await page.waitForTimeout(100);

    assert.equal(await pathExists(cancelledPdfPath), false);
    assert.deepEqual(await fsp.readFile(pagePath), pageBytesBefore);
    assert.deepEqual(await fsp.readFile(sidecarPath), sidecarBytesBefore);
    assert.deepEqual(await fsp.readFile(lockPath), lockBytesBefore);
    assert.deepEqual(await listRelativeFiles(workspacePath), workspaceFilesBefore);
    assert.ok(pdfExportEvidence);
    pdfExportEvidence.cancelledExport = {
      outputWritten: false,
      sourceBytesUnchanged: true,
      legacyArtifactBytesUnchanged: true,
      workspaceFilesUnchanged: true,
    };
  });

  await check("shows attachments as read-only with safe external and reveal actions", async () => {
    await electronApp.evaluate(({ shell }) => {
      globalThis.__DOXMIND_GUI_SHELL_CALLS__ = [];
      shell.openPath = async (target) => {
        globalThis.__DOXMIND_GUI_SHELL_CALLS__.push({ action: "open", target });
        return "";
      };
      shell.showItemInFolder = (target) => {
        globalThis.__DOXMIND_GUI_SHELL_CALLS__.push({ action: "reveal", target });
      };
    });
    await openFileInRenderer(attachmentPath);
    await page.getByText("PDF attachment", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Open externally" }).click();
    await page.getByRole("button", { name: "Reveal in Finder" }).click();
    const shellCalls = await waitForShellCalls(2);
    assert.deepEqual(shellCalls, [
      { action: "open", target: attachmentPath },
      { action: "reveal", target: attachmentPath },
    ]);
    await saveArtifactScreenshot("attachment-read-only.png");
  });

  await check(
    "reopens the final Markdown and imported images without a sidecar write",
    async () => {
      await openFileInRenderer(pagePath);
      await page.getByTestId("markdown-block-runtime").waitFor({ state: "visible" });
      await page.getByText("First block. autosaved", { exact: true }).waitFor();
      assert.equal(await page.locator('[data-testid="local-image-block"]').count(), 2);
      const sidecars = (await fsp.readdir(workspacePath)).filter((name) =>
        name.includes("doxmind")
      );
      assert.deepEqual(sidecars.sort(), [".Acceptance.doxmind", ".Acceptance.doxmind.lock"]);
      await saveArtifactScreenshot("final-page.png");
    }
  );

  await check(
    "opens local Settings from the native menu and applies light and dark themes",
    async () => {
      await clickApplicationMenu("doXmind", "Settings…");
      await page.getByPlaceholder("Search settings").waitFor({ state: "visible" });

      await page.getByRole("button", { name: "Light", exact: true }).click();
      await waitForThemeMode("light");
      await saveArtifactScreenshot("settings-light.png");

      await page.getByRole("button", { name: "Dark", exact: true }).click();
      await waitForThemeMode("dark");
      await saveArtifactScreenshot("settings-dark.png");

      await page.getByRole("link", { name: "Back to app" }).click();
      await page.getByTestId("markdown-block-runtime").waitFor({ state: "visible" });
    }
  );

  await check("matches the polished source-backed Block editor interaction gate", async () => {
    await openFileInRenderer(blockEditorPagePath);
    await page.getByTestId("markdown-block-runtime").waitFor({ state: "visible" });
    await page.getByRole("heading", { name: "Beacon FDE — Q&A" }).waitFor();
    const initialBlockCount = await page.locator("[data-native-block-row]").count();
    assert.equal(initialBlockCount, 9);
    assert.equal(
      await page.evaluate(() => document.documentElement.classList.contains("dark")),
      true,
      "the Block editor evidence must be captured in dark mode"
    );

    const nestedParentRow = page
      .locator("[data-native-block-row]")
      .filter({ hasText: "Markdown is the only source of truth" });
    assert.equal(await nestedParentRow.count(), 1);
    await nestedParentRow
      .getByText("Markdown is the only source of truth", { exact: true })
      .click();
    const nestedParentEditor = nestedParentRow.locator("[data-native-block-editor]");
    await nestedParentEditor.waitFor({ state: "visible" });
    await nestedParentEditor.press("Escape");
    await page.waitForFunction(
      () =>
        document.activeElement?.matches('[data-native-block-row][data-block-selected="true"]') ??
        false
    );

    let selectedRows = page.locator('[data-native-block-row][data-block-selected="true"]');
    assert.equal(await selectedRows.count(), 3);
    assert.deepEqual(
      await selectedRows.evaluateAll((rows) => rows.map((row) => row.dataset.blockDepth)),
      ["0", "1", "2"]
    );

    await page.keyboard.press(`${modifier}+Shift+D`);
    const duplicatedSource = BLOCK_EDITOR_PAGE_SOURCE.replace(
      BLOCK_EDITOR_SUBTREE_BODY,
      `${BLOCK_EDITOR_SUBTREE_BODY}\n${BLOCK_EDITOR_SUBTREE_BODY}`
    );
    await page.keyboard.press(`${modifier}+s`);
    await waitForFileSource(blockEditorPagePath, (source) => source === duplicatedSource);
    assert.equal(await page.locator("[data-native-block-row]").count(), initialBlockCount + 3);
    selectedRows = page.locator('[data-native-block-row][data-block-selected="true"]');
    assert.equal(await selectedRows.count(), 3);
    assert.deepEqual(
      await selectedRows.evaluateAll((rows) => rows.map((row) => row.dataset.blockDepth)),
      ["0", "1", "2"]
    );

    await page.keyboard.press(`${modifier}+z`);
    await page.keyboard.press(`${modifier}+s`);
    await waitForFileSource(blockEditorPagePath, (source) => source === BLOCK_EDITOR_PAGE_SOURCE);
    assert.equal(await fsp.readFile(blockEditorPagePath, "utf8"), BLOCK_EDITOR_PAGE_SOURCE);
    assert.equal(await page.locator("[data-native-block-row]").count(), initialBlockCount);

    const formattedRow = page
      .locator("[data-native-block-row]")
      .filter({ hasText: "University of Toronto" });
    assert.equal(await formattedRow.count(), 1);
    await formattedRow.getByText("University of Toronto", { exact: true }).click();
    let semanticEditor = formattedRow.locator("[data-native-semantic-editor]");
    await semanticEditor.waitFor({ state: "visible" });
    const editorFocusChrome = await semanticEditor.evaluate((editor) => {
      const style = getComputedStyle(editor);
      return { outlineStyle: style.outlineStyle, boxShadow: style.boxShadow };
    });
    assert.equal(editorFocusChrome.outlineStyle, "none");
    assert.equal(editorFocusChrome.boxShadow, "none");
    const semanticText = await semanticEditor.innerText();
    assert.match(semanticText, /University of Toronto/);
    for (const delimiter of ["**", "*High Distinction*", "`Markdown`", "~~", "]("]) {
      assert.equal(
        semanticText.includes(delimiter),
        false,
        `active semantic editor leaked Markdown delimiter: ${delimiter}`
      );
    }
    assert.equal(
      await semanticEditor.locator("strong", { hasText: "University of Toronto" }).count(),
      1
    );
    assert.equal(await semanticEditor.locator("em", { hasText: "High Distinction" }).count(), 1);
    assert.equal(await semanticEditor.locator("code", { hasText: "Markdown" }).count(), 1);
    assert.equal(
      await semanticEditor
        .locator('a[href="https://example.com/local"]', { hasText: "local-first workspace" })
        .count(),
      1
    );
    assert.equal(await semanticEditor.locator("del", { hasText: "cloud sidecars" }).count(), 1);

    const selectedStrong = semanticEditor.locator("strong", {
      hasText: "University of Toronto",
    });
    await selectedStrong.selectText();
    await semanticEditor.dispatchEvent("mouseup");
    let floatingToolbar = page.getByRole("toolbar", { name: "Text formatting" });
    await floatingToolbar.waitFor({ state: "visible" });
    assert.equal(
      await floatingToolbar.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed"),
      "true"
    );

    let typeButton = floatingToolbar.getByRole("button", {
      name: "Change block type: Text",
    });
    await typeButton.focus();
    await typeButton.press("Enter");
    let typeMenu = page.getByRole("menu", { name: "Inline block types" });
    await typeMenu.waitFor({ state: "visible" });
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute("role")),
      "menuitem"
    );
    await page.keyboard.press("Escape");
    await typeMenu.waitFor({ state: "hidden" });

    await selectedStrong.selectText();
    await semanticEditor.dispatchEvent("mouseup");
    floatingToolbar = page.getByRole("toolbar", { name: "Text formatting" });
    await floatingToolbar.waitFor({ state: "visible" });
    typeButton = floatingToolbar.getByRole("button", {
      name: "Change block type: Text",
    });
    await typeButton.click();
    typeMenu = page.getByRole("menu", { name: "Inline block types" });
    await typeMenu.waitFor({ state: "visible" });
    await typeMenu.getByRole("menuitem", { name: "Heading 2" }).waitFor({
      state: "visible",
    });
    await page.keyboard.press("Escape");
    await typeMenu.waitFor({ state: "hidden" });

    await formattedRow.hover();
    const gutterControls = formattedRow.locator("[data-native-block-controls]");
    await waitForHoverControls(gutterControls);
    await gutterControls.getByRole("button", { name: "Insert block" }).waitFor({
      state: "visible",
    });
    const blockActions = gutterControls.getByRole("button", { name: "Block actions" });
    await blockActions.waitFor({ state: "visible" });

    await blockActions.focus();
    await blockActions.press("Enter");
    let blockMenu = page.getByRole("menu", { name: "Block actions menu" });
    await blockMenu.waitFor({ state: "visible" });
    assert.equal(
      await blockMenu.getByRole("menuitem", { name: "Heading 3" }).count(),
      0,
      "the default six-dot menu must stay compact"
    );
    const turnInto = blockMenu.getByRole("menuitem", { name: "Turn into" });
    await turnInto.waitFor({ state: "visible" });
    await turnInto.focus();
    await turnInto.press("Enter");
    const turnIntoMenu = page.getByRole("menu", { name: "Turn into", exact: true });
    await turnIntoMenu.getByRole("menuitem", { name: "Heading 3" }).waitFor({
      state: "visible",
    });
    await page.keyboard.press("Escape");
    await turnIntoMenu.waitFor({ state: "hidden" });
    await blockMenu.waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await blockMenu.waitFor({ state: "hidden" });

    await formattedRow.hover();
    await blockActions.click();
    blockMenu = page.getByRole("menu", { name: "Block actions menu" });
    await blockMenu.waitFor({ state: "visible" });
    const blockSearch = blockMenu.getByRole("searchbox", {
      name: "Search block actions",
    });
    await blockSearch.fill("heading 3");
    await blockMenu.getByRole("menuitem", { name: "Heading 3" }).waitFor({
      state: "visible",
    });
    await page.keyboard.press("Escape");
    await blockMenu.waitFor({ state: "hidden" });

    await clickApplicationMenu("View", "Toggle Focus Mode");
    const exitFocus = page.getByRole("button", { name: "Exit focus mode" });
    await exitFocus.waitFor({ state: "visible" });
    await formattedRow.getByText("University of Toronto", { exact: true }).click();
    semanticEditor = formattedRow.locator("[data-native-semantic-editor]");
    await semanticEditor.waitFor({ state: "visible" });
    await semanticEditor.locator("strong", { hasText: "University of Toronto" }).selectText();
    await semanticEditor.dispatchEvent("mouseup");
    const evidenceToolbar = page.getByRole("toolbar", { name: "Text formatting" });
    await evidenceToolbar.waitFor({
      state: "visible",
    });
    await formattedRow.hover();
    await waitForHoverControls(formattedRow.locator("[data-native-block-controls]"));
    assert.equal(await formattedRow.getAttribute("data-block-selected"), null);
    await waitForTransparentBackground(formattedRow);
    const evidenceRowBackground = await formattedRow.evaluate(
      (row) => getComputedStyle(row).backgroundColor
    );
    assert.equal(evidenceRowBackground, "rgba(0, 0, 0, 0)");
    const [evidenceToolbarBox, selectedTextBox] = await Promise.all([
      evidenceToolbar.boundingBox(),
      semanticEditor.locator("strong", { hasText: "University of Toronto" }).boundingBox(),
    ]);
    const toolbarGeometry = await evidenceToolbar.evaluate((toolbar) => {
      const style = getComputedStyle(toolbar);
      const selection = window.getSelection();
      const range =
        selection?.rangeCount === 1 ? selection.getRangeAt(0).getBoundingClientRect() : null;
      return {
        inlineStyle: toolbar.getAttribute("style"),
        computedTop: style.top,
        computedTransform: style.transform,
        range: range ? { x: range.x, y: range.y, width: range.width, height: range.height } : null,
      };
    });
    assert.ok(evidenceToolbarBox, "floating toolbar bounding box is missing");
    assert.ok(selectedTextBox, "selected text bounding box is missing");
    assert.ok(
      evidenceToolbarBox.y + evidenceToolbarBox.height + 4 <= selectedTextBox.y,
      `floating toolbar overlaps selected text: ${JSON.stringify({
        toolbar: evidenceToolbarBox,
        selection: selectedTextBox,
        geometry: toolbarGeometry,
      })}`
    );
    await fsp.mkdir(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, "block-editor-parity.png"),
      fullPage: false,
    });
    await exitFocus.click();

    await openFileInRenderer(pagePath);
    await page.getByTestId("markdown-block-runtime").waitFor({ state: "visible" });
    await page.getByText("First block. autosaved", { exact: true }).waitFor();
  });

  await check("recovers a window that never reaches its first paint", async () => {
    const initialWindowCount = electronApp.windows().length;
    await electronApp.evaluate(({ app }) => {
      globalThis.__DOXMIND_GUI_STARTUP_FAILURE__ = { ids: [], fired: 0 };
      app.once("browser-window-created", (_event, win) => {
        globalThis.__DOXMIND_GUI_STARTUP_FAILURE__.ids.push(win.webContents.id);
        const originalEmit = win.emit;
        win.emit = function (eventName, ...args) {
          if (eventName === "ready-to-show") return false;
          return originalEmit.call(this, eventName, ...args);
        };
        win.loadURL = () => {
          globalThis.__DOXMIND_GUI_STARTUP_FAILURE__.fired += 1;
          return new Promise(() => undefined);
        };
      });
    });

    let recoveredWindow;
    try {
      recoveredWindow = await waitForNewInteractiveWindow(
        () => page.evaluate(() => window.__DOXMIND_DESKTOP__.invoke("open_new_window")),
        (candidate) =>
          candidate.waitForFunction(
            () =>
              typeof window.__DOXMIND_DESKTOP__?.invoke === "function" &&
              Boolean(document.body?.innerText.trim()),
            undefined,
            { timeout: 30_000 }
          )
      );
    } catch (error) {
      const evidence = await electronApp.evaluate(({ BrowserWindow }) => ({
        failure: globalThis.__DOXMIND_GUI_STARTUP_FAILURE__,
        windows: BrowserWindow.getAllWindows().map((win) => ({
          id: win.webContents.id,
          url: win.webContents.getURL(),
          visible: win.isVisible(),
          destroyed: win.isDestroyed(),
          loading: win.webContents.isLoading(),
        })),
      }));
      throw new Error(`${error.message}\n${JSON.stringify(evidence)}`);
    }
    const recoveredControl = recoveredWindow.locator("button:visible").first();
    await recoveredControl.waitFor({ state: "visible" });
    await recoveredControl.focus();
    assert.equal(
      await recoveredControl.evaluate((element) => element === document.activeElement),
      true
    );
    assert.equal(
      await recoveredWindow.evaluate(() =>
        window.__DOXMIND_DESKTOP__.invoke("current_window_open_target")
      ),
      null
    );
    const startupEvidence = await electronApp.evaluate(({ BrowserWindow }) => ({
      failure: globalThis.__DOXMIND_GUI_STARTUP_FAILURE__,
      liveIds: BrowserWindow.getAllWindows().map((win) => win.webContents.id),
    }));
    assert.equal(startupEvidence.failure.fired, 1);
    assert.equal(startupEvidence.failure.ids.length, 1);
    assert.equal(startupEvidence.liveIds.includes(startupEvidence.failure.ids[0]), false);
    await electronApp.evaluate(() => {
      delete globalThis.__DOXMIND_GUI_STARTUP_FAILURE__;
    });
    await waitForWindowCount(initialWindowCount + 1, 30_000);
    await recoveredWindow.close();
    await waitForWindowCount(initialWindowCount);
  });

  await check("shows Retry or Quit when the automatic startup rebuild also dies", async () => {
    const initialWindowCount = electronApp.windows().length;
    await electronApp.evaluate(({ app, dialog }) => {
      globalThis.__DOXMIND_GUI_ORIGINAL_FAILURE_DIALOG__ = dialog.showMessageBox;
      globalThis.__DOXMIND_GUI_FAILURE_DIALOG_CALLS__ = [];
      globalThis.__DOXMIND_GUI_STARTUP_FAILURE__ = { ids: [], fired: 0 };
      dialog.showMessageBox = async (options) => {
        globalThis.__DOXMIND_GUI_FAILURE_DIALOG_CALLS__.push(options);
        return { response: 0, checkboxChecked: false };
      };

      let failuresRemaining = 2;
      const failBeforeFirstPaint = (_event, win) => {
        failuresRemaining -= 1;
        globalThis.__DOXMIND_GUI_STARTUP_FAILURE__.ids.push(win.webContents.id);
        win.loadURL = async () => {
          globalThis.__DOXMIND_GUI_STARTUP_FAILURE__.fired += 1;
          throw new Error("injected startup failure");
        };
        if (failuresRemaining === 0) {
          app.removeListener("browser-window-created", failBeforeFirstPaint);
        }
      };
      globalThis.__DOXMIND_GUI_FAILURE_LISTENER__ = failBeforeFirstPaint;
      app.on("browser-window-created", failBeforeFirstPaint);
    });

    try {
      const recoveredWindow = await waitForNewInteractiveWindow(
        () => page.evaluate(() => window.__DOXMIND_DESKTOP__.invoke("open_new_window")),
        (candidate) =>
          candidate.waitForFunction(
            () =>
              typeof window.__DOXMIND_DESKTOP__?.invoke === "function" &&
              Boolean(document.body?.innerText.trim()),
            undefined,
            { timeout: 30_000 }
          )
      );
      const failureEvidence = await electronApp.evaluate(({ BrowserWindow }) => ({
        startup: globalThis.__DOXMIND_GUI_STARTUP_FAILURE__,
        dialogCalls: globalThis.__DOXMIND_GUI_FAILURE_DIALOG_CALLS__,
        liveIds: BrowserWindow.getAllWindows().map((win) => win.webContents.id),
      }));
      const dialogCalls = failureEvidence.dialogCalls;
      assert.equal(failureEvidence.startup.fired, 2);
      assert.equal(failureEvidence.startup.ids.length, 2);
      for (const failedId of failureEvidence.startup.ids) {
        assert.equal(failureEvidence.liveIds.includes(failedId), false);
      }
      assert.equal(dialogCalls.length, 1);
      assert.deepEqual(dialogCalls[0].buttons, ["Retry", "Quit"]);
      assert.equal(dialogCalls[0].type, "error");
      assert.equal(dialogCalls[0].defaultId, 0);
      assert.equal(dialogCalls[0].cancelId, 1);
      assert.equal(dialogCalls[0].noLink, true);
      assert.match(dialogCalls[0].detail, /Markdown files were not modified/);
      await waitForWindowCount(initialWindowCount + 1, 30_000);
      await recoveredWindow.close();
      await waitForWindowCount(initialWindowCount);
    } finally {
      await electronApp.evaluate(({ app, dialog }) => {
        if (globalThis.__DOXMIND_GUI_FAILURE_LISTENER__) {
          app.removeListener("browser-window-created", globalThis.__DOXMIND_GUI_FAILURE_LISTENER__);
        }
        if (globalThis.__DOXMIND_GUI_ORIGINAL_FAILURE_DIALOG__) {
          dialog.showMessageBox = globalThis.__DOXMIND_GUI_ORIGINAL_FAILURE_DIALOG__;
        }
        delete globalThis.__DOXMIND_GUI_FAILURE_LISTENER__;
        delete globalThis.__DOXMIND_GUI_ORIGINAL_FAILURE_DIALOG__;
        delete globalThis.__DOXMIND_GUI_FAILURE_DIALOG_CALLS__;
        delete globalThis.__DOXMIND_GUI_STARTUP_FAILURE__;
      });
    }
  });

  await check("recovers a force-crashed Renderer into an interactive Page window", async () => {
    const crashedPage = page;
    const expectedWindowCount = electronApp.windows().length;
    assert.equal(expectedWindowCount, 1);
    const crashedWebContentsId = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      if (!win || win.isDestroyed()) throw new Error("no live BrowserWindow to crash");
      return win.webContents.id;
    });
    const replacementPromise = electronApp.waitForEvent("window", { timeout: 30_000 });
    const crashedPromise = crashedPage.waitForEvent("crash", { timeout: 30_000 });

    await electronApp.evaluate(({ BrowserWindow }, id) => {
      const win = BrowserWindow.getAllWindows().find(
        (candidate) => candidate.webContents.id === id
      );
      if (!win) throw new Error(`BrowserWindow ${id} disappeared before crash injection`);
      win.webContents.forcefullyCrashRenderer();
    }, crashedWebContentsId);

    page = await replacementPromise;
    page.setDefaultTimeout(10_000);
    page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await crashedPromise;
    await page.waitForLoadState("domcontentloaded");
    await page.getByTestId("markdown-block-runtime").waitFor({ state: "visible", timeout: 30_000 });
    await page.getByText("First block. autosaved", { exact: true }).click();
    await page.locator("[data-native-block-editor]").waitFor({ state: "visible" });
    const recoveredTarget = await page.evaluate(() =>
      window.__DOXMIND_DESKTOP__.invoke("current_window_open_target")
    );
    assert.deepEqual(recoveredTarget, { kind: "file", path: pagePath });
    await waitForWindowCount(expectedWindowCount, 30_000);
    const recoveredWebContentsId = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      return win?.webContents.id ?? null;
    });
    assert.notEqual(recoveredWebContentsId, crashedWebContentsId);
  });

  assert.deepEqual(pageErrors, [], pageErrors.join("\n"));
  assert.deepEqual(consoleErrors, [], consoleErrors.join("\n"));
  await writeSuccessReport();
  console.log(`\n${passed.length} packaged Electron GUI checks passed.`);
  console.log(`GUI evidence: ${ARTIFACT_DIR}`);
} catch (error) {
  await captureFailure(error);
  throw error;
} finally {
  await electronApp?.close().catch(() => undefined);
  await fsp.rm(runRoot, { recursive: true, force: true });
}

async function check(name, action) {
  await action();
  passed.push(name);
  console.log(`  ✓ ${name}`);
}

async function clickApplicationMenu(parentLabel, itemLabel) {
  await electronApp.evaluate(
    ({ BrowserWindow, Menu }, labels) => {
      const parent = Menu.getApplicationMenu()?.items.find((item) => item.label === labels.parent);
      const item = parent?.submenu?.items.find((candidate) => candidate.label === labels.item);
      const targetWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      if (!item?.click || !targetWindow) {
        throw new Error(`native menu item unavailable: ${labels.parent} > ${labels.item}`);
      }
      item.click(item, targetWindow, {});
    },
    { parent: parentLabel, item: itemLabel }
  );
}

async function waitForWindowCount(expected, timeout = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (electronApp.windows().length === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `timed out waiting for ${expected} Electron window(s); found ${electronApp.windows().length}`
  );
}

async function waitForNewInteractiveWindow(action, ready, timeout = 30_000) {
  let timer;
  let onWindow;
  let candidates = 0;
  const observed = new Promise((resolve, reject) => {
    onWindow = (candidate) => {
      candidates += 1;
      void ready(candidate)
        .then(() => resolve(candidate))
        .catch(() => undefined);
    };
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `timed out waiting for an interactive replacement window; observed ${candidates} candidate(s)`
          )
        ),
      timeout
    );
    electronApp.on("window", onWindow);
  });

  try {
    await action();
    return await observed;
  } finally {
    clearTimeout(timer);
    electronApp.off("window", onWindow);
  }
}

async function waitForThemeMode(expected) {
  await page.waitForFunction((mode) => {
    const cached = localStorage.getItem("doxmind-theme-cache");
    return cached ? JSON.parse(cached).mode === mode : false;
  }, expected);
}

async function activateBlock(text) {
  let editor = page.locator("[data-native-block-editor]");
  const activeText =
    (await editor.count()) === 1
      ? await editor.evaluate((element) =>
          element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
            ? element.value
            : (element.textContent ?? "")
        )
      : null;
  if (activeText === text) {
    await editor.focus();
    await assertFocused(editor);
    return editor;
  }
  await page
    .locator('[data-native-block-row][data-active="false"]')
    .getByText(text, { exact: true })
    .click();
  editor = page.locator("[data-native-block-editor]");
  await editor.waitFor({ state: "visible" });
  await assertFocused(editor);
  return editor;
}

async function assertFocused(locator) {
  assert.equal(await locator.evaluate((element) => element === document.activeElement), true);
}

async function waitForHoverControls(locator) {
  const element = await locator.elementHandle();
  assert.ok(element, "Block gutter controls are missing");
  try {
    await page.waitForFunction(
      (controls) => Number.parseFloat(getComputedStyle(controls).opacity) >= 0.99,
      element,
      { timeout: 2_000 }
    );
  } finally {
    await element.dispose();
  }
}

async function waitForTransparentBackground(locator) {
  const element = await locator.elementHandle();
  assert.ok(element, "Block row is missing");
  try {
    await page.waitForFunction(
      (row) => {
        const color = getComputedStyle(row).backgroundColor;
        return color === "transparent" || color === "rgba(0, 0, 0, 0)";
      },
      element,
      { timeout: 2_000 }
    );
  } finally {
    await element.dispose();
  }
}

async function saveAndWait(predicate) {
  await page.keyboard.press(`${modifier}+s`);
  await waitForPageSource(predicate);
}

async function waitForPageSource(predicate, timeout = 10_000) {
  return waitForFileSource(pagePath, predicate, timeout);
}

async function waitForFileSource(filePath, predicate, timeout = 10_000) {
  const started = Date.now();
  let source = "";
  while (Date.now() - started < timeout) {
    source = await fsp.readFile(filePath, "utf8");
    if (predicate(source)) return source;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for Page source: ${filePath}\n${JSON.stringify(source)}`);
}

async function dispatchImageEvent(locator, eventName, name) {
  return locator.evaluate(
    (element, { bytes, eventName: type, fileName }) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array(bytes)], fileName, { type: "image/png", lastModified: 1 })
      );
      const event =
        type === "paste"
          ? new ClipboardEvent(type, { bubbles: true, cancelable: true, clipboardData: transfer })
          : new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer });
      element.dispatchEvent(event);
      return { defaultPrevented: event.defaultPrevented, files: transfer.files.length };
    },
    { fileName: name, bytes: [...PNG_BYTES], eventName }
  );
}

async function openFileInRenderer(filePath) {
  const target = new URL(page.url());
  target.pathname = "/editor/";
  target.search = `?file=${encodeURIComponent(filePath)}`;
  await page.goto(target.toString(), { waitUntil: "domcontentloaded" });
  await page
    .locator("text=Loading")
    .waitFor({ state: "detached" })
    .catch(() => undefined);
}

async function waitForShellCalls(count, timeout = 5_000) {
  const started = Date.now();
  let calls = [];
  while (Date.now() - started < timeout) {
    calls = await electronApp.evaluate(() => globalThis.__DOXMIND_GUI_SHELL_CALLS__ ?? []);
    if (calls.length >= count) return calls;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${count} Electron shell calls`);
}

async function stubSaveDialog(result) {
  await electronApp.evaluate(({ dialog }, response) => {
    globalThis.__DOXMIND_GUI_SAVE_DIALOG_CALLS__ = [];
    dialog.showSaveDialog = async (ownerWindow, options) => {
      globalThis.__DOXMIND_GUI_SAVE_DIALOG_CALLS__.push({
        ownerWindowId: ownerWindow?.webContents?.id ?? null,
        options,
      });
      return response;
    };
  }, result);
}

async function waitForSaveDialogCalls(count, timeout = 10_000) {
  const started = Date.now();
  let calls = [];
  while (Date.now() - started < timeout) {
    calls = await electronApp.evaluate(() => globalThis.__DOXMIND_GUI_SAVE_DIALOG_CALLS__ ?? []);
    if (calls.length >= count) return calls;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${count} Electron save dialog call(s)`);
}

async function waitForFile(filePath, timeout = 10_000) {
  const started = Date.now();
  let previousSize = -1;
  let stableSamples = 0;
  while (Date.now() - started < timeout) {
    try {
      const stat = await fsp.stat(filePath);
      stableSamples = stat.size > 0 && stat.size === previousSize ? stableSamples + 1 : 0;
      previousSize = stat.size;
      if (stableSamples >= 2) return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for file: ${filePath}`);
}

async function pathExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listRelativeFiles(root) {
  const found = [];

  async function walk(directory) {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else {
        found.push(path.relative(root, absolutePath));
      }
    }
  }

  await walk(root);
  return found.sort();
}

async function renderFirstPdfPage(pdfPath, outputPath) {
  const outputPrefix = outputPath.replace(/\.png$/i, "");
  try {
    await execFileAsync(
      "pdftoppm",
      ["-f", "1", "-l", "1", "-singlefile", "-png", "-r", "144", pdfPath, outputPrefix],
      { maxBuffer: 4 * 1024 * 1024 }
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { available: false, artifact: null };
    }
    throw error;
  }

  const pngBytes = await fsp.readFile(outputPath);
  assert.deepEqual(
    pngBytes.subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    "pdftoppm did not create a PNG"
  );
  assert.ok(pngBytes.length > 1_000, `rendered PDF preview is too small: ${pngBytes.length}`);
  return { available: true, artifact: path.basename(outputPath), bytes: pngBytes.length };
}

async function saveArtifactScreenshot(name) {
  await fsp.mkdir(ARTIFACT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACT_DIR, name), fullPage: true });
}

async function writeSuccessReport() {
  await fsp.mkdir(ARTIFACT_DIR, { recursive: true });
  await fsp.writeFile(
    path.join(ARTIFACT_DIR, "report.json"),
    `${JSON.stringify(
      {
        executablePath,
        checks: passed,
        pageErrors,
        consoleErrors,
        pdfExport: pdfExportEvidence,
        screenshots: [
          "focus-mode.png",
          "new-window.png",
          "collections-and-embed.png",
          "attachment-read-only.png",
          "final-page.png",
          "settings-light.png",
          "settings-dark.png",
          "block-editor-parity.png",
        ],
        artifacts: [
          "page-export.pdf",
          ...(pdfExportEvidence?.firstPagePng?.artifact
            ? [pdfExportEvidence.firstPagePng.artifact]
            : []),
        ],
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function captureFailure(error) {
  await fsp.mkdir(ARTIFACT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const screenshotPath = path.join(ARTIFACT_DIR, `failure-${stamp}.png`);
  if (page && !page.isClosed()) {
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  }
  const source = await fsp.readFile(pagePath, "utf8").catch(() => "<unreadable>");
  const report = [
    `Executable: ${executablePath}`,
    `Passed: ${passed.length}`,
    ...passed.map((name) => `  - ${name}`),
    "",
    error instanceof Error ? (error.stack ?? error.message) : String(error),
    "",
    "Page errors:",
    ...pageErrors,
    "",
    "Console errors:",
    ...consoleErrors,
    "",
    "Current Markdown:",
    source,
  ].join("\n");
  await fsp.writeFile(path.join(ARTIFACT_DIR, `failure-${stamp}.txt`), report, "utf8");
  console.error(`\nFailure artifacts: ${screenshotPath}`);
}

function occurrences(source, needle) {
  return source.split(needle).length - 1;
}

function pageFixture(properties, body) {
  const frontmatter = Object.entries(properties).map(
    ([key, value]) => `${key}: ${typeof value === "string" ? JSON.stringify(value) : value}`
  );
  return ["---", ...frontmatter, "---", "", body].join("\n");
}

function parseArguments(args) {
  const parsed = { app: null };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--app") {
      const value = args[index + 1];
      if (!value) throw new Error("--app requires an executable path");
      parsed.app = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${args[index]}`);
  }
  if (parsed.app && !fs.existsSync(parsed.app)) {
    throw new Error(`packaged Electron executable does not exist: ${parsed.app}`);
  }
  return parsed;
}

function findPackagedExecutable() {
  const candidates =
    process.platform === "darwin"
      ? [
          "dist-electron/mac-arm64/doXmind.app/Contents/MacOS/doXmind",
          "dist-electron/mac/doXmind.app/Contents/MacOS/doXmind",
        ]
      : process.platform === "win32"
        ? ["dist-electron/win-unpacked/doXmind.exe"]
        : ["dist-electron/linux-unpacked/doxmind", "dist-electron/linux-unpacked/doXmind"];
  const found = candidates.map((candidate) => path.join(REPO_ROOT, candidate)).find(fs.existsSync);
  if (!found) {
    throw new Error(
      `no packaged doXmind executable found under ${path.join(REPO_ROOT, "dist-electron")}; run npm run dist:electron first or pass --app`
    );
  }
  return found;
}
