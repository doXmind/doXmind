import { describe, expect, it } from "vitest";

import type { PdfBlock } from "@/lib/pdf/parse-blocks";
import { migrateLegacyTextEdits, paragraphFromBlock } from "@/lib/pdf/parse-blocks";

const SAMPLE_BLOCK: PdfBlock = {
  id: "p0-b3",
  bbox: [29.1, 125.5, 556.18, 231.55],
  lines: [
    {
      bbox: [29.1, 125.5, 556.18, 135],
      spans: [
        {
          text: "DevOps & Cloud: ",
          bbox: [29.1, 125.5, 120, 135],
          font: "Helvetica-Bold",
          size: 9,
          color: "#111111",
          flags: 16,
          bold: true,
          italic: false,
        },
        {
          text: "CI/CD (Jenkins, GitHub Actions, Azure DevOps)",
          bbox: [120, 125.5, 556.18, 135],
          font: "Helvetica",
          size: 9,
          color: "#111111",
          flags: 0,
          bold: false,
          italic: false,
        },
      ],
    },
  ],
};

describe("paragraphFromBlock — parse-time style mirrors", () => {
  it("captures originalColor/Bold/Italic/StyleRanges from the dominant span", () => {
    const para = paragraphFromBlock(SAMPLE_BLOCK, 0);

    // Dominant span is the longer "CI/CD (...)" run.
    expect(para.color).toBe("#111111");
    expect(para.bold).toBeUndefined();
    expect(para.italic).toBeUndefined();
    expect(para.styleRanges?.length).toBe(2);

    // Originals mirror the parse-time values exactly.
    expect(para.originalColor).toBe(para.color);
    expect(para.originalBold).toBe(para.bold);
    expect(para.originalItalic).toBe(para.italic);
    expect(para.originalStyleRanges).toBe(para.styleRanges);
  });

  it("propagates originals through legacy edit migration without overwriting them", () => {
    const para = paragraphFromBlock(SAMPLE_BLOCK, 0);
    const { paragraphs } = migrateLegacyTextEdits(
      {
        "p0-t12": {
          pageIndex: 0,
          text: "CI/CD (Jenkins, GitHub Actions, GCP Cloud Build)",
          originalText: "CI/CD (Jenkins, GitHub Actions, Azure DevOps)",
          x: 120,
          y: 125.5,
          width: 420,
          height: 10,
          fontSize: 9,
          color: "#ff0000",
        },
      },
      [para]
    );

    const merged = paragraphs[0]!;
    expect(merged.text).toContain("GCP Cloud Build");
    expect(merged.color).toBe("#ff0000");
    // The parse-time mirror must survive the merge so isTextBoxEdited can
    // still recognise this as a true edit (current !== original).
    expect(merged.originalColor).toBe("#111111");
    expect(merged.originalStyleRanges).toBe(para.originalStyleRanges);
  });
});
