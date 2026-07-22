import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exportMarkdownAsPdf, waitForEditorReady } from "@/lib/markdown-pdf-export";
import { useFileStore } from "@/stores/file-store";

describe("PDF export editor readiness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useFileStore.setState({ currentFileId: "native-page" });
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("recognizes the native Markdown runtime", async () => {
    document.body.innerHTML =
      '<div data-native-markdown-document data-file-id="native-page"></div>';

    const ready = waitForEditorReady("native-page");
    await vi.advanceTimersByTimeAsync(800);

    await expect(ready).resolves.toBe(true);
  });

  it("does not treat an old native DOM tree as the requested Page", async () => {
    document.body.innerHTML = '<div data-native-markdown-document data-file-id="old-page"></div>';

    const ready = waitForEditorReady("native-page", 100);
    await vi.advanceTimersByTimeAsync(200);

    await expect(ready).resolves.toBe(false);
  });

  it("does not export the current Page before its native runtime is ready", async () => {
    const invoke = vi.fn().mockResolvedValue({
      status: "saved",
      path: "/tmp/Native.pdf",
    });
    vi.stubGlobal("__DOXMIND_DESKTOP__", {
      platform: "macos",
      invoke,
      listen: vi.fn(() => vi.fn()),
      getPathForFile: vi.fn(() => null),
    });

    const pending = exportMarkdownAsPdf({
      fileId: "native-page",
      fileName: "Native.md",
    });
    await vi.advanceTimersByTimeAsync(5_100);

    await expect(pending).resolves.toEqual({
      ok: false,
      via: "local-pdf",
      status: "failed",
      error: "Page did not become ready in time",
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("exports through the local Electron PDF bridge without contacting FastAPI", async () => {
    vi.useRealTimers();
    document.body.innerHTML =
      '<div data-native-markdown-document data-file-id="native-page"></div>';
    const invoke = vi.fn().mockResolvedValue({
      status: "saved",
      path: "/tmp/Native.pdf",
    });
    vi.stubGlobal("__DOXMIND_DESKTOP__", {
      platform: "macos",
      invoke,
      listen: vi.fn(() => vi.fn()),
      getPathForFile: vi.fn(() => null),
    });
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const fetch = vi.spyOn(globalThis, "fetch");

    const result = await exportMarkdownAsPdf({
      fileId: "native-page",
      fileName: "Native.md",
    });

    expect(result).toEqual({
      ok: true,
      via: "local-pdf",
      status: "saved",
      path: "/tmp/Native.pdf",
    });
    expect(invoke).toHaveBeenCalledWith("export_page_pdf", {
      suggestedName: "Native",
      targetFileId: "native-page",
    });
    expect(print).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails explicitly without an Electron bridge and never falls back to window.print", async () => {
    document.body.innerHTML =
      '<div data-native-markdown-document data-file-id="native-page">' +
      '<figure data-native-print-ready="false"></figure></div>';
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);

    const pendingResult = exportMarkdownAsPdf({
      fileId: "native-page",
      fileName: "Browser.md",
    });
    await vi.advanceTimersByTimeAsync(5_100);
    const result = await pendingResult;

    expect(result).toEqual({
      ok: false,
      via: "local-pdf",
      status: "failed",
      error: "Local PDF export requires the Electron desktop app",
    });
    expect(print).not.toHaveBeenCalled();
  });

  it("waits for a source-backed embed projection and reports save-dialog cancellation", async () => {
    vi.useRealTimers();
    document.body.innerHTML =
      '<div data-native-markdown-document data-file-id="native-page">' +
      '<figure data-native-print-ready="false"></figure></div>';
    const invoke = vi.fn().mockResolvedValue({ status: "cancelled" });
    vi.stubGlobal("__DOXMIND_DESKTOP__", {
      platform: "macos",
      invoke,
      listen: vi.fn(() => vi.fn()),
      getPathForFile: vi.fn(() => null),
    });

    const result = exportMarkdownAsPdf({
      fileId: "native-page",
      fileName: "Embedded.md",
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(invoke).not.toHaveBeenCalled();
    document
      .querySelector("[data-native-print-ready]")
      ?.setAttribute("data-native-print-ready", "true");

    await expect(result).resolves.toEqual({
      ok: false,
      via: "local-pdf",
      status: "cancelled",
      error: "cancelled",
    });
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("reports a local PDF renderer failure without attempting another export path", async () => {
    vi.useRealTimers();
    document.body.innerHTML =
      '<div data-native-markdown-document data-file-id="native-page"></div>';
    const invoke = vi.fn().mockRejectedValue(new Error("PDF rendering failed"));
    vi.stubGlobal("__DOXMIND_DESKTOP__", {
      platform: "macos",
      invoke,
      listen: vi.fn(() => vi.fn()),
      getPathForFile: vi.fn(() => null),
    });
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);

    const result = await exportMarkdownAsPdf({
      fileId: "native-page",
      fileName: "Broken.markdown",
    });

    expect(result).toEqual({
      ok: false,
      via: "local-pdf",
      status: "failed",
      error: "PDF rendering failed",
    });
    expect(invoke).toHaveBeenCalledWith("export_page_pdf", {
      suggestedName: "Broken",
      targetFileId: "native-page",
    });
    expect(print).not.toHaveBeenCalled();
  });

  it("aborts instead of exporting a loading placeholder after the readiness deadline", async () => {
    document.body.innerHTML =
      '<div data-native-markdown-document data-file-id="native-page">' +
      '<figure data-native-print-ready="false"></figure></div>';
    const invoke = vi.fn().mockResolvedValue({ status: "saved", path: "/tmp/late.pdf" });
    vi.stubGlobal("__DOXMIND_DESKTOP__", {
      platform: "macos",
      invoke,
      listen: vi.fn(() => vi.fn()),
      getPathForFile: vi.fn(() => null),
    });

    const result = exportMarkdownAsPdf({
      fileId: "native-page",
      fileName: "Still-loading.md",
    });
    await vi.advanceTimersByTimeAsync(5_900);

    await expect(result).resolves.toEqual({
      ok: false,
      via: "local-pdf",
      status: "failed",
      error: "Page previews did not become ready for PDF export",
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("fails safely without overwriting a user navigation during the save dialog", async () => {
    vi.useRealTimers();
    useFileStore.setState({ currentFileId: "previous-page" });
    const loadFileContent = vi.fn().mockResolvedValue(undefined);
    const requestCurrentFile = vi.fn(async (fileId: string | null) => {
      useFileStore.setState({ currentFileId: fileId });
      if (fileId === "export-page") {
        document.body.innerHTML =
          '<div data-native-markdown-document data-file-id="export-page"></div>';
      }
      return true;
    });
    useFileStore.setState({ loadFileContent, requestCurrentFile });
    const invoke = vi.fn().mockImplementation(async () => {
      useFileStore.setState({ currentFileId: "user-selected-page" });
      throw new Error("Page changed while choosing the PDF destination");
    });
    vi.stubGlobal("__DOXMIND_DESKTOP__", {
      platform: "macos",
      invoke,
      listen: vi.fn(() => vi.fn()),
      getPathForFile: vi.fn(() => null),
    });

    const result = await exportMarkdownAsPdf({
      fileName: "Print.md",
      fileId: "export-page",
    });

    expect(result).toEqual({
      ok: false,
      via: "local-pdf",
      status: "failed",
      error: "Page changed while choosing the PDF destination",
    });
    expect(requestCurrentFile).toHaveBeenCalledTimes(1);
    expect(requestCurrentFile).toHaveBeenCalledWith("export-page");
    expect(invoke).toHaveBeenCalledWith("export_page_pdf", {
      suggestedName: "Print",
      targetFileId: "export-page",
    });
    expect(useFileStore.getState().currentFileId).toBe("user-selected-page");
  });

  it("restores the previous Page after a temporary sidebar export", async () => {
    vi.useRealTimers();
    useFileStore.setState({ currentFileId: "previous-page" });
    const loadFileContent = vi.fn().mockResolvedValue(undefined);
    const requestCurrentFile = vi.fn(async (fileId: string | null) => {
      useFileStore.setState({ currentFileId: fileId });
      if (fileId === "export-page") {
        document.body.innerHTML =
          '<div data-native-markdown-document data-file-id="export-page"></div>';
      }
      return true;
    });
    useFileStore.setState({ loadFileContent, requestCurrentFile });
    const invoke = vi.fn().mockResolvedValue({
      status: "saved",
      path: "/tmp/Export.pdf",
    });
    vi.stubGlobal("__DOXMIND_DESKTOP__", {
      platform: "macos",
      invoke,
      listen: vi.fn(() => vi.fn()),
      getPathForFile: vi.fn(() => null),
    });

    const result = await exportMarkdownAsPdf({
      fileName: "Export.md",
      fileId: "export-page",
    });

    expect(result.status).toBe("saved");
    expect(requestCurrentFile).toHaveBeenNthCalledWith(1, "export-page");
    expect(requestCurrentFile).toHaveBeenNthCalledWith(2, "previous-page");
    expect(useFileStore.getState().currentFileId).toBe("previous-page");
  });

  it("aborts PDF export when the requested Page cannot be read from disk", async () => {
    vi.useRealTimers();
    useFileStore.setState({ currentFileId: "previous-page" });
    const loadFileContent = vi.fn().mockRejectedValue(new Error("permission denied"));
    const requestCurrentFile = vi.fn().mockResolvedValue(true);
    useFileStore.setState({ loadFileContent, requestCurrentFile });
    const invoke = vi.fn();
    vi.stubGlobal("__DOXMIND_DESKTOP__", {
      platform: "macos",
      invoke,
      listen: vi.fn(() => vi.fn()),
      getPathForFile: vi.fn(() => null),
    });

    const result = await exportMarkdownAsPdf({
      fileName: "Unreadable.md",
      fileId: "unreadable-page",
    });

    expect(result).toEqual({
      ok: false,
      via: "local-pdf",
      status: "failed",
      error: "Failed to load Page for PDF export",
    });
    expect(loadFileContent).toHaveBeenCalledWith("unreadable-page", {
      force: true,
      throwOnError: true,
    });
    expect(requestCurrentFile).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
