import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { renderBookmarkCardPng } from "@/lib/bookmark-card-renderer";

/**
 * jsdom doesn't ship a real canvas backend, so these tests exercise the
 * control flow only — empty-url short-circuit, proxy-fetch failure path —
 * not pixel output. The visual fidelity is verified manually in the Tauri
 * shell during PDF export.
 */
describe("renderBookmarkCardPng", () => {
  const originalCanvasGetContext = HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    // Stub fetch so the proxy call short-circuits — the test harness has
    // no sidecar running.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    HTMLCanvasElement.prototype.getContext = originalCanvasGetContext;
  });

  it("returns null for an empty url so the export pipeline drops the bookmark cleanly", async () => {
    const result = await renderBookmarkCardPng({
      title: "",
      description: "",
      url: "",
      faviconUrl: "",
      imageUrl: "",
    });
    expect(result).toBeNull();
  });

  it("returns null when the canvas 2d context is unavailable so the table fallback can take over", async () => {
    // Some headless / locked-down environments report no 2d context;
    // ensure we surface that as null rather than throwing into the export.
    HTMLCanvasElement.prototype.getContext = function () {
      return null;
    } as typeof HTMLCanvasElement.prototype.getContext;

    const result = await renderBookmarkCardPng({
      title: "doXmind",
      description: "An AI-native writing editor.",
      url: "https://doxmind.com",
      faviconUrl: "",
      imageUrl: "",
    });
    expect(result).toBeNull();
  });

  it("does not throw when both proxy fetches fail — even without a 2d backend", async () => {
    // jsdom has no canvas 2d backend, so the renderer correctly returns
    // null from `getContext("2d")`; the production webview always has one.
    // What this test pins is the failure-shape: we never throw, we never
    // leak a rejected promise, and we always return cleanly so the export
    // pipeline can fall back to the table when canvas is unavailable.
    await expect(
      renderBookmarkCardPng({
        title: "doXmind - AI-Native Writing Editor",
        description:
          "doXmind is an AI-native writing editor for docs, notes, and knowledge management.",
        url: "https://doxmind.com",
        faviconUrl: "https://doxmind.com/favicon.ico",
        imageUrl: "https://doxmind.com/og.png",
      })
    ).resolves.toBeNull();
  });
});
