import {
  isMarkdownLinkOpaqueBlockSource,
  scanMarkdownSource,
} from "@/editor/markdown-block/markdown-source-scanner";
import type { DocumentContent, StorageAdapter, WorkspaceEntry } from "@/lib/storage";

export type PageLinkRelocationAdapter = Pick<StorageAdapter, "list" | "read">;
export type PageLinkKind = "wiki" | "markdown";

export interface PageLinkRelocationInput {
  pageId: string;
  fromPath: string;
  toPath: string;
}

export interface FolderLinkRelocationInput {
  fromPath: string;
  toPath: string;
}

export interface PageLinkReplacement {
  kind: PageLinkKind;
  targetId: string;
  range: { from: number; to: number };
  before: string;
  after: string;
}

export interface PageLinkRelocationWrite {
  sourceId: string;
  /** Current workspace path, used for revision preflight. */
  sourcePath: string;
  /** Path at which this Markdown body will live after relocation. */
  destinationPath: string;
  expectedRevision: string;
  markdown: string;
  replacements: PageLinkReplacement[];
}

export interface SkippedPageLink {
  sourceId: string;
  sourcePath: string;
  kind: PageLinkKind;
  targetText: string;
  range: { from: number; to: number };
  reason: "ambiguous" | "cannot-preserve-target" | "unsafe";
}

export interface PageRevisionCheck {
  path: string;
  expectedRevision: string;
}

export interface PageLinkRelocationPlan {
  relocation: {
    pageId: string;
    fromPath: string;
    toPath: string;
    expectedRevision: string;
  };
  writes: PageLinkRelocationWrite[];
  skipped: SkippedPageLink[];
  checks: PageRevisionCheck[];
}

export interface FolderLinkRelocationPage {
  pageId: string;
  sourcePath: string;
  destinationPath: string;
  expectedRevision: string;
}

export interface FolderLinkRelocationPlan {
  relocation: {
    fromPath: string;
    toPath: string;
    pages: FolderLinkRelocationPage[];
  };
  writes: PageLinkRelocationWrite[];
  skipped: SkippedPageLink[];
  checks: PageRevisionCheck[];
}

interface IndexedPage {
  content: DocumentContent;
  id: string;
  path: string;
  authoredTitle: string | null;
  aliases: string[];
}

interface LinkOccurrence {
  kind: PageLinkKind;
  targetText: string;
  targetRange: { from: number; to: number };
  before: string;
  angleWrapped: boolean;
}

interface Resolution {
  status: "resolved" | "unresolved" | "ambiguous";
  page: IndexedPage | null;
  candidates: IndexedPage[];
}

interface PlannedLinkChanges {
  writes: PageLinkRelocationWrite[];
  skipped: SkippedPageLink[];
  checks: PageRevisionCheck[];
}

/**
 * Build a deterministic, zero-write preview for relocating one Markdown Page.
 *
 * Only target-token spans are replaced. Labels, fragments, surrounding
 * whitespace, Wiki aliases, Markdown angle brackets, and all untouched source
 * bytes remain exactly as authored.
 */
export async function planPageLinkRelocation(
  adapter: PageLinkRelocationAdapter,
  input: PageLinkRelocationInput
): Promise<PageLinkRelocationPlan> {
  const fromPath = workspacePath(input.fromPath);
  const toPath = workspacePath(input.toPath);
  if (!fromPath || !isMarkdownPath(fromPath)) {
    throw new Error(
      `Page relocation source must be a workspace-relative Markdown path: ${input.fromPath}`
    );
  }
  if (!toPath || !isMarkdownPath(toPath)) {
    throw new Error(
      `Page relocation destination must be a workspace-relative Markdown path: ${input.toPath}`
    );
  }

  const pages = await readPages(adapter);
  const moved = pages.find((page) => page.id === input.pageId);
  if (!moved) throw new Error(`Page relocation source was not found: ${input.pageId}`);
  if (normalizePath(moved.path, true) !== normalizePath(fromPath, true)) {
    throw new Error(
      `Page relocation source path changed: expected ${fromPath}, found ${moved.path}`
    );
  }
  const collision = pages.find(
    (page) => page.id !== moved.id && normalizePath(page.path, true) === normalizePath(toPath, true)
  );
  if (collision) throw new Error(`Page relocation destination already exists: ${toPath}`);

  const movedRevision = requiredRevision(moved);
  const changes = planLinkChanges(pages, new Map([[moved.id, toPath]]));
  return {
    relocation: {
      pageId: moved.id,
      fromPath,
      toPath,
      expectedRevision: movedRevision,
    },
    ...changes,
  };
}

/**
 * Build a zero-write link-repair preview for moving a complete folder subtree.
 *
 * Every Markdown Page under the source prefix receives a deterministic
 * destination mapping. Links are resolved against both the current and the
 * simulated post-move topology so links internal to the subtree remain
 * byte-for-byte untouched when they still identify the same Page.
 */
export async function planFolderLinkRelocation(
  adapter: PageLinkRelocationAdapter,
  input: FolderLinkRelocationInput
): Promise<FolderLinkRelocationPlan> {
  const fromPath = workspacePath(input.fromPath);
  const toPath = workspacePath(input.toPath);
  if (!fromPath) {
    throw new Error(
      `Folder relocation source must be a workspace-relative path: ${input.fromPath}`
    );
  }
  if (!toPath) {
    throw new Error(
      `Folder relocation destination must be a workspace-relative path: ${input.toPath}`
    );
  }
  const normalizedFrom = normalizePath(fromPath, true);
  const normalizedTo = normalizePath(toPath, true);
  if (normalizedTo === normalizedFrom || normalizedTo.startsWith(`${normalizedFrom}/`)) {
    throw new Error("Folder relocation destination cannot be the source folder or its descendant");
  }

  const pages = await readPages(adapter);
  const destinations = new Map<string, string>();
  for (const page of pages) {
    const suffix = pathWithinFolder(page.path, fromPath);
    if (suffix !== null) destinations.set(page.id, `${toPath}/${suffix}`);
  }

  const destinationOwners = new Map<string, IndexedPage>();
  for (const page of pages) {
    if (destinations.has(page.id)) continue;
    destinationOwners.set(normalizePath(page.path, true), page);
  }
  const plannedDestinations = new Set<string>();
  for (const destinationPath of destinations.values()) {
    const normalizedDestination = normalizePath(destinationPath, true);
    if (
      destinationOwners.has(normalizedDestination) ||
      plannedDestinations.has(normalizedDestination)
    ) {
      throw new Error(`Folder relocation destination already contains a Page: ${destinationPath}`);
    }
    plannedDestinations.add(normalizedDestination);
  }

  const changes = planLinkChanges(pages, destinations);
  return {
    relocation: {
      fromPath,
      toPath,
      pages: pages.flatMap((page) => {
        const destinationPath = destinations.get(page.id);
        return destinationPath
          ? [
              {
                pageId: page.id,
                sourcePath: page.path,
                destinationPath,
                expectedRevision: requiredRevision(page),
              },
            ]
          : [];
      }),
    },
    ...changes,
  };
}

async function readPages(adapter: PageLinkRelocationAdapter): Promise<IndexedPage[]> {
  const entries = (await adapter.list()).filter(isMarkdownPageEntry);
  const pages = await Promise.all(
    entries.map(async (entry) => indexPage(entry, await adapter.read(entry.handle)))
  );
  return pages.sort((left, right) => compareText(left.path, right.path));
}

function planLinkChanges(
  pages: IndexedPage[],
  destinations: ReadonlyMap<string, string>
): PlannedLinkChanges {
  const pathAfterRelocation = (page: IndexedPage) => destinations.get(page.id) ?? page.path;
  const writes: PageLinkRelocationWrite[] = [];
  const skipped: SkippedPageLink[] = [];
  const checks = pages.map((page) => ({
    path: page.path,
    expectedRevision: requiredRevision(page),
  }));

  for (const source of pages) {
    const sourceMoves = destinations.has(source.id);
    const replacements: PageLinkReplacement[] = [];
    for (const occurrence of linkOccurrences(source.content.markdown)) {
      const before = resolveLink(occurrence, source.path, pages, (page) => page.path);
      if (before.status === "ambiguous") {
        if (sourceMoves || before.candidates.some((page) => destinations.has(page.id))) {
          skipped.push(skippedLink(source, occurrence, "ambiguous"));
        }
        continue;
      }
      if (before.status === "unresolved") {
        if (sourceMoves) skipped.push(skippedLink(source, occurrence, "unsafe"));
        continue;
      }
      if (!before.page) continue;

      const target = before.page;
      const targetMoves = destinations.has(target.id);
      if (!sourceMoves && !targetMoves) continue;

      const sourcePathAfter = pathAfterRelocation(source);
      const after = resolveLink(occurrence, sourcePathAfter, pages, pathAfterRelocation);
      if (after.status === "resolved" && after.page?.id === target.id) continue;

      const replacement = replacementTarget(
        occurrence,
        sourcePathAfter,
        pathAfterRelocation(target)
      );
      if (replacement === null) {
        skipped.push(skippedLink(source, occurrence, "cannot-preserve-target"));
        continue;
      }
      if (replacement === occurrence.before) continue;
      const replacementText = replacementTargetText(occurrence.kind, replacement);
      if (replacementText === null) {
        skipped.push(skippedLink(source, occurrence, "cannot-preserve-target"));
        continue;
      }
      const verified = resolveLink(
        { ...occurrence, targetText: replacementText, before: replacement },
        sourcePathAfter,
        pages,
        pathAfterRelocation
      );
      if (verified.status !== "resolved" || verified.page?.id !== target.id) {
        skipped.push(skippedLink(source, occurrence, "cannot-preserve-target"));
        continue;
      }
      replacements.push({
        kind: occurrence.kind,
        targetId: target.id,
        range: occurrence.targetRange,
        before: occurrence.before,
        after: replacement,
      });
    }

    if (!replacements.length) continue;
    replacements.sort((left, right) => left.range.from - right.range.from);
    writes.push({
      sourceId: source.id,
      sourcePath: source.path,
      destinationPath: pathAfterRelocation(source),
      expectedRevision: requiredRevision(source),
      markdown: applyReplacements(source.content.markdown, replacements),
      replacements,
    });
  }

  writes.sort((left, right) => compareText(left.sourcePath, right.sourcePath));
  skipped.sort(
    (left, right) =>
      compareText(left.sourcePath, right.sourcePath) || left.range.from - right.range.from
  );
  return {
    writes,
    skipped,
    checks,
  };
}

function indexPage(entry: WorkspaceEntry, content: DocumentContent): IndexedPage {
  const path = workspacePath(entry.handle.relPath ?? entry.handle.path ?? "");
  if (!path)
    throw new Error(`Markdown Page is missing a workspace-relative path: ${entry.handle.id}`);
  const authoredTitle = nonEmptyString(content.meta?.title);
  const aliases = Array.isArray(content.meta?.aliases)
    ? content.meta.aliases.flatMap((value) => {
        const alias = nonEmptyString(value);
        return alias ? [alias] : [];
      })
    : [];
  return {
    content,
    id: entry.handle.id,
    path,
    authoredTitle,
    aliases,
  };
}

function linkOccurrences(markdown: string): LinkOccurrence[] {
  const searchable = maskIgnoredMarkdown(markdown);
  const occurrences = [
    ...wikiLinkOccurrences(markdown, searchable),
    ...markdownLinkOccurrences(markdown, searchable),
  ];
  return occurrences.sort((left, right) => left.targetRange.from - right.targetRange.from);
}

function wikiLinkOccurrences(markdown: string, searchable: string): LinkOccurrence[] {
  const occurrences: LinkOccurrence[] = [];
  for (const match of searchable.matchAll(/\[\[([^\]\r\n]+)\]\]/g)) {
    if (match.index === undefined) continue;
    if (isEscapedAt(markdown, match.index)) continue;
    const inner = match[1];
    const pipe = inner.indexOf("|");
    const targetAndFragment = pipe < 0 ? inner : inner.slice(0, pipe);
    const leadingWhitespace = targetAndFragment.length - targetAndFragment.trimStart().length;
    const trimmed = targetAndFragment.trim();
    const fragmentFrom = trimmed.search(/[\^#]/);
    const targetPart = fragmentFrom < 0 ? trimmed : trimmed.slice(0, fragmentFrom);
    const targetText = targetPart.trim();
    if (!targetText) continue;
    const targetOffset = match.index + 2 + leadingWhitespace + targetPart.indexOf(targetText);
    occurrences.push({
      kind: "wiki",
      targetText,
      targetRange: { from: targetOffset, to: targetOffset + targetText.length },
      before: markdown.slice(targetOffset, targetOffset + targetText.length),
      angleWrapped: false,
    });
  }
  return occurrences;
}

function markdownLinkOccurrences(markdown: string, searchable: string): LinkOccurrence[] {
  const occurrences: LinkOccurrence[] = [];
  const pattern = /\[([^\]\r\n]*)\]\((<[^>\r\n]+>|[^)\r\n]+)\)/g;
  for (const match of searchable.matchAll(pattern)) {
    if (match.index === undefined || searchable[match.index - 1] === "!") continue;
    if (isEscapedAt(markdown, match.index)) continue;
    const destination = match[2];
    const parsed = parseMarkdownDestination(destination);
    if (!parsed) continue;
    const destinationFrom = match.index + match[0].indexOf("](") + 2;
    const targetFrom = destinationFrom + parsed.targetOffset;
    occurrences.push({
      kind: "markdown",
      targetText: parsed.targetText,
      targetRange: { from: targetFrom, to: targetFrom + parsed.rawPath.length },
      before: markdown.slice(targetFrom, targetFrom + parsed.rawPath.length),
      angleWrapped: parsed.angleWrapped,
    });
  }
  return occurrences;
}

function parseMarkdownDestination(source: string): {
  targetText: string;
  targetOffset: number;
  rawPath: string;
  angleWrapped: boolean;
} | null {
  const leadingWhitespace = source.length - source.trimStart().length;
  const trimmed = source.trim();
  const angleWrapped = trimmed.startsWith("<");
  let rawDestination: string;
  let targetOffset: number;
  if (angleWrapped) {
    if (!trimmed.endsWith(">")) return null;
    rawDestination = trimmed.slice(1, -1);
    targetOffset = leadingWhitespace + 1;
  } else {
    rawDestination = trimmed.match(/^\S+/)?.[0] ?? "";
    targetOffset = leadingWhitespace;
  }
  if (
    !rawDestination ||
    rawDestination.startsWith("/") ||
    rawDestination.startsWith("#") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(rawDestination)
  ) {
    return null;
  }

  const fragmentFrom = rawDestination.indexOf("#");
  const rawPath = fragmentFrom < 0 ? rawDestination : rawDestination.slice(0, fragmentFrom);
  let targetText: string;
  try {
    targetText = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (!isMarkdownPath(targetText)) return null;
  return { targetText, targetOffset, rawPath, angleWrapped };
}

function resolveLink(
  occurrence: LinkOccurrence,
  sourcePath: string,
  pages: IndexedPage[],
  pathOf: (page: IndexedPage) => string
): Resolution {
  return occurrence.kind === "wiki"
    ? resolveWikiTarget(occurrence.targetText, sourcePath, pages, pathOf)
    : resolveMarkdownTarget(occurrence.targetText, sourcePath, pages, pathOf);
}

function resolveWikiTarget(
  target: string,
  sourcePath: string,
  pages: IndexedPage[],
  pathOf: (page: IndexedPage) => string
): Resolution {
  const sourceDirectory = directoryName(normalizePath(sourcePath, false));
  const normalizedTarget = normalizePath(target, false);
  const relativeTarget = joinPath(sourceDirectory, target);
  const isExplicitRelative = /^(?:\.\.?)(?:[\\/]|$)/.test(target);
  const isQualified = isExplicitRelative || /[\\/]/.test(target);
  const explicitPaths = isExplicitRelative
    ? [relativeTarget]
    : isQualified
      ? [normalizedTarget, relativeTarget]
      : [relativeTarget, normalizedTarget];

  for (const candidate of unique(explicitPaths)) {
    const matches = pages.filter((page) => normalizePath(pathOf(page), false) === candidate);
    if (matches.length === 1) return resolved(matches[0]);
    if (matches.length > 1) return ambiguous(matches);
  }
  if (isQualified) return unresolved();

  const targetName = normalizeName(baseName(normalizedTarget));
  const named = pages.filter((page) => pageNames(page, pathOf(page)).has(targetName));
  if (named.length === 1) return resolved(named[0]);
  if (named.length > 1) return ambiguous(named);
  return unresolved();
}

function resolveMarkdownTarget(
  target: string,
  sourcePath: string,
  pages: IndexedPage[],
  pathOf: (page: IndexedPage) => string
): Resolution {
  const directory = directoryName(normalizePath(sourcePath, true));
  const normalizedTarget = resolveRelativePath(directory, target);
  if (!normalizedTarget) return unresolved();
  const matches = pages.filter((page) => normalizePath(pathOf(page), true) === normalizedTarget);
  if (matches.length === 1) return resolved(matches[0]);
  if (matches.length > 1) return ambiguous(matches);
  return unresolved();
}

function replacementTarget(
  occurrence: LinkOccurrence,
  sourcePath: string,
  targetPath: string
): string | null {
  const originalExtension = markdownExtension(occurrence.targetText);
  const actualExtension = markdownExtension(targetPath);
  const targetWithoutExtension = stripMarkdownExtension(targetPath);
  const lexicalTargetPath =
    occurrence.kind === "wiki"
      ? originalExtension
        ? `${targetWithoutExtension}${originalExtension}`
        : targetWithoutExtension
      : `${targetWithoutExtension}${
          originalExtension.toLowerCase() === actualExtension.toLowerCase()
            ? originalExtension
            : actualExtension
        }`;
  let relative = relativePath(directoryName(sourcePath), lexicalTargetPath);
  if (
    relative.indexOf("/") < 0 &&
    /^\.\//.test(occurrence.targetText) &&
    !relative.startsWith(".")
  ) {
    relative = `./${relative}`;
  }
  if (occurrence.kind === "wiki" && /[\]|#^]/.test(relative)) return null;

  const mustEncode =
    /%[0-9A-Fa-f]{2}/.test(occurrence.before) || (!occurrence.angleWrapped && /\s/.test(relative));
  return mustEncode ? encodeMarkdownPath(relative) : relative;
}

function replacementTargetText(kind: PageLinkKind, replacement: string): string | null {
  if (kind === "wiki") return replacement;
  try {
    return decodeURIComponent(replacement);
  } catch {
    return null;
  }
}

function skippedLink(
  source: IndexedPage,
  occurrence: LinkOccurrence,
  reason: SkippedPageLink["reason"]
): SkippedPageLink {
  return {
    sourceId: source.id,
    sourcePath: source.path,
    kind: occurrence.kind,
    targetText: occurrence.targetText,
    range: occurrence.targetRange,
    reason,
  };
}

function applyReplacements(markdown: string, replacements: PageLinkReplacement[]): string {
  let result = markdown;
  let previousFrom = markdown.length;
  for (const replacement of [...replacements].sort(
    (left, right) => right.range.from - left.range.from
  )) {
    if (replacement.range.to > previousFrom) {
      throw new Error("Page link relocation produced overlapping source ranges");
    }
    if (markdown.slice(replacement.range.from, replacement.range.to) !== replacement.before) {
      throw new Error("Page link relocation source range no longer matches its expected bytes");
    }
    result =
      result.slice(0, replacement.range.from) +
      replacement.after +
      result.slice(replacement.range.to);
    previousFrom = replacement.range.from;
  }
  return result;
}

function maskIgnoredMarkdown(source: string): string {
  const masked = source.split("");
  const mask = (from: number, to: number) => masked.fill(" ", from, to);
  for (const span of scanMarkdownSource(source)) {
    if (isMarkdownLinkOpaqueBlockSource(span.raw)) {
      mask(span.from, span.to);
    }
  }

  let commentFrom = source.indexOf("<!--");
  while (commentFrom >= 0) {
    const terminator = source.indexOf("-->", commentFrom + 4);
    const commentTo = terminator < 0 ? source.length : terminator + 3;
    mask(commentFrom, commentTo);
    if (terminator < 0) break;
    commentFrom = source.indexOf("<!--", commentTo);
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

function isMarkdownPageEntry(entry: WorkspaceEntry): boolean {
  if (entry.kind !== "document") return false;
  const path = entry.handle.relPath ?? entry.handle.path ?? entry.name;
  const documentType = entry.documentType ?? entry.handle.documentType;
  if (documentType !== undefined && documentType !== "markdown") return false;
  return isMarkdownPath(path) && !/\.doxmind(?:\.|$)/i.test(baseName(path));
}

function requiredRevision(page: IndexedPage): string {
  const revision = nonEmptyString(page.content.revision);
  if (!revision) throw new Error(`Markdown Page is missing a source revision: ${page.path}`);
  return revision;
}

function pageNames(page: IndexedPage, path: string): Set<string> {
  return new Set(
    [
      stripMarkdownExtension(baseName(path)),
      ...(page.authoredTitle ? [page.authoredTitle] : []),
      ...page.aliases,
    ].map(normalizeName)
  );
}

function resolved(page: IndexedPage): Resolution {
  return { status: "resolved", page, candidates: [page] };
}

function ambiguous(candidates: IndexedPage[]): Resolution {
  return { status: "ambiguous", page: null, candidates };
}

function unresolved(): Resolution {
  return { status: "unresolved", page: null, candidates: [] };
}

function workspacePath(path: string): string | null {
  if (!path || path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) return null;
  const segments: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    const segment = part.trim();
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length ? segments.join("/").normalize("NFC") : null;
}

function pathWithinFolder(path: string, folder: string): string | null {
  const pathSegments = path.split("/");
  const folderSegments = folder.split("/");
  if (
    pathSegments.length <= folderSegments.length ||
    folderSegments.some(
      (segment, index) => normalizeName(segment) !== normalizeName(pathSegments[index])
    )
  ) {
    return null;
  }
  return pathSegments.slice(folderSegments.length).join("/");
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

function joinPath(directory: string, target: string): string {
  return normalizePath(directory ? `${directory}/${target}` : target, false);
}

function relativePath(sourceDirectory: string, targetPath: string): string {
  const source = workspacePath(sourceDirectory)?.split("/") ?? [];
  const target = workspacePath(targetPath)?.split("/") ?? [];
  let common = 0;
  while (
    common < source.length &&
    common < target.length &&
    normalizeName(source[common]) === normalizeName(target[common])
  ) {
    common += 1;
  }
  return [...source.slice(common).map(() => ".."), ...target.slice(common)].join("/");
}

function encodeMarkdownPath(path: string): string {
  return encodeURI(path).replaceAll("#", "%23").replaceAll("?", "%3F");
}

function markdownExtension(path: string): string {
  return path.match(/\.(?:md|markdown)$/i)?.[0] ?? "";
}

function isMarkdownPath(path: string): boolean {
  return /\.(?:md|markdown)$/i.test(path);
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

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
