import { resolveKnowledgeWikiPage, type KnowledgePage } from "@/lib/knowledge-index";
import type { FileItem } from "@/stores/file-store";

/**
 * The visible local workspace's Markdown Pages, shaped for wiki-link resolution and search —
 * `[[` autocomplete and `[[target]]` resolution both read the same list, so a Page is a candidate
 * in one exactly when it is reachable through the other.
 */
export function workspaceWikiPages(files: readonly FileItem[]): KnowledgePage[] {
  return files
    .filter(
      (file) =>
        !file.isFolder && (file.documentType === undefined || file.documentType === "markdown")
    )
    .map((file) => ({
      id: file.id,
      path: pagePath(file),
      title:
        nonEmptyString(file.meta?.title) ??
        nonEmptyString(file.preview) ??
        stripMarkdownExtension(baseName(pagePath(file))),
      aliases: Array.isArray(file.meta?.aliases)
        ? file.meta.aliases.flatMap((value) => {
            const alias = nonEmptyString(value);
            return alias ? [alias] : [];
          })
        : [],
    }));
}

/** Resolve a wiki-link against the visible local workspace without an index database. */
export function resolveWikiLinkTarget(
  files: readonly FileItem[],
  currentFileId: string,
  rawTarget: string
): FileItem | null {
  const target = wikiPagePart(rawTarget);
  if (!target) return null;

  const pages = files.filter(
    (file) =>
      !file.isFolder && (file.documentType === undefined || file.documentType === "markdown")
  );
  const current = pages.find((file) => file.id === currentFileId);
  const resolution = resolveKnowledgeWikiPage(
    workspaceWikiPages(pages),
    current ? pagePath(current) : "",
    target
  );
  if (!resolution.page) return null;
  return pages.find((file) => file.id === resolution.page?.id) ?? null;
}

function pagePath(file: FileItem): string {
  const path = file.storageHandle?.relPath ?? file.storageHandle?.path ?? file.name;
  return normalizeWikiPath(path);
}

function wikiPagePart(target: string): string {
  return target.split("|", 1)[0].split(/[\^#]/, 1)[0].trim();
}

function normalizeWikiPath(path: string): string {
  const segments: string[] = [];
  for (const segment of path.replaceAll("\\", "/").split("/")) {
    const normalized = segment.trim();
    if (!normalized || normalized === ".") continue;
    if (normalized === "..") {
      segments.pop();
      continue;
    }
    segments.push(normalized);
  }
  return (
    segments
      .join("/")
      .replace(/\.(?:md|markdown)$/i, "")
      .normalize("NFC")
      // ECMAScript's simple lowercase mapping is locale-independent. Do not
      // replace this with a default-locale mapping (notably Turkish I/i).
      .toLowerCase()
  );
}

function baseName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(slash + 1);
}

function stripMarkdownExtension(path: string): string {
  return path.replace(/\.(?:md|markdown)$/i, "");
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}
