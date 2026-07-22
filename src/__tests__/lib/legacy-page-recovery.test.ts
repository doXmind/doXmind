import { describe, expect, it } from "vitest";
import { buildLegacyPageRecovery } from "@/lib/legacy-page-recovery";

function extractBase64Payloads(markdown: string): string[] {
  return Array.from(markdown.matchAll(/```base64\n([A-Za-z0-9+/=\n]*)\n```/g), (match) =>
    match[1].replaceAll("\n", "")
  );
}

describe("buildLegacyPageRecovery", () => {
  it("stores exact recoverable base64 for text, binary, and empty artifacts", () => {
    const result = buildLegacyPageRecovery(
      "Research/Page.md",
      {
        artifacts: [
          { path: "Research/.Page.doxmind", bytes: [123, 34, 118, 34, 58, 49, 125] },
          { path: "Research/.Page.doxmind.bak", bytes: [0, 255, 222, 173] },
          { path: "Research/.Page.doxmind.lock", bytes: [] },
        ],
      },
      "2026-07-21T12:00:00.000Z"
    );

    expect(result.fileName).toBe("Page.md.doxmind-page-recovery.md");
    expect(result.markdown).toContain('source: "Research/Page.md"');
    expect(result.markdown).toContain("artifact_count: 3");
    expect(result.markdown).toContain(
      "Keep the original Markdown Page and its complete legacy artifact family together."
    );
    expect(extractBase64Payloads(result.markdown)).toEqual(["eyJ2IjoxfQ==", "AP/erQ==", ""]);
  });

  it("uses a collision-safe fence only for readable UTF-8 previews", () => {
    const readable = new TextEncoder().encode('{"html":"before ``` and ````` after"}\n');
    const result = buildLegacyPageRecovery("Page.md", {
      artifacts: [
        { path: ".Page.doxmind", bytes: [...readable] },
        { path: ".Page.doxmind.corrupt-binary", bytes: [0, 255, 1] },
      ],
    });

    expect(result.markdown).toContain("### Readable UTF-8 preview");
    expect(result.markdown).toContain(
      '``````text\n{"html":"before ``` and ````` after"}\n\n``````'
    );
    expect(result.markdown.match(/### Readable UTF-8 preview/g)).toHaveLength(1);
  });
});
