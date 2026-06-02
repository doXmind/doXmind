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

export interface SourceBlock {
  /** Original Markdown bytes of the block, including its trailing blank line(s). */
  raw: string;
  /** Serialization of the block when last written — used to detect "unchanged". */
  norm: string;
}

interface MarkdownManager {
  serialize: (doc: unknown) => string;
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
  for (const token of tokens) {
    if (token.type === "space") {
      if (raws.length) raws[raws.length - 1] += token.raw;
      else leading += token.raw;
      continue;
    }
    raws.push(leading + token.raw);
    leading = "";
  }
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
  const emitFresh = (serialized: string, norm: string) => {
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
