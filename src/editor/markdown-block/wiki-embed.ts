import { Lexer, type Token } from "marked";

import { MarkdownBlockDocument } from "@/editor/markdown-block/markdown-block-document";
import {
  resolveKnowledgeWikiPage,
  type KnowledgeSourceCatalog,
  type KnowledgeSourcePage,
} from "@/lib/knowledge-index";

export type WikiEmbedFragment =
  { kind: "heading"; value: string } | { kind: "block"; value: string };

export interface WikiEmbedReference {
  target: string;
  label: string | null;
  fragment: WikiEmbedFragment | null;
}

export const WIKI_EMBED_MAX_DEPTH = 8;

export type WikiEmbedProjectionStatus =
  "resolved" | "unresolved" | "ambiguous" | "missing-fragment" | "cycle" | "depth-exceeded";

export interface WikiEmbedProjection {
  reference: WikiEmbedReference;
  status: WikiEmbedProjectionStatus;
  target: KnowledgeSourcePage | null;
  markdown: string | null;
  identity: string | null;
}

export interface ResolveWikiEmbedOptions {
  depth: number;
  ancestry: readonly string[];
  maxDepth?: number;
}

/** Parse an embed only when the complete source block is one wiki-embed expression. */
export function parseWikiEmbedBlock(source: string): WikiEmbedReference | null {
  const match = source.match(/^!\[\[([^\]\r\n]+)\]\][ \t]*(?:(?:\r\n|\n|\r)[ \t]*)*$/);
  if (!match) return null;

  const pipe = match[1].indexOf("|");
  const targetWithFragment = (pipe < 0 ? match[1] : match[1].slice(0, pipe)).trim();
  const label = pipe < 0 ? null : nonEmpty(match[1].slice(pipe + 1));
  const fragmentOffset = targetWithFragment.search(/[#^]/);
  const target = (
    fragmentOffset < 0 ? targetWithFragment : targetWithFragment.slice(0, fragmentOffset)
  ).trim();
  if (!target) return null;
  if (fragmentOffset < 0) return { target, label, fragment: null };

  const fragmentSource = targetWithFragment.slice(fragmentOffset);
  const blockFragment = fragmentSource.startsWith("^") || fragmentSource.startsWith("#^");
  const value = fragmentSource
    .slice(blockFragment && fragmentSource.startsWith("#^") ? 2 : 1)
    .trim();
  if (!value) return null;
  return {
    target,
    label,
    fragment: {
      kind: blockFragment ? "block" : "heading",
      value,
    },
  };
}

/**
 * Project a target Page body without converting or rewriting its Markdown source.
 * Block fragments intentionally fail closed until stable source-anchor semantics exist.
 */
export function projectWikiEmbedBody(
  markdownBody: string,
  fragment: WikiEmbedFragment | null
): string | null {
  if (fragment === null) return markdownBody;
  if (fragment.kind === "block") return projectWikiEmbedBlock(markdownBody, fragment.value);

  const normalizedSource = normalizeSourceLineEndings(markdownBody);
  const headings = sourceHeadings(normalizedSource.markdown);
  const requestedTitle = normalizeHeadingTitle(fragment.value);
  if (!requestedTitle) return null;
  const matches = headings.filter(
    (heading) => heading.atx && heading.normalizedTitle === requestedTitle
  );
  if (matches.length !== 1) return null;

  const match = matches[0];
  const nextBoundary = headings.find(
    (heading) => heading.from > match.from && heading.level <= match.level
  );
  const from = normalizedSource.originalOffsets[match.from];
  const to =
    normalizedSource.originalOffsets[nextBoundary?.from ?? normalizedSource.markdown.length];
  return markdownBody.slice(from, to);
}

/**
 * Resolve one source expression against a complete read-only knowledge scan.
 * Recursion state is explicit so the UI Adapter cannot accidentally loop.
 */
export function resolveWikiEmbed(
  index: KnowledgeSourceCatalog,
  sourcePath: string,
  source: string,
  options: ResolveWikiEmbedOptions
): WikiEmbedProjection | null {
  const reference = parseWikiEmbedBlock(source);
  if (!reference) return null;

  const resolution = resolveKnowledgeWikiPage(index.pages, sourcePath, reference.target);
  if (resolution.status !== "resolved" || !resolution.page) {
    return {
      reference,
      status: resolution.status,
      target: null,
      markdown: null,
      identity: null,
    };
  }

  const target = index.sourcePages.find((page) => page.id === resolution.page?.id) ?? null;
  if (!target) {
    return { reference, status: "unresolved", target: null, markdown: null, identity: null };
  }

  const identity = wikiEmbedIdentity(target.id, reference.fragment);
  if (options.ancestry.includes(identity)) {
    return { reference, status: "cycle", target, markdown: null, identity };
  }
  if (options.depth > (options.maxDepth ?? WIKI_EMBED_MAX_DEPTH)) {
    return { reference, status: "depth-exceeded", target, markdown: null, identity };
  }
  const markdown = projectWikiEmbedBody(target.markdown, reference.fragment);
  if (markdown === null) {
    return { reference, status: "missing-fragment", target, markdown: null, identity };
  }
  return { reference, status: "resolved", target, markdown, identity };
}

const PORTABLE_BLOCK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const BLOCK_ID_SOURCE = /^([\s\S]*?)[ \t]+\^([A-Za-z0-9][A-Za-z0-9_-]*)[ \t]*$/;

/** Resolve one unique Obsidian-compatible block anchor without rewriting its Page. */
function projectWikiEmbedBlock(markdownBody: string, requestedId: string): string | null {
  if (!PORTABLE_BLOCK_ID.test(requestedId)) return null;
  const matches: string[] = [];
  for (const block of MarkdownBlockDocument.fromMarkdown(markdownBody).getSnapshot().blocks) {
    if (block.kind === "fenced_code" || block.kind === "mermaid" || block.kind === "block_math") {
      continue;
    }
    const trailing = block.raw.match(/(?:(?:\r\n|\n|\r))*$/)?.[0] ?? "";
    const source = trailing ? block.raw.slice(0, -trailing.length) : block.raw;
    const anchor = BLOCK_ID_SOURCE.exec(source);
    if (!anchor || anchor[2] !== requestedId) continue;
    matches.push(`${anchor[1]}${trailing}`);
  }
  return matches.length === 1 ? matches[0] : null;
}

export function wikiEmbedIdentity(pageId: string, fragment: WikiEmbedFragment | null): string {
  const suffix = fragment
    ? `${fragment.kind}:${fragment.value.trim().normalize("NFC").toLowerCase()}`
    : "page";
  return `${pageId}\u0000${suffix}`;
}

interface SourceHeading {
  from: number;
  level: number;
  atx: boolean;
  normalizedTitle: string;
}

function sourceHeadings(markdown: string): SourceHeading[] {
  const headings: SourceHeading[] = [];
  let from = 0;
  for (const token of Lexer.lex(markdown, { gfm: true })) {
    if (token.type === "heading") {
      const heading = token as Token & {
        depth: number;
        tokens: Token[];
      };
      headings.push({
        from,
        level: heading.depth,
        atx: /^ {0,3}#{1,6}(?:[ \t]+|(?:\n|$))/.test(token.raw),
        normalizedTitle: normalizeHeadingTitle(inlineText(heading.tokens)),
      });
    }
    from += token.raw.length;
  }
  return headings;
}

function normalizeHeadingTitle(source: string): string {
  return inlineText(Lexer.lexInline(source, { gfm: true }))
    .trim()
    .normalize("NFC")
    .toLowerCase();
}

function inlineText(tokens: readonly Token[]): string {
  return tokens
    .map((token) => {
      if (token.type === "html") return "";
      if (token.type === "br") return "\n";
      if ("tokens" in token && Array.isArray(token.tokens)) return inlineText(token.tokens);
      return "text" in token && typeof token.text === "string" ? token.text : "";
    })
    .join("");
}

function normalizeSourceLineEndings(source: string): {
  markdown: string;
  originalOffsets: number[];
} {
  let markdown = "";
  let offset = 0;
  const originalOffsets = [0];
  while (offset < source.length) {
    if (source[offset] === "\r") {
      offset += source[offset + 1] === "\n" ? 2 : 1;
      markdown += "\n";
    } else {
      markdown += source[offset];
      offset += 1;
    }
    originalOffsets.push(offset);
  }
  return { markdown, originalOffsets };
}

function nonEmpty(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}
