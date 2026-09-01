"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const exportQueues = new WeakMap();
// The *focused* Page, not the only one. Two panes are two mounted documents, so a count of one
// would make every export while split fail — and fail reporting that the Page had changed, which
// names the wrong cause entirely.
//
// Single quotes inside the attribute selector on purpose: this is a template literal, so a
// backslash-escaped double quote collapses to a bare one and closes the JavaScript string early.
const ACTIVE_NATIVE_PAGE_SCRIPT = `(() => {
  const pages = Array.from(
    document.querySelectorAll(
      "[data-native-markdown-document][data-file-id][data-pane-active='true']"
    )
  );
  return pages.length === 1 ? pages[0].getAttribute("data-file-id") : null;
})()`;

function suggestedPdfName(name) {
  const leaf = String(name || "Untitled")
    .split(/[\\/]/)
    .pop()
    .replace(/\.(?:md|markdown)$/i, "")
    .replace(/[\u0000-\u001f<>:"|?*]+/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  return `${leaf || "Untitled"}.pdf`;
}

function pdfPath(filePath) {
  return /\.pdf$/i.test(filePath) ? filePath : `${filePath}.pdf`;
}

async function assertRegularTarget(filePath) {
  try {
    const stat = await fs.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("PDF export target must be a regular file");
    }
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
}

async function pdfTargetRevision(filePath) {
  await assertRegularTarget(filePath);
  try {
    const bytes = await fs.readFile(filePath);
    return crypto.createHash("sha256").update(bytes).digest("hex");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function atomicWritePdf(filePath, bytes, expectedTargetRevision) {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomUUID()}`
  );
  let handle;
  try {
    const mode = await fs
      .stat(filePath)
      .then((stat) => stat.mode & 0o777)
      .catch(() => 0o600);
    handle = await fs.open(temporaryPath, "wx", mode);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    const actualTargetRevision = await pdfTargetRevision(filePath);
    if (actualTargetRevision !== expectedTargetRevision) {
      throw new Error("PDF export target changed after it was selected");
    }
    await fs.rename(temporaryPath, filePath);
  } finally {
    await handle?.close().catch(() => {});
    await fs.unlink(temporaryPath).catch(() => {});
  }
}

async function assertActiveExportTarget(contents, targetFileId, message) {
  if (!targetFileId) return;
  if (contents.isDestroyed() || typeof contents.executeJavaScript !== "function") {
    throw new Error(message);
  }
  const activeFileId = await contents.executeJavaScript(ACTIVE_NATIVE_PAGE_SCRIPT, true);
  if (activeFileId !== targetFileId) throw new Error(message);
}

function exportPagePdf(options) {
  const { contents } = options;
  if (!contents || contents.isDestroyed()) {
    return Promise.reject(new Error("PDF export has no active Page"));
  }
  if (typeof options.targetFileId !== "string" || !options.targetFileId) {
    return Promise.reject(new Error("PDF export target Page is required"));
  }

  const previous = exportQueues.get(contents);
  const current = previous
    ? previous.catch(() => {}).then(() => runExport(options))
    : runExport(options);
  exportQueues.set(contents, current);
  return current.finally(() => {
    if (exportQueues.get(contents) === current) exportQueues.delete(contents);
  });
}

async function runExport({ contents, ownerWindow, suggestedName, targetFileId, showSaveDialog }) {
  const result = await showSaveDialog(ownerWindow, {
    title: "Export Page as PDF",
    defaultPath: suggestedPdfName(suggestedName),
    filters: [{ name: "PDF Document", extensions: ["pdf"] }],
  });
  if (result.canceled || !result.filePath) return { status: "cancelled" };

  await assertActiveExportTarget(
    contents,
    targetFileId,
    "Page changed while choosing the PDF destination"
  );

  const outputPath = pdfPath(result.filePath);
  const expectedTargetRevision = await pdfTargetRevision(outputPath);
  const bytes = await contents.printToPDF({
    printBackground: true,
    preferCSSPageSize: true,
  });
  await assertActiveExportTarget(contents, targetFileId, "Page changed while rendering the PDF");
  const hasHeader = Buffer.isBuffer(bytes) && bytes.subarray(0, 5).equals(Buffer.from("%PDF-"));
  const hasEof =
    Buffer.isBuffer(bytes) &&
    bytes.subarray(Math.max(0, bytes.length - 2048)).includes(Buffer.from("%%EOF"));
  if (!hasHeader || !hasEof) {
    throw new Error("Electron did not generate a valid PDF");
  }
  await atomicWritePdf(outputPath, bytes, expectedTargetRevision);
  return { status: "saved", path: outputPath };
}

module.exports = { exportPagePdf, ACTIVE_NATIVE_PAGE_SCRIPT };
