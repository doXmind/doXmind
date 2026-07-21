"use strict";

const fs = require("node:fs");
const path = require("node:path");

function saveWindowPdf({ targetPath, bytes }) {
  if (typeof targetPath !== "string" || !targetPath.trim()) {
    throw new Error("save_window_pdf requires targetPath");
  }
  if (path.extname(targetPath).toLowerCase() !== ".pdf") {
    throw new Error("save_window_pdf requires a .pdf target");
  }

  const buf = Buffer.from(bytes || []);
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new Error("payload is not a PDF (missing %PDF- header)");
  }

  // `wx` is intentionally no-clobber. Page export must create a new file,
  // never overwrite an Attachment or any legacy recovery evidence.
  fs.writeFileSync(targetPath, buf, { flag: "wx" });
  return null;
}

module.exports = { saveWindowPdf };
