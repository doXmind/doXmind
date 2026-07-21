import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { SUPPORTED_EXTS } = require("../../../electron/window-registry.js") as {
  SUPPORTED_EXTS: string[];
};

describe("Electron open-file boundary", () => {
  it("accepts supported Attachments without removed Office formats", () => {
    expect(SUPPORTED_EXTS).toEqual([
      ".md",
      ".markdown",
      ".pdf",
      ".xlsx",
      ".xlsm",
      ".csv",
      ".html",
      ".htm",
    ]);
    expect(SUPPORTED_EXTS).not.toContain(".docx");
    expect(SUPPORTED_EXTS).not.toContain(".pptx");
  });
});
