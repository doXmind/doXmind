import type { FileItem } from "@/types";
import { SCORE_PREFIX, scoreFuzzyText } from "@/lib/fuzzy-match";

export interface WikiLinkPage {
  /** The Page's own id, so a caller can tell two same-named candidates apart. */
  readonly id: string;
  /** Basename without the Markdown extension — what a `[[Wiki Link]]` normally carries. */
  readonly name: string;
  /** Workspace-relative folder, shown when the name alone would be ambiguous. */
  readonly folder: string;
  /** Root-relative path without the extension, the unambiguous form of the same link. */
  readonly path: string;
  readonly aliases: readonly string[];
}

/**
 * Every Page a Wiki Link could resolve to.
 *
 * Deliberately the same filter `resolveWikiLinkTarget` applies: folders and workspace files are
 * not Pages, and offering one would suggest a link that then fails to resolve.
 */
export function wikiLinkPages(files: readonly FileItem[]): WikiLinkPage[] {
  const pages: WikiLinkPage[] = [];
  for (const file of files) {
    if (file.isFolder || file.isAsset) continue;
    if (file.documentType !== undefined && file.documentType !== "markdown") continue;
    const relPath = file.storageHandle?.relPath ?? file.storageHandle?.path ?? file.name;
    const withoutExtension = relPath.replace(/\.(md|markdown)$/i, "");
    const cut = withoutExtension.lastIndexOf("/");
    pages.push({
      id: file.id,
      name: cut >= 0 ? withoutExtension.slice(cut + 1) : withoutExtension,
      folder: cut > 0 ? withoutExtension.slice(0, cut) : "",
      path: withoutExtension,
      aliases: file.meta?.aliases ?? [],
    });
  }
  return pages;
}

/**
 * Candidates for `query`, best first.
 *
 * An alias scores like the name it stands for, because `[[Q3 Plan]]` is a link the resolver
 * already follows. An empty query lists everything, so `[[` alone is a browsable index.
 */
export function searchWikiLinkPages(
  pages: readonly WikiLinkPage[],
  query: string,
  limit = 20
): WikiLinkPage[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return pages.slice(0, limit);
  return pages
    .map((page, index) => ({ page, index, score: scoreWikiLinkPage(page, normalized) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.page);
}

function scoreWikiLinkPage(page: WikiLinkPage, query: string): number {
  const name = scoreFuzzyText(page.name.toLocaleLowerCase(), query);
  if (name === SCORE_PREFIX) return name;
  let best = name;
  for (const alias of page.aliases) {
    best = Math.max(best, scoreFuzzyText(alias.toLocaleLowerCase(), query));
    if (best === SCORE_PREFIX) return best;
  }
  // The path is a weaker signal than the name, exactly as in the quick switcher.
  const path = scoreFuzzyText(page.path.toLocaleLowerCase(), query);
  return Math.max(best, path ? path / 2 : 0);
}

/**
 * The link text to write for `page`.
 *
 * A bare basename is what a user would type, but it only resolves while it is unique. When two
 * Pages share a name the root-relative path is emitted instead, so the link the popup inserts is
 * always one the resolver can follow back to the row that was chosen.
 */
export function wikiLinkSource(page: WikiLinkPage, pages: readonly WikiLinkPage[]): string {
  const ambiguous = pages.some(
    (other) =>
      other.id !== page.id && other.name.toLocaleLowerCase() === page.name.toLocaleLowerCase()
  );
  return `[[${ambiguous ? page.path : page.name}]]`;
}
