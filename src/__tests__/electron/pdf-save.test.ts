import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { saveWindowPdf } = require("../../../electron/pdf-save.js") as {
  saveWindowPdf: (input: { targetPath: string; bytes: Uint8Array }) => null;
};

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "doxmind-pdf-save-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("Electron Page PDF save boundary", () => {
  it("creates a new PDF target", () => {
    const targetPath = path.join(temporaryDirectory(), "Page.pdf");
    const bytes = Buffer.from("%PDF-1.7\npage");

    expect(saveWindowPdf({ targetPath, bytes })).toBeNull();
    expect(fs.readFileSync(targetPath)).toEqual(bytes);
  });

  it("never overwrites an existing PDF", () => {
    const targetPath = path.join(temporaryDirectory(), "Evidence.pdf");
    fs.writeFileSync(targetPath, "original");
    const timestamp = new Date("2020-01-02T03:04:05.000Z");
    fs.utimesSync(targetPath, timestamp, timestamp);
    const before = fs.statSync(targetPath);

    expect(() =>
      saveWindowPdf({ targetPath, bytes: Buffer.from("%PDF-1.7\nreplacement") })
    ).toThrow();

    expect(fs.readFileSync(targetPath, "utf8")).toBe("original");
    expect(fs.statSync(targetPath).mtimeMs).toBe(before.mtimeMs);
  });

  it.each([".Evidence.doxmind", ".Evidence.doxmind.bak", ".Evidence.doxmind.lock", "Page.xlsx"])(
    "rejects a non-PDF recovery target %s without creating it",
    (name) => {
      const targetPath = path.join(temporaryDirectory(), name);

      expect(() => saveWindowPdf({ targetPath, bytes: Buffer.from("%PDF-1.7\npage") })).toThrow(
        /\.pdf target/
      );
      expect(fs.existsSync(targetPath)).toBe(false);
    }
  );
});
