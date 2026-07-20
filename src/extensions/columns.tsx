import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

export interface ColumnsOptions {
  HTMLAttributes: Record<string, unknown>;
}

/** Matches the `column{2,5}` content expression. */
const MIN_COLUMNS = 2;
const MAX_COLUMNS = 5;

/** Percent of the row a column can never be dragged below. */
const MIN_COLUMN_PERCENT = 10;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    columns: {
      setColumns: (count?: number) => ReturnType;
      addLayoutColumn: (columnsPos: number) => ReturnType;
      removeLayoutColumn: (columnsPos: number, index: number) => ReturnType;
      setLayoutColumnWidths: (columnsPos: number, widths: number[]) => ReturnType;
    };
  }
}

/**
 * Normalize a proposed split: clamp every column to a usable minimum, then
 * scale the rest so the row still adds up to 100. Without the clamp a divider
 * drag can shrink a column to nothing and strand the content inside it.
 */
function clampWidths(widths: number[]): number[] {
  const count = widths.length;
  if (count === 0) return widths;

  const slack = 100 - MIN_COLUMN_PERCENT * count;
  if (slack <= 0) return widths.map(() => Math.round(100 / count));

  const floored = widths.map((w) => Math.max(MIN_COLUMN_PERCENT, w));
  const excess = floored.reduce((sum, w) => sum + w - MIN_COLUMN_PERCENT, 0);
  // Every column already sat at or below the minimum, so there is no excess to
  // distribute proportionally — dividing by it would make every width NaN and
  // the row would render with no columns at all.
  if (excess === 0) return floored.map(() => Math.round(100 / count));
  const scaled = floored.map((w) =>
    Math.round(MIN_COLUMN_PERCENT + ((w - MIN_COLUMN_PERCENT) / excess) * slack)
  );

  // Rounding leaves a point or two unaccounted for; give it to the widest.
  const drift = 100 - scaled.reduce((sum, w) => sum + w, 0);
  if (drift !== 0) scaled[scaled.indexOf(Math.max(...scaled))] += drift;
  return scaled;
}

/** The split currently in effect, filling in an even share for unset columns. */
function currentWidths(columns: ProseMirrorNode): number[] {
  const even = 100 / columns.childCount;
  const widths: number[] = [];
  columns.forEach((column) => {
    const width = column.attrs.width as number | null;
    widths.push(typeof width === "number" ? width : even);
  });
  return widths;
}

function writeWidths(tr: Transaction, columnsPos: number, widths: (number | null)[]): void {
  const columns = tr.doc.nodeAt(columnsPos);
  if (!columns) return;

  let offset = columnsPos + 1;
  columns.forEach((column, _nodeOffset, index) => {
    const width = widths[index] ?? null;
    if (column.attrs.width !== width) {
      tr.setNodeMarkup(offset, undefined, { ...column.attrs, width });
    }
    offset += column.nodeSize;
  });
}

/**
 * Drop every explicit width and re-sync `columnCount`. A split chosen for N
 * columns means nothing once N changes, and guessing a redistribution reads as
 * the layout drifting on its own.
 */
function resetToEvenSplit(tr: Transaction, columnsPos: number): void {
  const columns = tr.doc.nodeAt(columnsPos);
  if (!columns) return;

  writeWidths(tr, columnsPos, new Array(columns.childCount).fill(null));
  tr.setNodeMarkup(columnsPos, undefined, { ...columns.attrs, columnCount: columns.childCount });
}

function addColumn(tr: Transaction, columnsPos: number): boolean {
  const columns = tr.doc.nodeAt(columnsPos);
  if (!columns || columns.childCount >= MAX_COLUMNS) return false;

  const column = tr.doc.type.schema.nodes.column.createAndFill();
  if (!column) return false;

  tr.insert(columnsPos + 1 + columns.content.size, column);
  resetToEvenSplit(tr, columnsPos);
  return true;
}

/**
 * The removed column's blocks are appended to the neighbour that takes over its
 * space, so nothing the user wrote leaves the document.
 */
function removeColumn(tr: Transaction, columnsPos: number, index: number): boolean {
  const columns = tr.doc.nodeAt(columnsPos);
  if (!columns || columns.childCount <= MIN_COLUMNS) return false;
  if (index < 0 || index >= columns.childCount) return false;

  const removed = columns.child(index);
  const absorbingIndex = index === 0 ? 1 : index - 1;
  const kept: ProseMirrorNode[] = [];

  columns.forEach((column, _nodeOffset, childIndex) => {
    if (childIndex === index) return;
    if (childIndex !== absorbingIndex) {
      kept.push(column);
      return;
    }
    const merged =
      index === 0 ? removed.content.append(column.content) : column.content.append(removed.content);
    kept.push(column.type.create(column.attrs, merged));
  });

  tr.replaceWith(columnsPos + 1, columnsPos + 1 + columns.content.size, kept);
  resetToEvenSplit(tr, columnsPos);
  return true;
}

/**
 * Column node — a single column within a Columns container.
 * Not a standalone block; only valid as a child of `columns`.
 */
export const Column = Node.create({
  name: "column",

  content: "block+",

  isolating: true,

  defining: true,

  addAttributes() {
    return {
      width: {
        default: null,
        parseHTML: (element) => {
          const width = Number(element.getAttribute("data-column"));
          return Number.isFinite(width) && width > 0 ? width : null;
        },
        renderHTML: (attributes) => {
          if (typeof attributes.width !== "number") return { "data-column": "" };
          return {
            "data-column": String(attributes.width),
            // Overrides the stylesheet's `flex: 1`, which only sets flex-grow.
            style: `flex-grow: ${attributes.width}`,
          };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-column]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { class: "column" }), 0];
  },

  renderMarkdown(node, h) {
    if (!node.content) return "";
    const width = node.attrs?.width;
    const open = typeof width === "number" ? `<div data-column="${width}">` : "<div data-column>";
    return open + "\n\n" + h.renderChildren(node.content, "\n\n") + "\n\n</div>";
  },
});

/**
 * Columns node — a flex container holding 2–5 Column children.
 * Inserted via `/2 columns`, `/3 columns`, etc. slash commands.
 */
export const Columns = Node.create<ColumnsOptions>({
  name: "columns",

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  group: "block",

  content: `column{${MIN_COLUMNS},${MAX_COLUMNS}}`,

  defining: true,

  renderMarkdown(node, h) {
    const count = (node.attrs?.columnCount as number) || 2;
    if (!node.content) return "";
    const childContent = h.renderChildren(node.content, "\n\n");
    return `<div data-columns="${count}">\n\n${childContent}\n\n</div>`;
  },

  addAttributes() {
    return {
      columnCount: {
        default: 2,
        parseHTML: (element) => parseInt(element.getAttribute("data-columns") || "2", 10),
        renderHTML: (attributes) => ({
          "data-columns": attributes.columnCount,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-columns]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: "columns-wrapper",
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setColumns:
        (count = 2) =>
        ({ commands }) => {
          const columns = Array.from({ length: count }, () => ({
            type: "column",
            content: [{ type: "paragraph" }],
          }));
          return commands.insertContent({
            type: this.name,
            attrs: { columnCount: count },
            content: columns,
          });
        },

      addLayoutColumn:
        (columnsPos) =>
        ({ state, tr, dispatch }) => {
          if (state.doc.nodeAt(columnsPos)?.type.name !== this.name) return false;
          if (!dispatch) return canAddColumn(state.doc.nodeAt(columnsPos));
          if (!addColumn(tr, columnsPos)) return false;
          dispatch(tr);
          return true;
        },

      removeLayoutColumn:
        (columnsPos, index) =>
        ({ state, tr, dispatch }) => {
          if (state.doc.nodeAt(columnsPos)?.type.name !== this.name) return false;
          if (!dispatch) return canRemoveColumn(state.doc.nodeAt(columnsPos));
          if (!removeColumn(tr, columnsPos, index)) return false;
          dispatch(tr);
          return true;
        },

      setLayoutColumnWidths:
        (columnsPos, widths) =>
        ({ state, tr, dispatch }) => {
          const columns = state.doc.nodeAt(columnsPos);
          if (columns?.type.name !== this.name) return false;
          if (widths.length !== columns.childCount) return false;

          if (dispatch) {
            writeWidths(tr, columnsPos, clampWidths(widths));
            dispatch(tr);
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [layoutControlsPlugin(this.name)];
  },

  addKeyboardShortcuts() {
    return {
      // Backspace at the start of the first block in the first column → unwrap all
      Backspace: () => {
        const { state } = this.editor;
        const { selection } = state;
        const { $from } = selection;

        // Need depth >= 3: doc > columns > column > block
        if ($from.depth < 3) return false;

        // Check if we're inside a column → columns structure
        const columnNode = $from.node(-1);
        const columnsNode = $from.node(-2);

        if (columnsNode?.type.name !== this.name || columnNode?.type.name !== "column") {
          return false;
        }

        // Only if cursor is at the very start (offset 0) of the current block
        if ($from.parentOffset !== 0) return false;

        // Only if we're in the first block of the first column
        const columnPos = $from.before(-1);
        const columnsPos = $from.before(-2);
        const firstColumnPos = columnsPos + 1;
        const firstBlockPos = firstColumnPos + 1;

        if (columnPos !== firstColumnPos || $from.before() !== firstBlockPos) {
          return false;
        }

        // Unwrap: collect all content from all columns and replace the columns node
        const { tr } = state;
        const columnsStart = columnsPos;
        const columnsEnd = columnsPos + columnsNode.nodeSize;

        // Gather all child blocks from all columns
        const blocks: ProseMirrorNode[] = [];
        columnsNode.forEach((col) => {
          col.forEach((block) => {
            blocks.push(block);
          });
        });

        // Replace the columns node with flattened content
        tr.replaceWith(columnsStart, columnsEnd, blocks);
        this.editor.view.dispatch(tr);
        return true;
      },
    };
  },
});

function canAddColumn(columns: ProseMirrorNode | null | undefined): boolean {
  return !!columns && columns.childCount < MAX_COLUMNS;
}

function canRemoveColumn(columns: ProseMirrorNode | null | undefined): boolean {
  return !!columns && columns.childCount > MIN_COLUMNS;
}

const layoutControlsKey = new PluginKey("columnsLayoutControls");

/**
 * Renders the divider handles between columns and the add/remove controls after
 * the last one. Widget decorations place them in the flex row as siblings of
 * the columns, so the columns stay plain contenteditable children and no node
 * view is needed. The widgets style themselves inline because they exist only
 * while the editor is live and never reach the saved document.
 */
function layoutControlsPlugin(typeName: string): Plugin {
  return new Plugin({
    key: layoutControlsKey,
    props: {
      decorations(state) {
        const decorations: Decoration[] = [];

        state.doc.descendants((node, pos) => {
          if (node.type.name !== typeName) return true;

          let offset = pos + 1;
          node.forEach((column, _nodeOffset, index) => {
            offset += column.nodeSize;
            if (index === node.childCount - 1) return;
            decorations.push(
              Decoration.widget(offset, (view) => dividerHandle(view, pos, index), {
                side: -1,
                key: `columns-divider-${index}`,
              })
            );
          });

          decorations.push(
            Decoration.widget(offset, (view) => layoutControls(view, pos), {
              side: 1,
              key: `columns-controls-${node.childCount}`,
            })
          );
          return true;
        });

        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}

/** Chromeless glyph button; visible enough to find, quiet enough to ignore. */
function controlButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.title = title;
  button.contentEditable = "false";
  button.style.cssText =
    "width:18px;height:18px;line-height:1;display:flex;align-items:center;justify-content:center;" +
    "border:none;border-radius:4px;background:transparent;color:inherit;cursor:pointer;" +
    "opacity:0.35;transition:opacity 0.15s ease,background-color 0.15s ease";
  button.addEventListener("mouseenter", () => {
    button.style.opacity = "1";
    button.style.backgroundColor = "rgba(127,127,127,0.18)";
  });
  button.addEventListener("mouseleave", () => {
    button.style.opacity = "0.35";
    button.style.backgroundColor = "transparent";
  });
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    onClick();
  });
  return button;
}

function layoutControls(view: EditorView, columnsPos: number): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.contentEditable = "false";
  wrapper.style.cssText =
    "flex:0 0 auto;display:flex;flex-direction:column;gap:2px;align-self:flex-start;" +
    "margin-left:-0.5rem;user-select:none";

  const columns = view.state.doc.nodeAt(columnsPos);
  if (canAddColumn(columns)) {
    wrapper.appendChild(
      controlButton("+", "Add column", () => {
        const tr = view.state.tr;
        if (addColumn(tr, columnsPos)) view.dispatch(tr);
      })
    );
  }
  if (canRemoveColumn(columns)) {
    const lastIndex = (columns?.childCount ?? 1) - 1;
    wrapper.appendChild(
      controlButton("−", "Remove last column", () => {
        const tr = view.state.tr;
        if (removeColumn(tr, columnsPos, lastIndex)) view.dispatch(tr);
      })
    );
  }
  return wrapper;
}

/**
 * The divider between two columns. Dragging repaints flex-grow live and commits
 * one transaction on release, so a drag costs a single undo step rather than one
 * per pointer move.
 */
function dividerHandle(view: EditorView, columnsPos: number, index: number): HTMLElement {
  const handle = document.createElement("div");
  handle.contentEditable = "false";
  handle.style.cssText =
    "flex:0 0 3px;align-self:stretch;margin:0 -0.5rem;border-radius:2px;cursor:col-resize;" +
    "background:transparent;transition:background-color 0.15s ease";
  handle.addEventListener("mouseenter", () => {
    handle.style.backgroundColor = "rgba(127,127,127,0.4)";
  });
  handle.addEventListener("mouseleave", () => {
    handle.style.backgroundColor = "transparent";
  });

  handle.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;

    const row = handle.parentElement;
    const columns = view.state.doc.nodeAt(columnsPos);
    if (!row || !columns) return;

    // The narrow breakpoint stacks the columns; a horizontal drag means nothing.
    if (getComputedStyle(row).flexDirection === "column") return;

    const rowWidth = row.getBoundingClientRect().width;
    if (rowWidth <= 0) return;

    event.preventDefault();

    const columnEls = Array.from(row.children).filter((child) =>
      child.classList.contains("column")
    ) as HTMLElement[];
    const startWidths = currentWidths(columns);
    const startX = event.clientX;
    let latest = startWidths;

    const onMove = (moveEvent: MouseEvent) => {
      const delta = ((moveEvent.clientX - startX) / rowWidth) * 100;
      const next = startWidths.slice();
      next[index] = startWidths[index] + delta;
      next[index + 1] = startWidths[index + 1] - delta;
      latest = clampWidths(next);
      latest.forEach((width, i) => {
        const el = columnEls[i];
        if (el) el.style.flexGrow = String(width);
      });
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const target = view.state.doc.nodeAt(columnsPos);
      if (!target || target.childCount !== latest.length) return;

      const tr = view.state.tr;
      writeWidths(tr, columnsPos, latest);
      if (tr.docChanged) view.dispatch(tr);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  return handle;
}
