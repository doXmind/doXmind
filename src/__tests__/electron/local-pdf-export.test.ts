import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { exportPagePdf } = require("../../../electron/local-pdf-export.js") as {
  exportPagePdf: (options: {
    contents: {
      isDestroyed: () => boolean;
      printToPDF: (options: {
        printBackground: boolean;
        preferCSSPageSize: boolean;
      }) => Promise<Buffer>;
      executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>;
    };
    ownerWindow: object;
    suggestedName: string;
    targetFileId?: string;
    showSaveDialog: (
      ownerWindow: object,
      options: {
        title: string;
        defaultPath: string;
        filters: Array<{ name: string; extensions: string[] }>;
      }
    ) => Promise<{ canceled: boolean; filePath?: string }>;
  }) => Promise<{ status: "saved"; path: string } | { status: "cancelled" }>;
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true }))
  );
});

describe("local Page PDF export", () => {
  it("rejects a missing target Page before opening a save dialog", async () => {
    const showSaveDialog = vi.fn();

    await expect(
      exportPagePdf({
        contents: { isDestroyed: () => false, printToPDF: vi.fn() },
        ownerWindow: {},
        suggestedName: "Missing-target.md",
        showSaveDialog,
      })
    ).rejects.toThrow("target Page is required");

    expect(showSaveDialog).not.toHaveBeenCalled();
  });

  it("rejects a destroyed Page before opening a save dialog", async () => {
    const showSaveDialog = vi.fn();

    await expect(
      exportPagePdf({
        contents: { isDestroyed: () => true, printToPDF: vi.fn() },
        ownerWindow: {},
        suggestedName: "Destroyed.md",
        targetFileId: "target-page",
        showSaveDialog,
      })
    ).rejects.toThrow("no active Page");

    expect(showSaveDialog).not.toHaveBeenCalled();
  });

  it("writes Electron's generated PDF bytes to the selected local path", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "doxmind-pdf-export-"));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, "Native.pdf");
    const pdfBytes = Buffer.from("%PDF-1.7\nlocal markdown page\n%%EOF\n", "utf8");
    const ownerWindow = {};
    const contents = {
      isDestroyed: () => false,
      executeJavaScript: vi.fn().mockResolvedValue("target-page"),
      printToPDF: vi.fn().mockResolvedValue(pdfBytes),
    };
    const showSaveDialog = vi.fn().mockResolvedValue({ canceled: false, filePath: outputPath });

    const result = await exportPagePdf({
      contents,
      ownerWindow,
      suggestedName: "Native.md",
      targetFileId: "target-page",
      showSaveDialog,
    });

    expect(showSaveDialog).toHaveBeenCalledWith(ownerWindow, {
      title: "Export Page as PDF",
      defaultPath: "Native.pdf",
      filters: [{ name: "PDF Document", extensions: ["pdf"] }],
    });
    expect(contents.printToPDF).toHaveBeenCalledWith({
      printBackground: true,
      preferCSSPageSize: true,
    });
    await expect(fs.readFile(outputPath)).resolves.toEqual(pdfBytes);
    expect(result).toEqual({ status: "saved", path: outputPath });
  });

  it("does not render or write a PDF when the save dialog is cancelled", async () => {
    const contents = {
      isDestroyed: () => false,
      printToPDF: vi.fn(),
    };

    const result = await exportPagePdf({
      contents,
      ownerWindow: {},
      suggestedName: "Cancelled.md",
      targetFileId: "target-page",
      showSaveDialog: vi.fn().mockResolvedValue({ canceled: true }),
    });

    expect(contents.printToPDF).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "cancelled" });
  });

  it("does not print or write another Page selected while the save dialog is open", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "doxmind-pdf-export-"));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, "Wrong-page.pdf");
    let activeFileId = "target-page";
    const contents = {
      isDestroyed: () => false,
      executeJavaScript: vi.fn(async () => activeFileId),
      printToPDF: vi.fn().mockResolvedValue(Buffer.from("%PDF-1.7\nwrong Page\n%%EOF\n")),
    };
    const showSaveDialog = vi.fn(async () => {
      activeFileId = "user-selected-page";
      return { canceled: false, filePath: outputPath };
    });

    await expect(
      exportPagePdf({
        contents,
        ownerWindow: {},
        suggestedName: "Target.md",
        targetFileId: "target-page",
        showSaveDialog,
      })
    ).rejects.toThrow("Page changed while choosing the PDF destination");

    expect(contents.printToPDF).not.toHaveBeenCalled();
    await expect(fs.access(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("discards PDF bytes when the user changes Page during rendering", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "doxmind-pdf-export-"));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, "Changed-during-render.pdf");
    let activeFileId = "target-page";
    const contents = {
      isDestroyed: () => false,
      executeJavaScript: vi.fn(async () => activeFileId),
      printToPDF: vi.fn(async () => {
        activeFileId = "user-selected-page";
        return Buffer.from("%PDF-1.7\nwrong Page\n%%EOF\n");
      }),
    };

    await expect(
      exportPagePdf({
        contents,
        ownerWindow: {},
        suggestedName: "Target.md",
        targetFileId: "target-page",
        showSaveDialog: vi.fn().mockResolvedValue({ canceled: false, filePath: outputPath }),
      })
    ).rejects.toThrow("Page changed while rendering the PDF");

    expect(contents.printToPDF).toHaveBeenCalledOnce();
    await expect(fs.access(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("confines the suggested name and always saves with a PDF extension", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "doxmind-pdf-export-"));
    temporaryDirectories.push(directory);
    const selectedPath = path.join(directory, "Exported");
    const showSaveDialog = vi.fn().mockResolvedValue({ canceled: false, filePath: selectedPath });

    const result = await exportPagePdf({
      contents: {
        isDestroyed: () => false,
        executeJavaScript: vi.fn().mockResolvedValue("target-page"),
        printToPDF: vi.fn().mockResolvedValue(Buffer.from("%PDF-1.7\n%%EOF\n")),
      },
      ownerWindow: {},
      suggestedName: "../Unsafe:\u0000.md",
      targetFileId: "target-page",
      showSaveDialog,
    });

    expect(showSaveDialog.mock.calls[0][1].defaultPath).toBe("Unsafe_.pdf");
    await expect(fs.readFile(`${selectedPath}.pdf`, "utf8")).resolves.toMatch(/^%PDF-/);
    expect(result).toEqual({ status: "saved", path: `${selectedPath}.pdf` });
  });

  it("rejects invalid renderer output without replacing an existing file", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "doxmind-pdf-export-"));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, "Existing.pdf");
    await fs.writeFile(outputPath, "original bytes", "utf8");

    await expect(
      exportPagePdf({
        contents: {
          isDestroyed: () => false,
          executeJavaScript: vi.fn().mockResolvedValue("target-page"),
          printToPDF: vi.fn().mockResolvedValue(Buffer.from("%PDF-1.7\ntruncated")),
        },
        ownerWindow: {},
        suggestedName: "Existing.md",
        targetFileId: "target-page",
        showSaveDialog: vi.fn().mockResolvedValue({ canceled: false, filePath: outputPath }),
      })
    ).rejects.toThrow("valid PDF");

    await expect(fs.readFile(outputPath, "utf8")).resolves.toBe("original bytes");
  });

  it("preserves an existing PDF changed externally after the destination is selected", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "doxmind-pdf-export-"));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, "Existing.pdf");
    await fs.writeFile(outputPath, "%PDF-1.7\noriginal\n%%EOF\n", "utf8");
    const externalBytes = Buffer.from("%PDF-1.7\nexternal update\n%%EOF\n");
    const generatedBytes = Buffer.from("%PDF-1.7\napp update\n%%EOF\n");

    await expect(
      exportPagePdf({
        contents: {
          isDestroyed: () => false,
          executeJavaScript: vi.fn().mockResolvedValue("target-page"),
          printToPDF: vi.fn(async () => {
            await fs.writeFile(outputPath, externalBytes);
            return generatedBytes;
          }),
        },
        ownerWindow: {},
        suggestedName: "Existing.md",
        targetFileId: "target-page",
        showSaveDialog: vi.fn().mockResolvedValue({ canceled: false, filePath: outputPath }),
      })
    ).rejects.toThrow("PDF export target changed after it was selected");

    await expect(fs.readFile(outputPath)).resolves.toEqual(externalBytes);
  });

  it("refuses to follow a symbolic-link export target", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "doxmind-pdf-export-"));
    temporaryDirectories.push(directory);
    const originalPath = path.join(directory, "Original.pdf");
    const linkedPath = path.join(directory, "Linked.pdf");
    await fs.writeFile(originalPath, "original bytes", "utf8");
    await fs.symlink(originalPath, linkedPath);

    await expect(
      exportPagePdf({
        contents: {
          isDestroyed: () => false,
          executeJavaScript: vi.fn().mockResolvedValue("target-page"),
          printToPDF: vi.fn().mockResolvedValue(Buffer.from("%PDF-1.7\n%%EOF\n")),
        },
        ownerWindow: {},
        suggestedName: "Linked.md",
        targetFileId: "target-page",
        showSaveDialog: vi.fn().mockResolvedValue({ canceled: false, filePath: linkedPath }),
      })
    ).rejects.toThrow("regular file");

    await expect(fs.readFile(originalPath, "utf8")).resolves.toBe("original bytes");
  });

  it.skipIf(process.platform === "win32")(
    "keeps the previous PDF intact when an atomic replacement cannot be created",
    async () => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), "doxmind-pdf-export-"));
      temporaryDirectories.push(directory);
      const outputPath = path.join(directory, "Existing.pdf");
      const originalBytes = Buffer.from("%PDF-1.7\noriginal\n%%EOF\n");
      await fs.writeFile(outputPath, originalBytes, { mode: 0o600 });
      await fs.chmod(directory, 0o500);

      try {
        await expect(
          exportPagePdf({
            contents: {
              isDestroyed: () => false,
              executeJavaScript: vi.fn().mockResolvedValue("target-page"),
              printToPDF: vi.fn().mockResolvedValue(Buffer.from("%PDF-1.7\nnew\n%%EOF\n")),
            },
            ownerWindow: {},
            suggestedName: "Existing.md",
            targetFileId: "target-page",
            showSaveDialog: vi.fn().mockResolvedValue({ canceled: false, filePath: outputPath }),
          })
        ).rejects.toThrow();
      } finally {
        await fs.chmod(directory, 0o700);
      }

      await expect(fs.readFile(outputPath)).resolves.toEqual(originalBytes);
      expect(await fs.readdir(directory)).toEqual(["Existing.pdf"]);
    }
  );

  it("serializes export dialogs for the same Page", async () => {
    let cancelFirst: ((value: { canceled: boolean }) => void) | undefined;
    const firstDialog = new Promise<{ canceled: boolean }>((resolve) => {
      cancelFirst = resolve;
    });
    const showSaveDialog = vi
      .fn()
      .mockImplementationOnce(() => firstDialog)
      .mockResolvedValueOnce({ canceled: true });
    const contents = {
      isDestroyed: () => false,
      printToPDF: vi.fn(),
    };
    const options = {
      contents,
      ownerWindow: {},
      suggestedName: "Queued.md",
      targetFileId: "target-page",
      showSaveDialog,
    };

    const first = exportPagePdf(options);
    const second = exportPagePdf(options);
    await Promise.resolve();

    expect(showSaveDialog).toHaveBeenCalledTimes(1);
    cancelFirst?.({ canceled: true });
    await expect(first).resolves.toEqual({ status: "cancelled" });
    await expect(second).resolves.toEqual({ status: "cancelled" });
    expect(showSaveDialog).toHaveBeenCalledTimes(2);
  });
});
