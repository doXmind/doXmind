import { describe, expect, it } from "vitest";
import { NATIVE_FILE_FILTERS } from "@/components/native-menu-listener";

describe("native file picker boundary", () => {
  it("offers Pages and supported Attachments without removed Office formats", () => {
    expect(NATIVE_FILE_FILTERS).toEqual([
      {
        name: "Documents",
        extensions: ["md", "markdown", "pdf", "xlsx", "xlsm", "csv", "html", "htm"],
      },
    ]);
  });
});
