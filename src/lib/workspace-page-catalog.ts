import type { DocumentMeta, StorageAdapter, WorkspaceEntry } from "@/lib/storage";

export type WorkspacePagePropertyValue = string | number | boolean | string[];

export interface WorkspaceCatalogPage {
  id: string;
  path: string;
  title: string;
  aliases: string[];
  /** Portable top-level frontmatter values. `id` remains identity, never a property. */
  properties: Record<string, WorkspacePagePropertyValue>;
  /** Exact canonical Markdown body read from the Page. */
  markdown: string;
  revision: string | null;
}

export interface WorkspacePageCatalog {
  pages: WorkspaceCatalogPage[];
}

export type WorkspacePageCatalogAdapter = Pick<StorageAdapter, "list" | "read">;

const PROPERTY_KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/**
 * Build a complete, zero-write catalog from canonical Markdown Pages.
 * Attachments and legacy sidecar artifacts never cross this Interface.
 */
export async function buildWorkspacePageCatalog(
  adapter: WorkspacePageCatalogAdapter
): Promise<WorkspacePageCatalog> {
  const entries = (await adapter.list()).filter(isMarkdownPageEntry);
  const pages = await Promise.all(
    entries.map(async (entry): Promise<WorkspaceCatalogPage> => {
      const path = entry.handle.relPath ?? entry.handle.path;
      if (!path) {
        throw new Error(`Workspace Page is missing a workspace-relative path: ${entry.handle.id}`);
      }
      const content = await adapter.read(entry.handle);
      return {
        // The workspace scan owns resolved identity. Duplicate authored ids
        // deliberately remain path identities even though raw metadata still
        // exposes the duplicated token.
        id: entry.handle.id,
        path,
        title: nonEmptyString(content.meta?.title) ?? stripMarkdownExtension(baseName(path)),
        aliases: projectAliases(content.meta?.aliases),
        properties: projectWorkspacePageProperties(content.meta),
        markdown: content.markdown,
        revision: content.revision ?? null,
      };
    })
  );
  pages.sort(compareCatalogPages);
  return { pages };
}

/** Project only the deliberately small, portable v1 property grammar. */
export function projectWorkspacePageProperties(
  meta: DocumentMeta | undefined
): Record<string, WorkspacePagePropertyValue> {
  if (!meta) return {};
  const projected: Record<string, WorkspacePagePropertyValue> = {};
  for (const key of Object.keys(meta).sort(compareText)) {
    if (key === "id" || !PROPERTY_KEY.test(key)) continue;
    const value = projectPropertyValue(meta[key]);
    if (value !== undefined) projected[key] = value;
  }
  return projected;
}

function projectPropertyValue(value: unknown): WorkspacePagePropertyValue | undefined {
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value) && value.every((item): item is string => typeof item === "string")) {
    return [...value];
  }
  return undefined;
}

function projectAliases(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((alias) => {
    const projected = nonEmptyString(alias);
    return projected ? [projected] : [];
  });
}

function isMarkdownPageEntry(entry: WorkspaceEntry): boolean {
  if (entry.kind !== "document") return false;
  const path = entry.handle.relPath ?? entry.handle.path ?? entry.name;
  const documentType = entry.documentType ?? entry.handle.documentType;
  if (documentType !== undefined && documentType !== "markdown") return false;
  if (!/\.(?:md|markdown)$/i.test(path)) return false;
  return !/\.doxmind(?:\.|$)/i.test(baseName(path));
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function baseName(path: string): string {
  return path.replaceAll("\\", "/").split("/").at(-1) ?? path;
}

function stripMarkdownExtension(path: string): string {
  return path.replace(/\.(?:md|markdown)$/i, "");
}

function compareCatalogPages(left: WorkspaceCatalogPage, right: WorkspaceCatalogPage): number {
  return compareText(left.path, right.path) || compareText(left.id, right.id);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "base" }) || left.localeCompare(right);
}
