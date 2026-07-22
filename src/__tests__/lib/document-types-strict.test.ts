import { describe, expect, it } from "vitest";

import { documentTypeFromName, isMarkdownFile, withOriginalExtension } from "@/lib/document-types";

describe("strict Page type boundary", () => {
  it("recognizes Pages only by explicit Markdown extensions", () => {
    expect(documentTypeFromName("Page.md")).toBe("markdown");
    expect(documentTypeFromName("Page.markdown")).toBe("markdown");
    expect(documentTypeFromName("Report.docx")).toBeNull();
    expect(documentTypeFromName("Slides.pptx")).toBeNull();
    expect(documentTypeFromName("README")).toBeNull();
    expect(isMarkdownFile({ name: "Report.docx" })).toBe(false);
    expect(isMarkdownFile({ name: "anything.bin", documentType: "markdown" })).toBe(true);
  });

  it("preserves HTML attachment extensions during rename", () => {
    expect(withOriginalExtension("reference.html", "renamed")).toBe("renamed.html");
    expect(withOriginalExtension("reference.htm", "renamed")).toBe("renamed.htm");
  });
});
