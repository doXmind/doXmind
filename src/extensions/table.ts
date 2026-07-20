import { Table as BaseTable } from "@tiptap/extension-table";
import type { JSONContent } from "@tiptap/core";
import { columnResizing, columnResizingPluginKey } from "@tiptap/pm/tables";

/**
 * GFM table serializer.
 *
 * Replaces the upstream one, which is unsafe for a file-backed editor: it joins
 * the blocks of a multi-block cell with a raw U+001F, and it never escapes a
 * literal `|` in cell text. Both land verbatim in the user's portable `.md` —
 * the control character is not valid GFM at all, and an unescaped pipe splits
 * the row into extra columns when the file is reopened.
 *
 * The emitted layout (padded columns, minimum three dashes) matches upstream so
 * that adopting this serializer does not rewrite existing tables.
 */

type Align = "left" | "right" | "center" | null;

/** A cell's blocks collapse to one line; GFM has no multi-line cell syntax. */
const CELL_LINE_SEPARATOR = "<br>";
const TRAILING_BREAK = /<br\s*\/?>$/i;
const LEADING_BREAK = /^<br\s*\/?>/i;

/**
 * Join a cell's blocks onto one line.
 *
 * A hand-written `<br>` inside a cell parses back as its own raw-HTML block, so
 * separating unconditionally would add a break either side of it and the cell
 * would grow a break on every open/save cycle. Skipping the separator where the
 * content already carries one keeps the serializer idempotent.
 */
function joinCellBlocks(parts: string[]): string {
  return parts.reduce((acc, part) => {
    if (!acc) return part;
    if (TRAILING_BREAK.test(acc) || LEADING_BREAK.test(part)) return acc + part;
    return acc + CELL_LINE_SEPARATOR + part;
  }, "");
}

function normalizeAlign(value: unknown): Align {
  return value === "left" || value === "right" || value === "center" ? value : null;
}

function collapseWhitespace(s: string): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

/**
 * A pipe is the row delimiter, so it has to be escaped everywhere in cell text
 * — including inside code spans, where GFM still reads it as a delimiter.
 */
function escapeCellText(s: string): string {
  return s.replace(/\|/g, "\\|");
}

export const Table = BaseTable.extend({
  /**
   * Upstream gates the resize plugin on `editor.isEditable` — read once, at
   * construction. A disk-backed document mounts read-only and is unlocked a
   * frame later, so every file opened from disk lost column resizing for the
   * whole session. The plugin's own handlers re-check `view.editable` on each
   * event, so installing it unconditionally is safe in a read-only editor.
   */
  addProseMirrorPlugins() {
    const plugins = this.parent?.() ?? [];
    if (!this.options.resizable) return plugins;
    if (plugins.some((plugin) => plugin.spec.key === columnResizingPluginKey)) return plugins;

    return [
      columnResizing({
        handleWidth: this.options.handleWidth,
        cellMinWidth: this.options.cellMinWidth,
        defaultCellMinWidth: this.options.cellMinWidth,
        View: this.options.View,
        lastColumnResizable: this.options.lastColumnResizable,
      }),
      ...plugins,
    ];
  },

  /** The resize plugin supplies the table node view; a second one would fight it. */
  addNodeView() {
    if (this.options.resizable) return null;
    return this.parent?.() ?? null;
  },

  renderMarkdown(node: JSONContent, h): string {
    const rowNodes = node?.content;
    if (!rowNodes || rowNodes.length === 0) return "";

    const rows = rowNodes.map((rowNode) =>
      (rowNode.content ?? []).map((cellNode) => {
        const blocks = cellNode.content ?? [];
        const raw =
          blocks.length > 1
            ? joinCellBlocks(blocks.map((child) => h.renderChildren(child).trim()))
            : h.renderChildren(blocks);
        return {
          text: escapeCellText(collapseWhitespace(raw)),
          isHeader: cellNode.type === "tableHeader",
          align: normalizeAlign(cellNode.attrs?.align),
        };
      })
    );

    const columnCount = rows.reduce((max, r) => Math.max(max, r.length), 0);
    if (columnCount === 0) return "";

    const colWidths = Array.from({ length: columnCount }, (_, i) =>
      Math.max(3, ...rows.map((r) => r[i]?.text.length ?? 0))
    );
    const colAlignments = Array.from(
      { length: columnCount },
      (_, i) => rows.find((r) => r[i]?.align)?.[i]?.align ?? null
    );

    const pad = (s: string, width: number) => s + " ".repeat(Math.max(0, width - s.length));
    const renderRow = (cells: string[]) =>
      `| ${cells.map((t, i) => pad(t, colWidths[i])).join(" | ")} |\n`;

    const headerRow = rows[0];
    const hasHeader = headerRow.some((c) => c.isHeader);

    let out = "\n";
    out += renderRow(
      Array.from({ length: columnCount }, (_, i) => (hasHeader ? (headerRow[i]?.text ?? "") : ""))
    );
    out += `| ${colWidths
      .map((w, i) => {
        const dashes = "-".repeat(Math.max(3, w));
        if (colAlignments[i] === "left") return `:${dashes}`;
        if (colAlignments[i] === "right") return `${dashes}:`;
        if (colAlignments[i] === "center") return `:${dashes}:`;
        return dashes;
      })
      .join(" | ")} |\n`;

    for (const r of hasHeader ? rows.slice(1) : rows) {
      out += renderRow(Array.from({ length: columnCount }, (_, i) => r[i]?.text ?? ""));
    }

    return out;
  },
});
