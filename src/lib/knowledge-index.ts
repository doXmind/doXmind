import type { StorageAdapter } from "@/lib/storage";
import {
  isMarkdownLinkOpaqueBlockSource,
  scanMarkdownSource,
} from "@/editor/markdown-block/markdown-source-scanner";
import {
  buildWorkspacePageCatalog,
  type WorkspaceCatalogPage,
  type WorkspacePageCatalog,
} from "@/lib/workspace-page-catalog";

export interface KnowledgeSourceRange {
  /** UTF-16 offset in the canonical Page body (`DocumentContent.markdown`), inclusive. */
  from: number;
  /** UTF-16 offset in the canonical Page body (`DocumentContent.markdown`), exclusive. */
  to: number;
}

export interface KnowledgePage {
  id: string;
  path: string;
  title: string;
  aliases: string[];
}

export interface KnowledgeSourcePage extends KnowledgePage {
  /** Canonical Markdown body read from the Page; never a rendered or Sidecar view. */
  markdown: string;
}

export type KnowledgeLinkKind = "wiki" | "markdown";
export type KnowledgeLinkStatus = "resolved" | "unresolved" | "ambiguous";

export interface KnowledgeLink {
  kind: KnowledgeLinkKind;
  sourceId: string;
  sourcePath: string;
  targetId: string | null;
  targetPath: string | null;
  targetText: string;
  alias: string | null;
  fragment: string | null;
  status: KnowledgeLinkStatus;
  range: KnowledgeSourceRange;
}

export interface KnowledgeBacklink {
  targetId: string;
  targetPath: string;
  links: KnowledgeLink[];
}

export interface KnowledgeUnlinkedMention {
  sourceId: string;
  sourcePath: string;
  targetId: string;
  targetPath: string;
  text: string;
  range: KnowledgeSourceRange;
}

export interface KnowledgeIndex {
  pages: KnowledgePage[];
  links: KnowledgeLink[];
  backlinks: KnowledgeBacklink[];
  unlinkedMentions: KnowledgeUnlinkedMention[];
}

export interface KnowledgeSourceCatalog {
  pages: KnowledgePage[];
  sourcePages: KnowledgeSourcePage[];
  /** Shared zero-write Page catalog for Collection and future derived views. */
  catalogPages?: WorkspaceCatalogPage[];
}

export interface KnowledgeSourceIndex extends KnowledgeIndex, KnowledgeSourceCatalog {}

export interface KnowledgeWikiResolution {
  status: KnowledgeLinkStatus;
  page: KnowledgePage | null;
  candidates: KnowledgePage[];
}

export interface KnowledgeWikiResolver {
  resolve(sourcePath: string, targetText: string): KnowledgeWikiResolution;
}

export type KnowledgeIndexAdapter = Pick<StorageAdapter, "list" | "read">;

interface IndexedPage {
  page: KnowledgePage;
  catalogPage: WorkspaceCatalogPage;
  markdown: string;
  normalizedPath: string;
  normalizedPathWithoutExtension: string;
  directory: string;
  normalizedNames: Set<string>;
}

/** Rebuild a complete, zero-write knowledge index from the current Page files. */
export async function buildKnowledgeIndex(adapter: KnowledgeIndexAdapter): Promise<KnowledgeIndex> {
  const { sourcePages: _sourcePages, ...index } = await buildKnowledgeSourceIndex(adapter);
  return index;
}

/** Read only the canonical Page identities and bodies needed by transclusion. */
export async function buildKnowledgeSourceCatalog(
  adapter: KnowledgeIndexAdapter
): Promise<KnowledgeSourceCatalog> {
  return buildKnowledgeSourceCatalogFromPageCatalog(await buildWorkspacePageCatalog(adapter));
}

/** Derive link/transclusion identity from a Page catalog without another disk scan. */
export function buildKnowledgeSourceCatalogFromPageCatalog(
  catalog: WorkspacePageCatalog
): KnowledgeSourceCatalog {
  return sourceCatalogFromIndexedPages(indexedPagesFromCatalog(catalog));
}

/**
 * Rebuild the knowledge index together with the canonical Page bodies needed
 * by read-only derived views such as transclusion. The Adapter remains
 * list/read-only and no source is normalized or written.
 */
export async function buildKnowledgeSourceIndex(
  adapter: KnowledgeIndexAdapter
): Promise<KnowledgeSourceIndex> {
  const indexedPages = await readIndexedPages(adapter);
  const wikiIndex = buildWikiIndex(
    indexedPages,
    (page) => page.page.path,
    (page) => page.normalizedNames
  );

  const links = indexedPages.flatMap((source) => linksFromPage(source, indexedPages, wikiIndex));
  links.sort(compareLinks);
  const unlinkedMentions = unlinkedMentionsFromPages(indexedPages, links);

  const backlinksByTarget = new Map<string, KnowledgeBacklink>();
  for (const link of links) {
    if (link.status !== "resolved" || !link.targetId || !link.targetPath) continue;
    const existing = backlinksByTarget.get(link.targetId);
    if (existing) existing.links.push(link);
    else {
      backlinksByTarget.set(link.targetId, {
        targetId: link.targetId,
        targetPath: link.targetPath,
        links: [link],
      });
    }
  }

  return {
    ...sourceCatalogFromIndexedPages(indexedPages),
    links,
    backlinks: [...backlinksByTarget.values()].sort((left, right) =>
      compareText(left.targetPath, right.targetPath)
    ),
    unlinkedMentions,
  };
}

async function readIndexedPages(adapter: KnowledgeIndexAdapter): Promise<IndexedPage[]> {
  const indexedPages = indexedPagesFromCatalog(await buildWorkspacePageCatalog(adapter));
  return indexedPages;
}

function indexedPagesFromCatalog(catalog: WorkspacePageCatalog): IndexedPage[] {
  const indexedPages = catalog.pages.map(indexedPage);
  indexedPages.sort((left, right) => compareText(left.page.path, right.page.path));
  return indexedPages;
}

function sourceCatalogFromIndexedPages(
  indexedPages: readonly IndexedPage[]
): KnowledgeSourceCatalog {
  return {
    pages: indexedPages.map(({ page }) => page),
    sourcePages: indexedPages.map(({ page, markdown }) => ({
      ...page,
      markdown,
    })),
    catalogPages: indexedPages.map(({ catalogPage }) => catalogPage),
  };
}

/**
 * Index one Page catalog once so a whole view resolves in linear time. Every
 * lookup applies the same path/title/alias rules as `resolveKnowledgeWikiPage`.
 */
export function createKnowledgeWikiResolver(
  pages: readonly KnowledgePage[]
): KnowledgeWikiResolver {
  const index = buildWikiIndex(
    pages,
    (page) => page.path,
    (page) =>
      new Set(
        [stripMarkdownExtension(baseName(page.path)), page.title, ...page.aliases].map(
          normalizeName
        )
      )
  );
  return {
    resolve: (sourcePath, targetText) => resolveWikiCandidates(sourcePath, targetText, index),
  };
}

/** Resolve one Wiki target using the same path/title/alias rules as the index. */
export function resolveKnowledgeWikiPage(
  pages: readonly KnowledgePage[],
  sourcePath: string,
  targetText: string
): KnowledgeWikiResolution {
  return createKnowledgeWikiResolver(pages).resolve(sourcePath, targetText);
}

function unlinkedMentionsFromPages(
  pages: IndexedPage[],
  links: KnowledgeLink[]
): KnowledgeUnlinkedMention[] {
  const ownersByName = new Map<string, IndexedPage[]>();
  for (const page of pages) {
    for (const name of page.normalizedNames) {
      const owners = ownersByName.get(name);
      if (owners) owners.push(page);
      else ownersByName.set(name, [page]);
    }
  }

  const mentions: KnowledgeUnlinkedMention[] = [];
  for (const source of pages) {
    const masked = maskRanges(
      maskInlineLinkMarkup(maskIgnoredMarkdown(source.markdown)),
      links.filter((link) => link.sourceId === source.page.id).map((link) => link.range)
    );
    for (const target of pages) {
      if (target.page.id === source.page.id || target.normalizedPath === source.normalizedPath) {
        continue;
      }
      for (const name of mentionNames(target)) {
        if (ownersByName.get(normalizeName(name))?.length !== 1) continue;
        const pattern = new RegExp(escapeRegExp(name), "giu");
        for (const match of masked.matchAll(pattern)) {
          if (match.index === undefined) continue;
          const from = match.index;
          const to = from + match[0].length;
          if (!hasMentionBoundaries(masked, from, to, name)) continue;
          mentions.push({
            sourceId: source.page.id,
            sourcePath: source.page.path,
            targetId: target.page.id,
            targetPath: target.page.path,
            text: source.markdown.slice(from, to),
            range: { from, to },
          });
        }
      }
    }
  }
  return selectMentions(mentions);
}

function maskInlineLinkMarkup(source: string): string {
  const masked = source.split("");
  const referenceLabels = new Set<string>();
  const maskMatches = (pattern: RegExp) => {
    for (const match of source.matchAll(pattern)) {
      if (match.index !== undefined) masked.fill(" ", match.index, match.index + match[0].length);
    }
  };
  for (const match of source.matchAll(/^ {0,3}\[([^\]\r\n]+)\]:[^\r\n]*$/gm)) {
    if (match.index === undefined) continue;
    referenceLabels.add(normalizeReferenceLabel(match[1]));
    masked.fill(" ", match.index, match.index + match[0].length);
  }
  maskMatches(/\[\[[^\]\r\n]+\]\]/g);
  maskMatches(/!?\[[^\]\r\n]*\]\((?:<[^>\r\n]+>|[^)\r\n]+)\)/g);
  for (const match of source.matchAll(/!?\[([^\]\r\n]*)\]\[([^\]\r\n]*)\]/g)) {
    if (match.index === undefined) continue;
    const label = normalizeReferenceLabel(match[2] || match[1]);
    if (referenceLabels.has(label)) masked.fill(" ", match.index, match.index + match[0].length);
  }
  for (const match of source.matchAll(/!?\[([^\]\r\n]+)\](?![\[(])/g)) {
    if (match.index === undefined || !referenceLabels.has(normalizeReferenceLabel(match[1]))) {
      continue;
    }
    masked.fill(" ", match.index, match.index + match[0].length);
  }
  maskMatches(/<(?:https?:\/\/|mailto:)[^>\r\n]+>/gi);
  maskMatches(/\b(?:https?:\/\/|www\.)[^\s<>()]+/gi);
  return masked.join("");
}

function normalizeReferenceLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function mentionNames(page: IndexedPage): string[] {
  return unique([
    page.page.title,
    ...page.page.aliases,
    stripMarkdownExtension(baseName(page.page.path)),
  ]).filter(Boolean);
}

function maskRanges(source: string, ranges: KnowledgeSourceRange[]): string {
  const masked = source.split("");
  for (const range of ranges) masked.fill(" ", range.from, range.to);
  return masked.join("");
}

function hasMentionBoundaries(source: string, from: number, to: number, name: string): boolean {
  const nameCharacters = [...name];
  const first = nameCharacters[0] ?? "";
  const last = nameCharacters.at(-1) ?? "";
  const word = /[\p{L}\p{M}\p{N}_]/u;
  const cjk = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;
  const startIsBounded = !word.test(first) || cjk.test(first) || !word.test(source[from - 1] ?? "");
  const endIsBounded = !word.test(last) || cjk.test(last) || !word.test(source[to] ?? "");
  return startIsBounded && endIsBounded;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compareMentions(left: KnowledgeUnlinkedMention, right: KnowledgeUnlinkedMention): number {
  return (
    compareText(left.sourcePath, right.sourcePath) ||
    left.range.from - right.range.from ||
    compareText(left.targetPath, right.targetPath)
  );
}

function selectMentions(mentions: KnowledgeUnlinkedMention[]): KnowledgeUnlinkedMention[] {
  const seen = new Set<string>();
  const selected: KnowledgeUnlinkedMention[] = [];
  const ranked = [...mentions].sort(
    (left, right) =>
      compareText(left.sourcePath, right.sourcePath) ||
      right.range.to - right.range.from - (left.range.to - left.range.from) ||
      left.range.from - right.range.from ||
      compareText(left.targetPath, right.targetPath)
  );
  for (const mention of ranked) {
    const key = `${mention.sourceId}:${mention.targetId}:${mention.range.from}:${mention.range.to}`;
    if (seen.has(key)) continue;
    if (
      selected.some(
        (candidate) =>
          candidate.sourceId === mention.sourceId &&
          candidate.range.from < mention.range.to &&
          mention.range.from < candidate.range.to
      )
    ) {
      continue;
    }
    seen.add(key);
    selected.push(mention);
  }
  return selected.sort(compareMentions);
}

function indexedPage(catalogPage: WorkspaceCatalogPage): IndexedPage {
  const { path } = catalogPage;
  const normalizedPath = normalizePath(path, true);
  const normalizedPathWithoutExtension = stripMarkdownExtension(normalizedPath);
  const title = catalogPage.title;
  const aliases = catalogPage.aliases;
  const normalizedNames = new Set(
    [baseName(normalizedPathWithoutExtension), title, ...aliases].map(normalizeName)
  );
  return {
    page: { id: catalogPage.id, path, title, aliases },
    catalogPage,
    markdown: catalogPage.markdown,
    normalizedPath,
    normalizedPathWithoutExtension,
    directory: directoryName(normalizedPathWithoutExtension),
    normalizedNames,
  };
}

function linksFromPage(
  source: IndexedPage,
  pages: IndexedPage[],
  wikiIndex: WikiIndex<IndexedPage>
): KnowledgeLink[] {
  const searchable = maskIgnoredMarkdown(source.markdown);
  return [
    ...wikiLinksFromPage(source, wikiIndex, searchable),
    ...markdownLinksFromPage(source, pages, searchable),
  ];
}

function wikiLinksFromPage(
  source: IndexedPage,
  wikiIndex: WikiIndex<IndexedPage>,
  searchable: string
): KnowledgeLink[] {
  const links: KnowledgeLink[] = [];
  const pattern = /\[\[([^\]\r\n]+)\]\]/g;
  for (const match of searchable.matchAll(pattern)) {
    if (match.index === undefined) continue;
    if (isEscapedAt(source.markdown, match.index)) continue;
    const parsed = parseWikiTarget(match[1]);
    if (!parsed.targetText) continue;
    const resolution = resolveWikiTarget(source, parsed.targetText, wikiIndex);
    links.push({
      kind: "wiki",
      sourceId: source.page.id,
      sourcePath: source.page.path,
      targetId: resolution.page?.page.id ?? null,
      targetPath: resolution.page?.page.path ?? null,
      targetText: parsed.targetText,
      alias: parsed.alias,
      fragment: parsed.fragment,
      status: resolution.status,
      range: { from: match.index, to: match.index + match[0].length },
    });
  }
  return links;
}

function markdownLinksFromPage(
  source: IndexedPage,
  pages: IndexedPage[],
  searchable: string
): KnowledgeLink[] {
  const links: KnowledgeLink[] = [];
  const pattern = /\[([^\]\r\n]*)\]\((<[^>\r\n]+>|[^)\r\n]+)\)/g;
  for (const match of searchable.matchAll(pattern)) {
    if (match.index === undefined || searchable[match.index - 1] === "!") continue;
    if (isEscapedAt(source.markdown, match.index)) continue;
    const parsed = parseMarkdownDestination(match[2]);
    if (!parsed) continue;
    const resolution = resolveMarkdownTarget(source, parsed.targetText, pages);
    links.push({
      kind: "markdown",
      sourceId: source.page.id,
      sourcePath: source.page.path,
      targetId: resolution.page?.page.id ?? null,
      targetPath: resolution.page?.page.path ?? null,
      targetText: parsed.targetText,
      alias: nonEmptyString(match[1]),
      fragment: parsed.fragment,
      status: resolution.status,
      range: { from: match.index, to: match.index + match[0].length },
    });
  }
  return links;
}

function parseMarkdownDestination(
  source: string
): { targetText: string; fragment: string | null } | null {
  const trimmed = source.trim();
  let destination: string;
  if (trimmed.startsWith("<")) {
    if (!trimmed.endsWith(">")) return null;
    destination = trimmed.slice(1, -1);
  } else {
    destination = trimmed.match(/^\S+/)?.[0] ?? "";
  }
  if (
    !destination ||
    destination.startsWith("/") ||
    destination.startsWith("#") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(destination)
  ) {
    return null;
  }

  const fragmentFrom = destination.indexOf("#");
  const encodedPath = fragmentFrom < 0 ? destination : destination.slice(0, fragmentFrom);
  const fragment = fragmentFrom < 0 ? null : destination.slice(fragmentFrom);
  let targetText: string;
  try {
    targetText = decodeURIComponent(encodedPath);
  } catch {
    return null;
  }
  if (!/\.(?:md|markdown)$/i.test(targetText)) return null;
  return { targetText, fragment };
}

function resolveMarkdownTarget(
  source: IndexedPage,
  target: string,
  pages: IndexedPage[]
): { status: KnowledgeLinkStatus; page: IndexedPage | null } {
  const normalizedTarget = resolveRelativePath(source.directory, target);
  if (!normalizedTarget) return { status: "unresolved", page: null };
  const matches = pages.filter((page) => page.normalizedPath === normalizedTarget);
  if (matches.length === 1) return { status: "resolved", page: matches[0] };
  if (matches.length > 1) return { status: "ambiguous", page: null };
  return { status: "unresolved", page: null };
}

function maskIgnoredMarkdown(source: string): string {
  const masked = source.split("");
  const mask = (from: number, to: number) => masked.fill(" ", from, to);

  for (const span of scanMarkdownSource(source)) {
    // A span inside a list carries its own `listDepth`, and a deeply nested item's continuation
    // lines are legitimately indented 4+ columns as part of that nesting — not the indented-code
    // grammar this check exists to catch. Judging it anyway masked wiki links out of the knowledge
    // index for any list item past the third level.
    if (span.listDepth === undefined && isMarkdownLinkOpaqueBlockSource(span.raw)) {
      mask(span.from, span.to);
    }
  }

  let offset = 0;
  while (offset < source.length) {
    if (source[offset] !== "`" || masked[offset] === " ") {
      offset += 1;
      continue;
    }
    const openingLength = markerRunLength(source, offset, "`");
    let candidate = offset + openingLength;
    let closingTo = -1;
    while (candidate < source.length) {
      if (source[candidate] !== "`" || masked[candidate] === " ") {
        candidate += 1;
        continue;
      }
      const candidateLength = markerRunLength(source, candidate, "`");
      if (candidateLength === openingLength) {
        closingTo = candidate + candidateLength;
        break;
      }
      candidate += candidateLength;
    }
    if (closingTo < 0) {
      offset += openingLength;
      continue;
    }
    mask(offset, closingTo);
    offset = closingTo;
  }

  // Inline comments are masked last, over the already-masked buffer: an opener
  // that lives inside a fence or a code span is not a comment, and an opener
  // without its own terminator must not swallow the rest of the file.
  const outsideCode = masked.join("");
  let commentFrom = outsideCode.indexOf("<!--");
  while (commentFrom >= 0) {
    const terminator = outsideCode.indexOf("-->", commentFrom + 4);
    if (terminator < 0) break;
    const commentTo = terminator + 3;
    mask(commentFrom, commentTo);
    commentFrom = outsideCode.indexOf("<!--", commentTo);
  }
  return masked.join("");
}

function markerRunLength(source: string, offset: number, marker: string): number {
  let end = offset;
  while (source[end] === marker) end += 1;
  return end - offset;
}

function isEscapedAt(source: string, offset: number): boolean {
  let slashes = 0;
  for (let index = offset - 1; index >= 0 && source[index] === "\\"; index -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function parseWikiTarget(source: string): {
  targetText: string;
  alias: string | null;
  fragment: string | null;
} {
  const pipe = source.indexOf("|");
  const targetWithFragment = (pipe < 0 ? source : source.slice(0, pipe)).trim();
  const alias = pipe < 0 ? null : nonEmptyString(source.slice(pipe + 1));
  const fragmentIndex = targetWithFragment.search(/[\^#]/);
  return {
    targetText: (fragmentIndex < 0
      ? targetWithFragment
      : targetWithFragment.slice(0, fragmentIndex)
    ).trim(),
    alias,
    fragment: fragmentIndex < 0 ? null : targetWithFragment.slice(fragmentIndex),
  };
}

function resolveWikiTarget(
  source: IndexedPage,
  target: string,
  index: WikiIndex<IndexedPage>
): { status: KnowledgeLinkStatus; page: IndexedPage | null } {
  const resolution = resolveWikiCandidates(source.page.path, target, index);
  return { status: resolution.status, page: resolution.page };
}

/** Path and name buckets built once per catalog; each bucket keeps Page order. */
interface WikiIndex<T> {
  byPath: Map<string, T[]>;
  byName: Map<string, T[]>;
}

function buildWikiIndex<T>(
  pages: readonly T[],
  pathOf: (page: T) => string,
  namesOf: (page: T) => ReadonlySet<string>
): WikiIndex<T> {
  const byPath = new Map<string, T[]>();
  const byName = new Map<string, T[]>();
  const bucket = (buckets: Map<string, T[]>, key: string, page: T) => {
    const existing = buckets.get(key);
    if (existing) existing.push(page);
    else buckets.set(key, [page]);
  };
  for (const page of pages) {
    bucket(byPath, normalizePath(pathOf(page), false), page);
    for (const name of namesOf(page)) bucket(byName, name, page);
  }
  return { byPath, byName };
}

function resolveWikiCandidates<T>(
  sourcePath: string,
  target: string,
  index: WikiIndex<T>
): { status: KnowledgeLinkStatus; page: T | null; candidates: T[] } {
  const sourceDirectory = directoryName(normalizePath(sourcePath, false));
  const normalizedTargetPath = resolveRelativePath("", target);
  const relativeTargetPath = resolveRelativePath(sourceDirectory, target);
  const normalizedTarget = normalizedTargetPath
    ? stripMarkdownExtension(normalizedTargetPath)
    : null;
  const relativeTarget = relativeTargetPath ? stripMarkdownExtension(relativeTargetPath) : null;
  const isExplicitRelative = /^(?:\.\.?)(?:[\\/]|$)/.test(target);
  const isQualified = isExplicitRelative || /[\\/]/.test(target);
  const explicitPaths = isExplicitRelative
    ? relativeTarget
      ? [relativeTarget]
      : []
    : isQualified
      ? [normalizedTarget, relativeTarget].filter((path): path is string => path !== null)
      : [relativeTarget, normalizedTarget].filter((path): path is string => path !== null);

  for (const candidate of unique(explicitPaths)) {
    const matches = index.byPath.get(candidate) ?? [];
    if (matches.length === 1) {
      return { status: "resolved", page: matches[0], candidates: [...matches] };
    }
    if (matches.length > 1) return { status: "ambiguous", page: null, candidates: [...matches] };
  }
  if (isQualified) return { status: "unresolved", page: null, candidates: [] };

  if (!normalizedTarget) return { status: "unresolved", page: null, candidates: [] };
  const targetName = normalizeName(baseName(normalizedTarget));
  const named = index.byName.get(targetName) ?? [];
  if (named.length === 1) return { status: "resolved", page: named[0], candidates: [...named] };
  if (named.length > 1) return { status: "ambiguous", page: null, candidates: [...named] };
  return { status: "unresolved", page: null, candidates: [] };
}

function normalizePath(path: string, preserveExtension: boolean): string {
  const segments: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    const segment = part.trim();
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const normalized = segments.join("/").normalize("NFC").toLowerCase();
  return preserveExtension ? normalized : stripMarkdownExtension(normalized);
}

function resolveRelativePath(directory: string, target: string): string | null {
  const segments = directory ? directory.split("/") : [];
  for (const part of target.replaceAll("\\", "/").split("/")) {
    const segment = part.trim();
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/").normalize("NFC").toLowerCase();
}

function stripMarkdownExtension(path: string): string {
  return path.replace(/\.(?:md|markdown)$/i, "");
}

function directoryName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

function baseName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(slash + 1);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeName(value: string): string {
  return value.trim().normalize("NFC").toLowerCase();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function compareLinks(left: KnowledgeLink, right: KnowledgeLink): number {
  return compareText(left.sourcePath, right.sourcePath) || left.range.from - right.range.from;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
