import type { ExcelEditorState, PdfEditorState } from "@/lib/storage";
import type { FileItem } from "@/types";

export interface LegacyAttachmentRecoveryArtifact {
  fileName: string;
  markdown: string;
}

type LegacyAttachmentEditorState = PdfEditorState | ExcelEditorState;

export function buildLegacyAttachmentRecovery(
  file: FileItem,
  state: LegacyAttachmentEditorState,
  exportedAt = new Date().toISOString()
): LegacyAttachmentRecoveryArtifact {
  const documentType = file.documentType;
  if (documentType !== "pdf" && documentType !== "excel") {
    throw new Error("Legacy recovery reports are available only for PDF and spreadsheet files");
  }

  const sourcePath = file.storageHandle?.relPath || file.storageHandle?.path || file.name;
  const sourceName = basename(sourcePath);
  const json = JSON.stringify(state, null, 2);
  const fence = "`".repeat(Math.max(3, longestBacktickRun(json) + 1));

  return {
    fileName: `${sourceName}.doxmind-recovery.md`,
    markdown: [
      "---",
      "doxmind_recovery_version: 1",
      `source: ${JSON.stringify(sourcePath)}`,
      `document_type: ${documentType}`,
      `exported_at: ${JSON.stringify(exportedAt)}`,
      "---",
      "",
      `# Legacy doXmind recovery: ${sourceName}`,
      "",
      "This report contains the exact legacy editor state that doXmind found beside the source attachment.",
      "Keep the original attachment with its hidden recovery file. doXmind did not modify either file while creating this report.",
      "",
      "## Exact editor state",
      "",
      `${fence}json`,
      json,
      fence,
      "",
    ].join("\n"),
  };
}

export function downloadLegacyAttachmentRecovery(artifact: LegacyAttachmentRecoveryArtifact): void {
  const blob = new Blob([artifact.markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = artifact.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function basename(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "attachment";
}

function longestBacktickRun(value: string): number {
  return Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
}
