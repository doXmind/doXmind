/**
 * Block-level Markdown source preservation (Path X, issue #149).
 *
 * TipTap's document model is a ProseMirror node tree; `getMarkdown()` re-emits
 * the whole tree, so even blocks the user never touched get reformatted
 * (tables re-padded, `_x_` -> `*x*`, lists re-indented, raw HTML flattened).
 *
 * This extension makes the round-trip faithful for UNTOUCHED blocks. On load it
 * captures, per top-level block, the original Markdown bytes plus the block's
 * serialization. On save it matches current blocks to the originals by
 * serialization (an order-aware LCS); a match emits the original bytes
 * verbatim, and only edited/new blocks are re-serialized.
 *
 * The baseline is SELF-VALIDATED at load: it is only enabled if replaying it
 * against the freshly loaded document reproduces the original body exactly.
 * If the body can't be aligned to the document 1:1 (e.g. a raw-HTML block that
 * imports to several nodes), the baseline is discarded and serialization falls
 * back to TipTap's default — so the worst case is today's behaviour, never
 * corruption.
 */

import { Extension } from "@tiptap/core";
import { marked } from "marked";

import { escapeMarkdownText } from "@/lib/markdown";

export interface SourceBlock {
  /** Original Markdown bytes of the block, including its trailing blank line(s). */
  raw: string;
  /** Serialization of the block when last written — used to detect "unchanged". */
  norm: string;
}

interface TextNodeJson {
  type?: string;
  text?: string;
  marks?: Array<string | { type?: string }>;
  content?: TextNodeJson[];
}

interface MarkdownManager {
  serialize: (doc: unknown) => string;
  /** @tiptap/markdown internals — see `installTextEscaper`. */
  codeTypes?: Set<string>;
  encodeTextForMarkdown?: (text: string, node: TextNodeJson, parentNode?: TextNodeJson) => string;
}

interface SourcePreservationStorage {
  baseline: SourceBlock[] | null;
}

function getManager(editor: { storage: unknown }): MarkdownManager | null {
  const storage = editor.storage as Record<string, unknown>;
  const md = storage.markdown as { manager?: MarkdownManager } | undefined;
  return md?.manager ?? null;
}

/** Serialize one ProseMirror node (JSON) to Markdown via the shared manager. */
function serializeNode(manager: MarkdownManager, nodeJson: unknown): string {
  return manager.serialize({ type: "doc", content: [nodeJson] });
}

/**
 * Serialize the document's top-level nodes, dropping any that serialize to
 * nothing — chiefly the empty trailing paragraph the TrailingNode extension
 * keeps for editing UX, which has no counterpart in the Markdown source.
 */
function serializableBlocks(
  nodes: unknown[],
  manager: MarkdownManager
): Array<{ node: unknown; serialized: string }> {
  const blocks: Array<{ node: unknown; serialized: string }> = [];
  for (const node of nodes) {
    const serialized = serializeNode(manager, node);
    if (serialized.trim() === "") continue;
    blocks.push({ node, serialized });
  }
  return blocks;
}

export function stripFrontmatter(md: string): string {
  if (md.startsWith("---\n")) {
    const end = md.indexOf("\n---", 4);
    if (end !== -1) {
      const after = md.indexOf("\n", end + 1);
      if (after !== -1) return md.slice(after + 1);
    }
  }
  return md;
}

/**
 * Split a Markdown body into top-level blocks, each carrying its trailing
 * whitespace so concatenating every entry reproduces the body byte-for-byte.
 * Uses the markdown manager's own lexer so block boundaries match parsing.
 */
export function lexSourceBlocks(
  body: string,
  lexer: (md: string) => Array<{ type: string; raw: string }>
): string[] {
  const tokens = lexer(body);
  const raws: string[] = [];
  let leading = "";
  // A `<details>` (toggle) or `<div data-columns>` (columns) block becomes a
  // single editor node, but marked emits it as several tokens (open tag, inner
  // markdown, close tag). Merge those back into one source block so block
  // counts line up with the document and the whole structure round-trips.
  const tagBalance = (s: string) => {
    const opens = (s.match(/<(?:details|div)(?=[\s>/])/gi) || []).length;
    const closes = (s.match(/<\/(?:details|div)>/gi) || []).length;
    return opens - closes;
  };
  let group: string | null = null;
  let depth = 0;
  for (const token of tokens) {
    if (token.type === "space") {
      if (group !== null) group += token.raw;
      else if (raws.length) raws[raws.length - 1] += token.raw;
      else leading += token.raw;
      continue;
    }
    if (group !== null) {
      group += token.raw;
      depth += tagBalance(token.raw);
      if (depth <= 0) {
        raws.push(group);
        group = null;
        depth = 0;
      }
      continue;
    }
    if (token.type === "html") {
      const balance = tagBalance(token.raw);
      if (balance > 0) {
        group = leading + token.raw;
        leading = "";
        depth = balance;
        continue;
      }
    }
    raws.push(leading + token.raw);
    leading = "";
  }
  if (group !== null) raws.push(group); // unbalanced container — flush as-is
  return raws;
}

/**
 * Order-aware LCS between baseline blocks and current document blocks, keyed on
 * `norm`. Matched current blocks emit the original `raw`; unmatched (new or
 * edited) blocks emit their fresh serialization. Returns the assembled Markdown
 * plus a refreshed baseline reflecting exactly what was emitted, so the next
 * save preserves against the bytes just written.
 */
export function preserveSerialize(
  baseline: SourceBlock[],
  current: Array<{ norm: string; serialized: string }>
): { output: string; nextBaseline: SourceBlock[] } {
  const n = baseline.length;
  const m = current.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        baseline[i].norm === current[j].norm
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const parts: string[] = [];
  const nextBaseline: SourceBlock[] = [];
  let i = 0;
  let j = 0;
  // A block emitted straight after the file's last block would otherwise be
  // glued to it by that block's single trailing newline, merging two paragraphs
  // (or absorbing the new block into a list) when the `.md` is reopened without
  // its sidecar. Pad the preceding part to a blank line — and mirror the pad
  // into nextBaseline, so the next save preserves against the bytes written.
  const padPreviousToBlankLine = () => {
    const last = parts.length - 1;
    if (last < 0) return;
    const trailing = /\n*$/.exec(parts[last])![0].length;
    if (trailing >= 2) return;
    const padded = parts[last].slice(0, parts[last].length - trailing) + "\n\n";
    parts[last] = padded;
    nextBaseline[last].raw = padded;
  };
  const emitFresh = (serialized: string, norm: string) => {
    padPreviousToBlankLine();
    const raw = serialized + "\n\n";
    parts.push(raw);
    nextBaseline.push({ raw, norm });
  };
  while (i < n && j < m) {
    if (baseline[i].norm === current[j].norm) {
      parts.push(baseline[i].raw);
      nextBaseline.push({ raw: baseline[i].raw, norm: current[j].norm });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++; // baseline block deleted from the document — drop it
    } else {
      emitFresh(current[j].serialized, current[j].norm);
      j++;
    }
  }
  while (j < m) {
    emitFresh(current[j].serialized, current[j].norm);
    j++;
  }
  return { output: parts.join(""), nextBaseline };
}

/**
 * Build a self-validated baseline from the original body and the freshly loaded
 * document nodes. Returns null when the body can't be aligned 1:1 to the
 * document or when replaying the baseline wouldn't reproduce the body exactly.
 */
export function buildBaseline(
  body: string | null | undefined,
  loadedNodes: unknown[],
  manager: MarkdownManager,
  lexer: (md: string) => Array<{ type: string; raw: string }>
): SourceBlock[] | null {
  if (!body) return null;
  const stripped = stripFrontmatter(body);
  if (!stripped.trim()) return null;

  const raws = lexSourceBlocks(stripped, lexer);
  const blocks = serializableBlocks(loadedNodes, manager);
  // A block-for-block mapping only exists when counts match. Anything else
  // (raw HTML expanding to several nodes, etc.) disables preservation.
  if (raws.length !== blocks.length || raws.length === 0) return null;

  const baseline: SourceBlock[] = raws.map((raw, k) => ({
    raw,
    norm: blocks[k].serialized,
  }));

  // Self-validate: replaying the baseline against the loaded document must
  // reproduce the original body. Only then is preservation provably faithful.
  const current = blocks.map((b) => ({ norm: b.serialized, serialized: b.serialized }));
  const { output } = preserveSerialize(baseline, current);
  if (output.replace(/\n+$/, "") !== stripped.replace(/\n+$/, "")) return null;

  return baseline;
}

/**
 * Swap @tiptap/markdown's HTML-entity-only text encoder for a markdown escaper.
 *
 * Text nodes never reach an extension's `renderMarkdown` — the manager returns
 * their encoding directly — so patching the per-editor manager instance is the
 * only hook. Code context is re-derived from the manager's own `codeTypes` set;
 * text there must stay verbatim.
 */
function installTextEscaper(manager: MarkdownManager): void {
  const original = manager.encodeTextForMarkdown;
  if (typeof original !== "function") return;

  manager.encodeTextForMarkdown = (text, node, parentNode) => {
    const codeTypes = manager.codeTypes;
    if (!codeTypes) return original.call(manager, text, node, parentNode);
    const inCode =
      (!!parentNode?.type && codeTypes.has(parentNode.type)) ||
      (node.marks ?? []).some((m) => codeTypes.has(typeof m === "string" ? m : (m.type ?? "")));
    if (inCode) return text;

    // Leading-marker escapes only apply where a line actually begins: the first
    // text of a paragraph, or the text right after a hard break. Headings, list
    // markers and quote prefixes are emitted by their own handlers, so their
    // text is never column zero.
    const siblings = parentNode?.content;
    const index = siblings ? siblings.indexOf(node) : -1;
    const atLineStart =
      parentNode?.type === "paragraph" &&
      (index === 0 || (index > 0 && siblings![index - 1]?.type === "hardBreak"));

    return escapeMarkdownText(text, atLineStart);
  };
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    sourcePreservation: {
      /** Capture the original Markdown source of the freshly loaded document. */
      setSourceBaseline: (body: string | null | undefined) => ReturnType;
    };
  }
}

export const SourcePreservation = Extension.create({
  name: "sourcePreservation",

  addStorage(): SourcePreservationStorage {
    return { baseline: null };
  },

  addCommands() {
    return {
      setSourceBaseline:
        (body: string | null | undefined) =>
        ({ editor }) => {
          const storage = this.storage as SourcePreservationStorage;
          try {
            const manager = getManager(editor);
            if (!manager) {
              storage.baseline = null;
              return true;
            }
            const nodes = (editor.getJSON().content ?? []) as unknown[];
            const lexer = (md: string) => marked.lexer(md) as Array<{ type: string; raw: string }>;
            storage.baseline = buildBaseline(body, nodes, manager, lexer);
          } catch {
            storage.baseline = null;
          }
          return true;
        },
    };
  },

  // Wrap getMarkdown in onBeforeCreate (synchronous, during construction) —
  // `onCreate` fires asynchronously, so callers serializing right after load
  // would otherwise miss the wrap. @tiptap/markdown assigns getMarkdown in its
  // own onBeforeCreate, which runs first because Markdown precedes this
  // extension in the list.
  onBeforeCreate() {
    const editor = this.editor;
    const name = this.name;
    const original = editor.getMarkdown?.bind(editor);
    if (!original) return;

    const escaperManager = getManager(editor);
    if (escaperManager) installTextEscaper(escaperManager);

    editor.getMarkdown = () => {
      try {
        // Read storage fresh each call — the object set by `setSourceBaseline`
        // is the one on the editor, not whatever was captured at onCreate.
        const storage = (editor.storage as unknown as Record<string, SourcePreservationStorage>)[
          name
        ];
        const baseline = storage?.baseline;
        const manager = getManager(editor);
        if (!baseline || baseline.length === 0 || !manager) return original();

        const nodes = (editor.getJSON().content ?? []) as unknown[];
        const current = serializableBlocks(nodes, manager).map((b) => ({
          norm: b.serialized,
          serialized: b.serialized,
        }));
        const { output, nextBaseline } = preserveSerialize(baseline, current);
        storage.baseline = nextBaseline;
        return output;
      } catch {
        return original();
      }
    };
  },
});
