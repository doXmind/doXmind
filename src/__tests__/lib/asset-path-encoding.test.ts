import { describe, expect, it } from "vitest";
import { resolveImageSrc } from "@/lib/asset-url";

describe("asset paths survive the round trip through markdown", () => {
  const root = "/w";
  const doc = "notes/Doc.md";

  it("resolves a percent-encoded filename back to the real path", () => {
    // A space written raw into `![](...)` truncates the link, so the writer
    // encodes; the resolver has to undo that or the image 404s.
    const out = resolveImageSrc("assets/Screen%20Shot.png", root, doc);
    expect(out).toContain("Screen Shot.png");
    expect(out).not.toContain("%20");
  });

  it("leaves a path that was never encoded alone", () => {
    const out = resolveImageSrc("assets/plain.png", root, doc);
    expect(out).toContain("assets/plain.png");
  });

  it("tolerates a stray percent that is not an escape", () => {
    expect(() => resolveImageSrc("assets/100%.png", root, doc)).not.toThrow();
  });

  it("still passes through absolute and remote sources", () => {
    expect(resolveImageSrc("https://example.com/a.png", root, doc)).toBe(
      "https://example.com/a.png"
    );
  });
});
