import { describe, expect, it } from "vitest";
import { documentTypeFromName, isMarkdownFile } from "@/lib/document-types";

describe("document type boundary", () => {
  it("recognizes only Markdown extensions as Pages", () => {
    expect(documentTypeFromName("Note.md")).toBe("markdown");
    expect(documentTypeFromName("Note.markdown")).toBe("markdown");
    expect(isMarkdownFile({ name: "Note.md", documentType: "markdown" })).toBe(true);
  });

  it("classifies unknown formats as read-only Attachments", () => {
    expect(documentTypeFromName("Report.docx")).toBe("other");
    expect(documentTypeFromName("photo.png")).toBe("other");
    expect(isMarkdownFile({ name: "Report.docx", documentType: "other" })).toBe(false);
  });
});
