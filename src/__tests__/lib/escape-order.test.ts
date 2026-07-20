import { describe, expect, it } from "vitest";
import { escapeMarkdownText } from "@/lib/markdown";

describe("escapeMarkdownText — escape passes must not escape each other's output", () => {
  it("does not double the backslash it inserts before a leading link", () => {
    // The link pass inserts `\` at index 0; the leading-marker pass lists a
    // literal backslash as an alternative and would re-escape it.
    const out = escapeMarkdownText("[label](target)", true);
    expect(out).toBe("\\[label](target)");
    expect(out).not.toContain("\\\\");
  });

  it("leaves a single escape for each bracket-pair shape", () => {
    for (const input of ["[a]:", "[a](b)", "[a][b]"]) {
      expect(escapeMarkdownText(input, true)).not.toContain("\\\\");
    }
  });

  it("still escapes a backslash the user actually typed", () => {
    expect(escapeMarkdownText("\\literal", true)).toBe("\\\\literal");
  });

  it("still escapes leading block markers", () => {
    expect(escapeMarkdownText("# not a heading", true)).toBe("\\# not a heading");
    expect(escapeMarkdownText("- not a list", true)).toBe("\\- not a list");
    expect(escapeMarkdownText("> not a quote", true)).toBe("\\> not a quote");
  });

  it("escapes both a leading marker and a link in the same line", () => {
    expect(escapeMarkdownText("- [a](b)", true)).toBe("\\- \\[a](b)");
  });
});
