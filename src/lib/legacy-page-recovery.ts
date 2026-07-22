import type { PageRecoveryRead } from "@/lib/storage";

export interface LegacyPageRecoveryReport {
  fileName: string;
  markdown: string;
}

export function buildLegacyPageRecovery(
  sourcePath: string,
  recovery: PageRecoveryRead,
  exportedAt = new Date().toISOString()
): LegacyPageRecoveryReport {
  const sourceName = basename(sourcePath);
  const artifactSections = recovery.artifacts.flatMap((artifact, index) => {
    const base64 = wrapBase64(bytesToBase64(artifact.bytes));
    const section = [
      `## Artifact ${index + 1}`,
      "",
      `Path: ${JSON.stringify(artifact.path)}`,
      "",
      `Byte length: ${artifact.bytes.length}`,
      "",
      "Exact raw bytes (Base64):",
      "",
      "```base64",
      base64,
      "```",
      "",
    ];
    const preview = readableUtf8(artifact.bytes);
    if (preview !== null) {
      const fence = "`".repeat(Math.max(3, longestBacktickRun(preview) + 1));
      section.push("### Readable UTF-8 preview", "", `${fence}text`, preview, fence, "");
    }
    return section;
  });

  return {
    fileName: `${sourceName}.doxmind-page-recovery.md`,
    markdown: [
      "---",
      "doxmind_page_recovery_version: 1",
      `source: ${JSON.stringify(sourcePath)}`,
      `artifact_count: ${recovery.artifacts.length}`,
      `exported_at: ${JSON.stringify(exportedAt)}`,
      "---",
      "",
      `# Legacy doXmind Page recovery: ${sourceName}`,
      "",
      "This report contains byte-for-byte recovery data from legacy doXmind artifacts found beside the Markdown Page.",
      "Keep the original Markdown Page and its complete legacy artifact family together.",
      "Creating this report did not modify the Page or any recovery artifact.",
      "To restore an artifact, decode its Base64 payload and save the bytes at the recorded workspace-relative path.",
      "",
      ...artifactSections,
    ].join("\n"),
  };
}

export function downloadLegacyPageRecovery(report: LegacyPageRecoveryReport): void {
  const blob = new Blob([report.markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = report.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function basename(value: string): string {
  return value.replaceAll("\\", "/").split("/").filter(Boolean).pop() || "Page.md";
}

function bytesToBase64(bytes: number[]): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    output += alphabet[first >> 2];
    output += alphabet[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    output += second === undefined ? "=" : alphabet[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    output += third === undefined ? "=" : alphabet[third & 0x3f];
  }
  return output;
}

function wrapBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join("\n") ?? "";
}

function readableUtf8(bytes: number[]): string | null {
  if (!bytes.length) return null;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
    return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(text) ? null : text;
  } catch {
    return null;
  }
}

function longestBacktickRun(value: string): number {
  return Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
}
