import { afterEach, describe, expect, it, vi } from "vitest";
import { exportEditedPdfStrict, exportEditedPdfViaBackend } from "@/lib/pdf/export-edited";
import type { PdfEditorState } from "@/lib/storage/types";

const pdfjsMocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  transform: vi.fn(),
}));
const parseBlocksMocks = vi.hoisted(() => ({
  fetchPdfBlocks: vi.fn(),
}));

vi.mock("@/lib/pdf/pdfjs", () => ({
  getPdfjs: () => ({
    getDocument: pdfjsMocks.getDocument,
    Util: { transform: pdfjsMocks.transform },
  }),
}));

vi.mock("@/lib/pdf/parse-blocks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pdf/parse-blocks")>();
  return { ...actual, fetchPdfBlocks: parseBlocksMocks.fetchPdfBlocks };
});

import { buildPdfRecoveryPayload } from "@/lib/pdf/recovery";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function useSinglePagePdf(items: unknown[]) {
  const destroy = vi.fn().mockResolvedValue(undefined);
  const getPage = vi.fn().mockResolvedValue({
    getViewport: () => ({ transform: [1, 0, 0, -1, 0, 100] }),
    getTextContent: () => Promise.resolve({ items, styles: {} }),
  });
  pdfjsMocks.getDocument.mockReturnValue({
    promise: Promise.resolve({ numPages: 1, getPage, destroy }),
  });
  pdfjsMocks.transform.mockImplementation((_viewport: number[], transform: number[]) => transform);
  return { destroy, getPage };
}

describe("PDF attachment recovery", () => {
  it("surfaces backend and network failures instead of silently falling back", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("no", { status: 422 })));
    await expect(exportEditedPdfStrict(new Uint8Array([1]), { pages: [] })).rejects.toThrow(/422/);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(exportEditedPdfStrict(new Uint8Array([1]), { pages: [] })).rejects.toThrow(
      "offline"
    );
  });

  it("requests strict accounting only for attachment recovery exports", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await exportEditedPdfStrict(new Uint8Array([1]), { pages: [] });
    await exportEditedPdfViaBackend(new Uint8Array([1]), { pages: [] });

    const strictBody = fetchMock.mock.calls[0][1]?.body as FormData;
    const legacyBody = fetchMock.mock.calls[1][1]?.body as FormData;
    expect(strictBody.get("strict_recovery")).toBe("true");
    expect(legacyBody.has("strict_recovery")).toBe(false);
  });

  it("builds one strict export payload from all five generations of persisted edits", async () => {
    const getPage = vi.fn(async (pageNumber: number) => ({
      getViewport: () => ({ transform: [1, 0, 0, -1, 0, 100] }),
      getTextContent: async () =>
        pageNumber === 1
          ? {
              items: [
                {
                  str: "Original",
                  transform: [1, 0, 0, 10, 20, 50],
                  width: 30,
                  height: 6,
                  fontName: "f1",
                },
                {
                  str: "Direct",
                  transform: [1, 0, 0, 12, 80, 60],
                  width: 35,
                  height: 7,
                  fontName: "f1",
                },
              ],
              styles: { f1: { fontFamily: "Inter" } },
            }
          : { items: [], styles: {} },
    }));
    const destroy = vi.fn().mockResolvedValue(undefined);
    pdfjsMocks.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 2, getPage, destroy }),
    });
    pdfjsMocks.transform.mockImplementation(
      (_viewport: number[], transform: number[]) => transform
    );
    parseBlocksMocks.fetchPdfBlocks.mockResolvedValue({
      version: 2,
      pageCount: 2,
      pages: [
        {
          pageIndex: 0,
          width: 600,
          height: 800,
          blocks: [
            {
              id: "legacy-source",
              bbox: [20, 40, 50, 53],
              lines: [
                {
                  bbox: [20, 40, 50, 53],
                  spans: [
                    {
                      text: "Original",
                      bbox: [20, 40, 50, 53],
                      font: "Inter",
                      size: 10,
                      color: "#445566",
                      flags: 0,
                      bold: false,
                      italic: false,
                    },
                  ],
                },
              ],
            },
            {
              id: "direct-source",
              bbox: [80, 48, 115, 63],
              lines: [
                {
                  bbox: [80, 48, 115, 63],
                  spans: [
                    {
                      text: "Direct",
                      bbox: [80, 48, 115, 63],
                      font: "Inter",
                      size: 12,
                      color: "#223344",
                      flags: 0,
                      bold: false,
                      italic: false,
                    },
                  ],
                },
              ],
            },
            {
              id: "paragraph",
              bbox: [14, 15, 84, 49],
              lines: [
                {
                  bbox: [14, 15, 84, 49],
                  spans: [
                    {
                      text: "Paragraph",
                      bbox: [14, 15, 84, 49],
                      font: "Inter",
                      size: 11,
                      color: "#000000",
                      flags: 0,
                      bold: false,
                      italic: false,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const state: PdfEditorState = {
      version: 2,
      edits: { "p0-t0": { text: "Legacy changed" } },
      textEdits: {
        "p0-t1": {
          pageIndex: 0,
          text: "Direct changed",
          originalText: "Direct",
          x: 1,
          y: 2,
          width: 30,
          height: 12,
          fontSize: 10,
          color: "#112233",
        },
      },
      paragraphEdits: {
        paragraph: {
          pageIndex: 0,
          text: "Paragraph changed",
          originalText: "Paragraph",
          bbox: { x: 4, y: 5, width: 60, height: 24 },
          fontSize: 11,
          textAlign: "center",
          deleted: false,
        },
      },
      freeText: [
        {
          id: "free",
          pageIndex: 0,
          text: "Note",
          x: 7,
          y: 8,
          width: 40,
          height: 16,
          fontSize: 12,
        },
      ],
      highlights: [{ id: "highlight", pageIndex: 0, x: 9, y: 10, width: 50, height: 8 }],
    };

    const payload = await buildPdfRecoveryPayload(new Uint8Array([1, 2, 3]), state);

    expect(getPage).toHaveBeenCalledTimes(1);
    expect(getPage).toHaveBeenCalledWith(1);
    expect(parseBlocksMocks.fetchPdfBlocks).toHaveBeenCalledWith(expect.any(Uint8Array), {
      pageIndexes: [0],
    });
    expect(destroy).toHaveBeenCalledOnce();
    expect(payload.pages).toHaveLength(1);
    expect(payload.pages[0].textEdits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "Legacy changed", rect: [20, 41.03, 30, 11.5] }),
        expect.objectContaining({
          text: "Direct changed",
          rect: [1, 2, 30, 12],
          originalRect: [80, 49.236000000000004, 35, 13.799999999999999],
          fontFamily: "Inter",
        }),
        expect.objectContaining({
          text: "Paragraph changed",
          rect: [4, 5, 60, 24],
          originalRect: [14, 15, 70, 34],
          align: "center",
          fontFamily: "Inter",
          color: "#000000",
        }),
      ])
    );
    expect(payload.pages[0].freeText).toEqual([
      expect.objectContaining({
        text: "Note",
        rect: [7, 8, 40, 16],
        fontFamily: '"Times New Roman", Times, serif',
      }),
    ]);
    expect(payload.pages[0].highlights).toEqual([
      expect.objectContaining({ rect: [9, 10, 50, 8] }),
    ]);
  });

  it("does not scan unrelated PDF.js pages for overlay-only recovery", async () => {
    const getPage = vi.fn();
    const destroy = vi.fn().mockResolvedValue(undefined);
    pdfjsMocks.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 900, getPage, destroy }),
    });

    const payload = await buildPdfRecoveryPayload(new Uint8Array([1]), {
      version: 1,
      freeText: [
        {
          id: "note",
          pageIndex: 899,
          text: "Recovered note",
          x: 1,
          y: 2,
          width: 30,
          height: 12,
          fontSize: 10,
        },
      ],
      highlights: [{ id: "mark", pageIndex: 898, x: 1, y: 2, width: 30, height: 12 }],
    });

    expect(getPage).not.toHaveBeenCalled();
    expect(parseBlocksMocks.fetchPdfBlocks).not.toHaveBeenCalled();
    expect(payload.pages.map((page) => page.pageIndex)).toEqual([898, 899]);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it.each([
    ["top-level", { version: 1, futureMutation: { enabled: true } }],
    ["legacy edit", { version: 1, edits: { "p0-t0": { text: "Changed", underline: true } } }],
    [
      "text edit",
      {
        version: 1,
        textEdits: {
          "p0-t0": {
            pageIndex: 0,
            text: "Changed",
            originalText: "Original",
            x: 1,
            y: 2,
            width: 30,
            height: 12,
            fontSize: 10,
            underline: true,
          },
        },
      },
    ],
    [
      "paragraph edit",
      {
        version: 2,
        paragraphEdits: {
          paragraph: {
            pageIndex: 0,
            text: "Changed",
            originalText: "Original",
            bbox: { x: 1, y: 2, width: 30, height: 12 },
            fontSize: 10,
            underline: true,
          },
        },
      },
    ],
    [
      "free text",
      {
        version: 1,
        freeText: [
          {
            id: "note",
            pageIndex: 0,
            text: "Note",
            x: 1,
            y: 2,
            width: 30,
            height: 12,
            fontSize: 10,
            underline: true,
          },
        ],
      },
    ],
    [
      "highlight",
      {
        version: 1,
        highlights: [
          { id: "mark", pageIndex: 0, x: 1, y: 2, width: 30, height: 12, note: "future" },
        ],
      },
    ],
    [
      "style range",
      {
        version: 1,
        textEdits: {
          "p0-t0": {
            pageIndex: 0,
            text: "Changed",
            originalText: "Original",
            x: 1,
            y: 2,
            width: 30,
            height: 12,
            fontSize: 10,
            styleRanges: [{ start: 0, end: 1, underline: true }],
          },
        },
      },
    ],
  ])("rejects an unsupported nested mutation in %s state", async (_label, state) => {
    useSinglePagePdf([
      {
        str: "Original",
        transform: [1, 0, 0, 10, 20, 50],
        width: 30,
        height: 6,
      },
    ]);

    await expect(
      buildPdfRecoveryPayload(new Uint8Array([1]), state as unknown as PdfEditorState)
    ).rejects.toThrow(/unsupported field/i);
  });

  it("rejects conflicting duplicate legacy and structured text edits", async () => {
    useSinglePagePdf([
      {
        str: "Original",
        transform: [1, 0, 0, 10, 20, 50],
        width: 30,
        height: 6,
      },
    ]);

    await expect(
      buildPdfRecoveryPayload(new Uint8Array([1]), {
        version: 1,
        edits: { "p0-t0": { text: "Legacy value" } },
        textEdits: {
          "p0-t0": {
            pageIndex: 0,
            text: "Structured value",
            originalText: "Original",
            x: 1,
            y: 2,
            width: 30,
            height: 12,
            fontSize: 10,
          },
        },
      })
    ).rejects.toThrow(/conflicting saved text/i);
  });

  it("refuses non-BMP text that the strict PDF font path cannot preserve", async () => {
    const { destroy, getPage } = useSinglePagePdf([]);

    await expect(
      buildPdfRecoveryPayload(new Uint8Array([1]), {
        version: 1,
        freeText: [
          {
            id: "emoji",
            pageIndex: 0,
            text: "emoji 😀",
            x: 1,
            y: 2,
            width: 30,
            height: 12,
            fontSize: 10,
          },
        ],
      })
    ).rejects.toThrow(/strict PDF recovery font cannot preserve/i);
    expect(getPage).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("maps an empty oldest-generation edit to an explicit deletion", async () => {
    const { destroy } = useSinglePagePdf([
      {
        str: "Delete me",
        transform: [1, 0, 0, 10, 20, 50],
        width: 30,
        height: 6,
      },
    ]);

    const payload = await buildPdfRecoveryPayload(new Uint8Array([1]), {
      version: 1,
      edits: { "p0-t0": { text: "" } },
    });

    expect(payload.pages[0].textEdits).toEqual([
      expect.objectContaining({ text: "", deleted: true, rect: [20, 41.03, 30, 11.5] }),
    ]);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("maps an empty direct text edit to an explicit deletion", async () => {
    useSinglePagePdf([
      {
        str: "Delete me",
        transform: [1, 0, 0, 10, 20, 50],
        width: 30,
        height: 6,
      },
    ]);

    const payload = await buildPdfRecoveryPayload(new Uint8Array([1]), {
      version: 1,
      textEdits: {
        "p0-t0": {
          pageIndex: 0,
          text: "",
          originalText: "Delete me",
          x: 20,
          y: 41.03,
          width: 30,
          height: 11.5,
          fontSize: 10,
        },
      },
    });

    expect(payload.pages[0].textEdits).toEqual([
      expect.objectContaining({ text: "", deleted: true }),
    ]);
  });

  it("rejects empty free text instead of inserting a synthetic space", async () => {
    useSinglePagePdf([]);

    await expect(
      buildPdfRecoveryPayload(new Uint8Array([1]), {
        version: 1,
        freeText: [
          {
            id: "empty-note",
            pageIndex: 0,
            text: "",
            x: 1,
            y: 2,
            width: 30,
            height: 12,
            fontSize: 10,
          },
        ],
      })
    ).rejects.toThrow(/free text 0\.text.*non-empty/i);
  });

  it("preserves the legacy font-name fallback when no font family was saved", async () => {
    useSinglePagePdf([
      {
        str: "Original",
        transform: [1, 0, 0, 10, 20, 50],
        width: 30,
        height: 6,
        fontName: "Times-Roman",
      },
    ]);
    parseBlocksMocks.fetchPdfBlocks.mockResolvedValue({
      version: 2,
      pageCount: 1,
      pages: [
        {
          pageIndex: 0,
          width: 600,
          height: 800,
          blocks: [
            {
              id: "source-block",
              bbox: [20, 40, 50, 53],
              lines: [
                {
                  bbox: [20, 40, 50, 53],
                  spans: [
                    {
                      text: "Original",
                      bbox: [20, 40, 50, 53],
                      font: "Times-Roman",
                      size: 10,
                      color: "#111111",
                      flags: 0,
                      bold: false,
                      italic: false,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const payload = await buildPdfRecoveryPayload(new Uint8Array([1]), {
      version: 1,
      textEdits: {
        "p0-t0": {
          pageIndex: 0,
          text: "Recovered",
          originalText: "Original",
          x: 1,
          y: 2,
          width: 30,
          height: 12,
          fontSize: 10,
          fontName: "Times-Roman",
        },
      },
    });

    expect(payload.pages[0].textEdits).toEqual([
      expect.objectContaining({ fontFamily: '"Times New Roman", Times, serif' }),
    ]);
  });

  it("fills missing direct-edit styling from one matching source span", async () => {
    useSinglePagePdf([
      {
        str: "Original",
        transform: [1, 0, 0, 10, 20, 50],
        width: 30,
        height: 6,
        fontName: "Times-BoldItalic",
      },
    ]);
    parseBlocksMocks.fetchPdfBlocks.mockResolvedValue({
      version: 2,
      pageCount: 1,
      pages: [
        {
          pageIndex: 0,
          width: 600,
          height: 800,
          blocks: [
            {
              id: "source-block",
              bbox: [20, 40, 50, 53],
              lines: [
                {
                  bbox: [20, 40, 50, 53],
                  spans: [
                    {
                      text: "Original",
                      bbox: [20, 40, 50, 53],
                      font: "Times-BoldItalic",
                      size: 10,
                      color: "#123456",
                      flags: 18,
                      bold: true,
                      italic: true,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const payload = await buildPdfRecoveryPayload(new Uint8Array([1]), {
      version: 1,
      textEdits: {
        "p0-t0": {
          pageIndex: 0,
          text: "Recovered",
          originalText: "Original",
          x: 20,
          y: 41.03,
          width: 30,
          height: 11.5,
          fontSize: 10,
          fontName: "Times-BoldItalic",
        },
      },
    });

    expect(payload.pages[0].textEdits).toEqual([
      expect.objectContaining({ color: "#123456", bold: true, italic: true }),
    ]);
  });

  it("fills oldest-generation edit styling from one matching source span", async () => {
    useSinglePagePdf([
      {
        str: "Original",
        transform: [1, 0, 0, 10, 20, 50],
        width: 30,
        height: 6,
        fontName: "Times-Bold",
      },
    ]);
    parseBlocksMocks.fetchPdfBlocks.mockResolvedValue({
      version: 2,
      pageCount: 1,
      pages: [
        {
          pageIndex: 0,
          width: 600,
          height: 800,
          blocks: [
            {
              id: "source-block",
              bbox: [20, 40, 50, 53],
              lines: [
                {
                  bbox: [20, 40, 50, 53],
                  spans: [
                    {
                      text: "Original",
                      bbox: [20, 40, 50, 53],
                      font: "Times-Bold",
                      size: 10,
                      color: "#654321",
                      flags: 16,
                      bold: true,
                      italic: false,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const payload = await buildPdfRecoveryPayload(new Uint8Array([1]), {
      version: 1,
      edits: { "p0-t0": { text: "Recovered" } },
    });

    expect(payload.pages[0].textEdits).toEqual([
      expect.objectContaining({ color: "#654321", bold: true, italic: false }),
    ]);
  });

  it("keeps persisted direct-edit style fields while filling only missing fields", async () => {
    useSinglePagePdf([
      {
        str: "Original",
        transform: [1, 0, 0, 10, 20, 50],
        width: 30,
        height: 6,
      },
    ]);
    parseBlocksMocks.fetchPdfBlocks.mockResolvedValue({
      version: 2,
      pageCount: 1,
      pages: [
        {
          pageIndex: 0,
          width: 600,
          height: 800,
          blocks: [
            {
              id: "source-block",
              bbox: [20, 40, 50, 53],
              lines: [
                {
                  bbox: [20, 40, 50, 53],
                  spans: [
                    {
                      text: "Original",
                      bbox: [20, 40, 50, 53],
                      font: "Inter",
                      size: 10,
                      color: "#123456",
                      flags: 18,
                      bold: true,
                      italic: true,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const payload = await buildPdfRecoveryPayload(new Uint8Array([1]), {
      version: 1,
      textEdits: {
        "p0-t0": {
          pageIndex: 0,
          text: "Recovered",
          originalText: "Original",
          x: 20,
          y: 41.03,
          width: 30,
          height: 11.5,
          fontSize: 10,
          color: "#abcdef",
          bold: false,
        },
      },
    });

    expect(payload.pages[0].textEdits).toEqual([
      expect.objectContaining({ color: "#abcdef", bold: false, italic: true }),
    ]);
  });

  it.each([
    [
      "direct",
      {
        version: 1,
        textEdits: {
          "p0-t0": {
            pageIndex: 0,
            text: "Recovered",
            originalText: "Original",
            x: 20,
            y: 41.03,
            width: 30,
            height: 11.5,
            fontSize: 10,
          },
        },
      },
    ],
    ["oldest-generation", { version: 1, edits: { "p0-t0": { text: "Recovered" } } }],
  ])("rejects %s edits when source styling cannot be uniquely proven", async (_label, state) => {
    useSinglePagePdf([
      {
        str: "Original",
        transform: [1, 0, 0, 10, 20, 50],
        width: 30,
        height: 6,
      },
    ]);
    parseBlocksMocks.fetchPdfBlocks.mockResolvedValue({
      version: 2,
      pageCount: 1,
      pages: [{ pageIndex: 0, width: 600, height: 800, blocks: [] }],
    });

    await expect(
      buildPdfRecoveryPayload(new Uint8Array([1]), state as PdfEditorState)
    ).rejects.toThrow(/could not uniquely match source styling/i);
  });

  it("treats a missing state version as the oldest v1 recovery shape", async () => {
    useSinglePagePdf([
      {
        str: "Original",
        transform: [1, 0, 0, 10, 20, 50],
        width: 30,
        height: 6,
      },
    ]);
    parseBlocksMocks.fetchPdfBlocks.mockResolvedValue({
      version: 2,
      pageCount: 1,
      pages: [
        {
          pageIndex: 0,
          width: 600,
          height: 800,
          blocks: [
            {
              id: "source-block",
              bbox: [20, 40, 50, 53],
              lines: [
                {
                  bbox: [20, 40, 50, 53],
                  spans: [
                    {
                      text: "Original",
                      bbox: [20, 40, 50, 53],
                      font: "Helvetica",
                      size: 10,
                      color: "#111111",
                      flags: 0,
                      bold: false,
                      italic: false,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const payload = await buildPdfRecoveryPayload(new Uint8Array([1]), {
      edits: { "p0-t0": { text: "Recovered" } },
    } as unknown as PdfEditorState);

    expect(payload.pages[0].textEdits).toEqual([expect.objectContaining({ text: "Recovered" })]);
  });

  it("fails the whole recovery when persisted text cannot map to source geometry", async () => {
    const { destroy } = useSinglePagePdf([
      {
        str: "Original",
        transform: [1, 0, 0, 10, 20, 50],
        width: 30,
        height: 6,
      },
    ]);

    await expect(
      buildPdfRecoveryPayload(new Uint8Array([1]), {
        version: 1,
        textEdits: {
          missing: {
            pageIndex: 0,
            text: "Changed",
            originalText: "Original",
            x: 1,
            y: 2,
            width: 30,
            height: 12,
            fontSize: 10,
          },
        },
      })
    ).rejects.toThrow(/match text edit missing/i);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("fails instead of dropping an unmatched oldest-generation edit", async () => {
    const { destroy } = useSinglePagePdf([]);

    await expect(
      buildPdfRecoveryPayload(new Uint8Array([1]), {
        version: 1,
        edits: { "p0-t9": { text: "Recovered" } },
      })
    ).rejects.toThrow(/match legacy edit p0-t9/i);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("rejects invalid persisted geometry before exporting", async () => {
    const { destroy } = useSinglePagePdf([
      {
        str: "Original",
        transform: [1, 0, 0, 10, 20, 50],
        width: 30,
        height: 6,
      },
    ]);

    await expect(
      buildPdfRecoveryPayload(new Uint8Array([1]), {
        version: 1,
        textEdits: {
          "p0-t0": {
            pageIndex: 0,
            text: "Changed",
            originalText: "Original",
            x: 1,
            y: 2,
            width: 0,
            height: 12,
            fontSize: 10,
          },
        },
      })
    ).rejects.toThrow(/width.*greater than zero/i);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("refuses to apply a text edit when the source PDF text has changed", async () => {
    useSinglePagePdf([
      {
        str: "New source text",
        transform: [1, 0, 0, 10, 20, 50],
        width: 30,
        height: 6,
      },
    ]);

    await expect(
      buildPdfRecoveryPayload(new Uint8Array([1]), {
        version: 1,
        textEdits: {
          "p0-t0": {
            pageIndex: 0,
            text: "Recovered",
            originalText: "Old source text",
            x: 1,
            y: 2,
            width: 30,
            height: 12,
            fontSize: 10,
          },
        },
      })
    ).rejects.toThrow(/source text changed/i);
  });

  it("refuses to apply a paragraph edit when the source block text has changed", async () => {
    useSinglePagePdf([]);
    parseBlocksMocks.fetchPdfBlocks.mockResolvedValue({
      version: 2,
      pageCount: 1,
      pages: [
        {
          pageIndex: 0,
          width: 600,
          height: 800,
          blocks: [
            {
              id: "paragraph",
              bbox: [1, 2, 31, 14],
              lines: [
                {
                  bbox: [1, 2, 31, 14],
                  spans: [
                    {
                      text: "New source paragraph",
                      bbox: [1, 2, 31, 14],
                      font: "Inter",
                      size: 10,
                      color: "#000000",
                      flags: 0,
                      bold: false,
                      italic: false,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    await expect(
      buildPdfRecoveryPayload(new Uint8Array([1]), {
        version: 2,
        paragraphEdits: {
          paragraph: {
            pageIndex: 0,
            text: "Recovered",
            originalText: "Old source paragraph",
            bbox: { x: 1, y: 2, width: 30, height: 12 },
            fontSize: 10,
          },
        },
      })
    ).rejects.toThrow(/source paragraph changed/i);
  });

  it("fails the whole recovery when a paragraph source block is missing", async () => {
    const { destroy } = useSinglePagePdf([]);
    parseBlocksMocks.fetchPdfBlocks.mockResolvedValue({
      version: 2,
      pageCount: 1,
      pages: [{ pageIndex: 0, width: 600, height: 800, blocks: [] }],
    });

    await expect(
      buildPdfRecoveryPayload(new Uint8Array([1]), {
        version: 2,
        paragraphEdits: {
          missing: {
            pageIndex: 0,
            text: "Changed",
            originalText: "Original",
            bbox: { x: 1, y: 2, width: 30, height: 12 },
            fontSize: 10,
          },
        },
      })
    ).rejects.toThrow(/match paragraph edit missing/i);
    expect(destroy).toHaveBeenCalledOnce();
  });
});
