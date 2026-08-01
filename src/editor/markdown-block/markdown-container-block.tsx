"use client";

import {
  ChevronRight,
  Info,
  Lightbulb,
  MessageSquareWarning,
  OctagonAlert,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { InPlaceBlockProps } from "@/editor/markdown-block/in-place-block";
import { projectMarkdownInline } from "@/editor/markdown-block/markdown-inline-projection";
import { SemanticInlineEditor } from "@/editor/markdown-block/semantic-inline-editor";

export type MarkdownContainerKind = "callout" | "toggle";

/**
 * A callout or a toggle, split into the two pieces of text a person actually writes.
 *
 * Both kinds are a box with a one-line heading and a body, and in both the heading and the body are
 * buried in scaffolding: a callout wraps every line in a `>` prefix and opens with a `[!TYPE]`
 * marker, a toggle wraps its body in `<details>`/`<summary>` tags and the blank lines those tags
 * need in order for the Markdown between them to be parsed as Markdown at all. None of that is the
 * user's text, and the editor used to show all of it the moment the Block was clicked.
 *
 * `withHeading` and `withBody` are the whole reason this Interface exists. They take the text a
 * surface produced and give back the Block's complete source with everything else — the marker, the
 * prefix on every untouched line, the blank scaffolding lines, the closing tag, and the line
 * terminators, CRLF included — byte for byte as it was. A line whose text did not change is copied
 * out of the original rather than re-rendered from its parts, because re-rendering normalises: a
 * body line written `>Tight` would come back as `> Tight`, and a Page would gain a diff on every
 * keystroke in an unrelated line.
 */
export interface MarkdownContainer {
  readonly kind: MarkdownContainerKind;
  /** `NOTE`, `TIP`, … for a callout. Empty for a toggle, which has no type. */
  readonly type: string;
  /** The callout's inline title or the toggle's summary. Always exactly one line. */
  readonly heading: string;
  /** Every body line, stripped of its `>` prefix or of the `<details>` scaffolding around it. */
  readonly body: string;
  /** Whether the source wrote `<details open>`. Always false for a callout. */
  readonly open: boolean;
  withHeading(next: string): string;
  withBody(next: string): string;
  /**
   * The same source with a different callout type. Absent on a toggle, which has no type.
   *
   * `type` was readable and unwritable, so every callout in the app was permanently whatever the file
   * said and there was no way to change one.
   */
  withType?(next: string): string;
  /**
   * The container's text with the container taken off — no `>` prefix, no `[!TYPE]`, no `<details>`
   * scaffolding. What Backspace at the very start produces, in both reference products: the first
   * press strips the styling and leaves the words, and only a second one merges upward.
   */
  withoutContainer(): string;
}

interface SourceLine {
  readonly raw: string;
  /** The terminator that follows this line, empty on the last one. */
  readonly ending: string;
}

/**
 * Parse a Block's source into its container parts, or null when it is not one.
 *
 * Exported so a caller can decide whether to mount this component at all, the way the row already
 * asks for a table's geometry before mounting the grid. A source that fails to parse must keep
 * whatever fallback the caller has, not render an empty box.
 */
export function parseMarkdownContainer(
  kind: MarkdownContainerKind,
  source: string
): MarkdownContainer | null {
  return kind === "callout" ? parseCalloutSource(source) : parseToggleSource(source);
}

const CALLOUT_PREFIX = /^ {0,3}>[ \t]?/;
// The `[+-]` fold marker is captured on its own as well as inside the whole marker, because a
// rewritten header is assembled from the parts around the type and would otherwise leave it out.
const CALLOUT_HEADER = /^(\[!([A-Za-z][A-Za-z0-9_-]*)\]([+-]?))(?:([ \t]+)(.*))?$/;
const TOGGLE_OPENING = /^ {0,3}<details(?:[ \t]+open)?[ \t]*>$/i;
const TOGGLE_CLOSING = /^ {0,3}<\/details[ \t]*>$/i;
const TOGGLE_SUMMARY = /^( {0,3}<summary>)(.*)(<\/summary>[ \t]*)$/i;

function parseCalloutSource(source: string): MarkdownContainer | null {
  const lines = splitSourceLines(source);
  const prefix = CALLOUT_PREFIX.exec(lines[0].raw)?.[0] ?? "";
  const header = CALLOUT_HEADER.exec(lines[0].raw.slice(prefix.length));
  if (!header) return null;

  const marker = header[1];
  const fold = header[3];
  const gap = header[4] ?? "";
  const title = header[5] ?? "";
  const fallbackEnding = firstLineEnding(source);
  const bodyOf = (line: SourceLine) =>
    line.raw.slice(CALLOUT_PREFIX.exec(line.raw)?.[0].length ?? 0);

  // The prefix a rewritten body line gets: the one that line already had, or failing that the one
  // the line before it had, so a callout indented by two spaces keeps its indentation when the user
  // adds a line to it rather than snapping back to column zero.
  const prefixFor = (index: number): string => {
    const template = lines[index + 1] ?? lines[lines.length - 1] ?? lines[0];
    const own = CALLOUT_PREFIX.exec(template.raw)?.[0] ?? "> ";
    return own.replace(/[ \t]+$/, "");
  };

  return {
    kind: "callout",
    type: header[2].toUpperCase(),
    heading: title,
    body: lines.slice(1).map(bodyOf).join("\n"),
    open: false,
    withHeading(next) {
      const flat = flattenToOneLine(next);
      // Dropping the gap along with the title is what keeps `> [!NOTE] ` from being left behind with
      // a trailing space nobody typed once the title is deleted.
      const rewritten = flat ? `${prefix}${marker}${gap || " "}${flat}` : `${prefix}${marker}`;
      return rewritten + source.slice(lines[0].raw.length);
    },
    withType(next) {
      // The fold marker comes back with the new type. It is the only part of the header this app
      // does not itself honour, so losing it changed nothing on screen and silently rewrote a byte
      // the user's other editor reads as "start collapsed".
      const rewritten = `${prefix}[!${next.toUpperCase()}]${fold}${gap}${title}`;
      return rewritten + source.slice(lines[0].raw.length);
    },
    withoutContainer() {
      // Title and body as plain lines, each keeping its own line so a callout with both does not glue
      // two sentences together. A blank body line is dropped: a bare `>` was scaffolding, not an
      // empty paragraph anyone typed, and keeping it would split the result into two Blocks.
      const kept = [title, ...lines.slice(1).map(bodyOf)].filter((text) => text.trim().length > 0);
      return joinSourceLines(
        (kept.length > 0 ? kept : [""]).map((raw, index) => ({
          raw,
          ending: lines[index]?.ending ?? "",
        })),
        fallbackEnding
      );
    },
    withBody(next) {
      const contents = next.length === 0 ? [] : next.split("\n");
      const rebuilt: SourceLine[] = [lines[0]];
      contents.forEach((content, index) => {
        const original = lines[index + 1];
        if (original && bodyOf(original) === content) {
          rebuilt.push(original);
          return;
        }
        const quote = prefixFor(index);
        rebuilt.push({
          // A blank line keeps a bare `>`. Writing `> ` instead would put trailing whitespace in the
          // file on every empty line, and two of those in a row are a Markdown hard break.
          raw: content.length === 0 ? quote : `${quote} ${content}`,
          ending: original?.ending ?? "",
        });
      });
      return joinSourceLines(rebuilt, fallbackEnding);
    },
  };
}

function parseToggleSource(source: string): MarkdownContainer | null {
  const lines = splitSourceLines(source);
  if (lines.length < 3) return null;
  if (!TOGGLE_OPENING.test(lines[0].raw)) return null;
  if (!TOGGLE_CLOSING.test(lines[lines.length - 1].raw)) return null;
  const summary = TOGGLE_SUMMARY.exec(lines[1].raw);
  if (!summary) return null;

  // The blank line under `<summary>` and the blank line over `</details>` are not body text: they
  // are what makes a Markdown parser treat the lines between them as Markdown instead of as raw
  // HTML. Showing them to the user as two empty lines they can delete would break the toggle
  // silently, so they are held aside here and put back verbatim.
  let bodyFrom = 2;
  let bodyTo = lines.length - 1;
  const lead = bodyFrom < bodyTo && lines[bodyFrom].raw.trim() === "" ? lines[bodyFrom++] : null;
  const tail = bodyFrom < bodyTo && lines[bodyTo - 1].raw.trim() === "" ? lines[--bodyTo] : null;
  const bodyLines = lines.slice(bodyFrom, bodyTo);
  const fallbackEnding = firstLineEnding(source);
  const blank = (): SourceLine => ({ raw: "", ending: "" });

  return {
    kind: "toggle",
    type: "",
    heading: summary[2],
    body: bodyLines.map((line) => line.raw).join("\n"),
    open: /[ \t]open[ \t]*>$/i.test(lines[0].raw),
    withHeading(next) {
      const rebuilt = [...lines];
      rebuilt[1] = {
        raw: `${summary[1]}${flattenToOneLine(next)}${summary[3]}`,
        ending: lines[1].ending,
      };
      return joinSourceLines(rebuilt, fallbackEnding);
    },
    withoutContainer() {
      // Summary and body as plain lines. The `<details>` and `<summary>` tags go, and so do the
      // blank lines at the two ends — but not the ones between two body paragraphs. Those are the
      // user's, and are the whole of what makes two paragraphs two Blocks: dropping them turned a
      // summary and two paragraphs into one run-on paragraph with hard line breaks, on one press,
      // with undo the only way back. The blank line between the summary and the body is put back for
      // the same reason: the summary was its own Block, not the first line of the first paragraph.
      const kept = withoutBlankEnds([summary[2], "", ...bodyLines.map((line) => line.raw)]);
      return joinSourceLines(
        (kept.length > 0 ? kept : [""]).map((raw, index) => ({
          raw,
          ending: lines[index + 1]?.ending ?? "",
        })),
        fallbackEnding
      );
    },
    withBody(next) {
      const contents = next.length === 0 ? [] : next.split("\n");
      // A toggle whose body is being written for the first time has no scaffolding to preserve, so
      // it gets some. Adding it unconditionally would instead rewrite a toggle the user had
      // deliberately written without blank lines the moment they touched its text.
      const creating = bodyLines.length === 0 && contents.length > 0;
      const rebuilt: SourceLine[] = [lines[0], lines[1]];
      if (lead) rebuilt.push(lead);
      else if (creating) rebuilt.push(blank());
      contents.forEach((content, index) => {
        const original = lines[bodyFrom + index];
        rebuilt.push(
          original && original.raw === content
            ? original
            : { raw: content, ending: original?.ending ?? "" }
        );
      });
      if (contents.length > 0) {
        if (tail) rebuilt.push(tail);
        else if (creating) rebuilt.push(blank());
      }
      rebuilt.push(lines[lines.length - 1]);
      return joinSourceLines(rebuilt, fallbackEnding);
    },
  };
}

/** The same lines without the blank ones at either end. */
function withoutBlankEnds(lines: readonly string[]): string[] {
  const kept = [...lines];
  while (kept.length > 0 && kept[0].trim().length === 0) kept.shift();
  while (kept.length > 0 && kept[kept.length - 1].trim().length === 0) kept.pop();
  return kept;
}

function splitSourceLines(source: string): SourceLine[] {
  // Split on a capturing group so the terminator each line actually used survives. Splitting on the
  // union of terminators and re-joining with `\n` rewrites every line of a CRLF file, which turns
  // one edited character into a diff the size of the Block.
  const parts = source.split(/(\r\n|\n|\r)/);
  const lines: SourceLine[] = [];
  for (let index = 0; index < parts.length; index += 2) {
    lines.push({ raw: parts[index], ending: parts[index + 1] ?? "" });
  }
  return lines;
}

/**
 * Reassemble lines, using each line's own terminator and the file's for any line that is new.
 *
 * The last line's terminator is deliberately dropped: a Block's editor source never carries its
 * trailing separator, and re-adding one here would append a blank line to the Page every time the
 * Block was edited.
 */
function joinSourceLines(lines: readonly SourceLine[], fallbackEnding: string): string {
  return lines
    .map((line, index) =>
      index === lines.length - 1 ? line.raw : line.raw + (line.ending || fallbackEnding)
    )
    .join("");
}

function firstLineEnding(source: string): string {
  return /\r\n|\n|\r/.exec(source)?.[0] ?? "\n";
}

/** A callout title and a toggle summary each live on one line, so a pasted newline cannot stay. */
function flattenToOneLine(value: string): string {
  return value.replace(/\r\n|\n|\r/g, " ");
}

/** Menu order, GitHub's own: the five alert types a portable callout can be. */
const CALLOUT_TYPE_ORDER = ["note", "tip", "important", "warning", "caution"] as const;

const CALLOUT_STYLES: Record<
  string,
  { icon: LucideIcon; label: string; container: string; accent: string }
> = {
  note: {
    icon: Info,
    label: "Note",
    container: "border-sky-500/25 bg-sky-500/[0.06]",
    accent: "text-sky-600 dark:text-sky-400",
  },
  tip: {
    icon: Lightbulb,
    label: "Tip",
    container: "border-emerald-500/25 bg-emerald-500/[0.06]",
    accent: "text-emerald-600 dark:text-emerald-400",
  },
  important: {
    icon: MessageSquareWarning,
    label: "Important",
    container: "border-violet-500/25 bg-violet-500/[0.06]",
    accent: "text-violet-600 dark:text-violet-400",
  },
  warning: {
    icon: TriangleAlert,
    label: "Warning",
    container: "border-amber-500/25 bg-amber-500/[0.06]",
    accent: "text-amber-600 dark:text-amber-500",
  },
  caution: {
    icon: OctagonAlert,
    label: "Caution",
    container: "border-red-500/25 bg-red-500/[0.06]",
    accent: "text-red-600 dark:text-red-400",
  },
};

/** The heading is a callout's title or a toggle's summary; the body is everything under it. */
type ContainerRegion = "heading" | "body";

interface ActiveRegion {
  readonly region: ContainerRegion;
  /**
   * `"start"`, `"end"`, an offset into that region's own text, or a range.
   *
   * A range is what a press-drag-release leaves behind. Activating with a collapsed caret at the
   * press point threw the drag away, so selecting a word in a callout or a toggle you were not
   * already editing selected nothing at all — the same defect the prose kinds had.
   */
  readonly caret:
    "start" | "end" | number | { readonly anchor: number; readonly head: number } | null;
}

export interface MarkdownContainerBlockProps extends InPlaceBlockProps {
  readonly kind: MarkdownContainerKind;
  /**
   * Render the toggle's body as read-only nested Blocks.
   *
   * A toggle can hold headings, lists and tables, and only the caller knows how to draw those. When
   * it is not supplied the body falls back to a line-per-line inline rendering, which is correct for
   * the prose a toggle usually holds and wrong for a list.
   */
  readonly renderBody?: (markdown: string) => ReactNode;
}

const EDITOR_CLASS =
  "native-block-editor-surface native-block-textarea block w-full whitespace-pre-wrap break-words bg-transparent outline-none";

/**
 * The one character that makes an empty last line of a body a place the caret can be.
 *
 * Chrome will not put a caret after a text node's trailing newline. Measured in the packaged app: a
 * caret asked for at the end of `aaa\n` reports a zero-height rect at 0,0 and the browser silently
 * snaps it back to the end of `aaa`, so pressing Enter at the end of a callout or a toggle body
 * looked like it had done nothing — the box did not grow, no caret was anywhere on screen — and the
 * next character was typed onto the line above, while the line itself had already gone into the
 * file. Nothing in CSS moves it: `pre`, `pre-wrap`, `break-spaces` and a `::after` all lay the empty
 * line out and none of them lets the caret into it. Only a character after the newline does.
 *
 * It is added to what is drawn, never to what is written. `withoutTrailingAnchor` takes it off again
 * before every commit, and the rendering keeps it under `aria-hidden`, so no byte of it can reach
 * the file and no offset in the region shifts because of it.
 */
const TRAILING_LINE_ANCHOR = "\u200b";

/**
 * A callout or a toggle that stays a callout or a toggle while it is being edited.
 *
 * Clicking either of these used to replace the whole box with a textarea holding its raw source, so
 * a callout showed `> [!NOTE]` on the first line and a `>` down the left of every other one, and a
 * toggle showed `<details>`, `<summary>` and `</details>`. The box, its border, its icon and its
 * disclosure triangle all disappeared for as long as the caret was in it. This component is mounted
 * at one position in the row's tree in both states, so the box is never torn down and none of that
 * can happen: the only thing activation changes is which of the two text surfaces inside it is a
 * rich text editor rather than a rendering.
 *
 * Exactly one of the two regions holds an editor at a time. Two editors would mean two elements
 * carrying `data-native-block-editor`, and the runtime, the caret restore and the test matrix all
 * assume there is one per Block; the table solved the same problem the same way, with one active
 * cell.
 *
 * A region is addressed by name rather than by source offset, for the reason the table addresses a
 * cell by row and column: every offset after an edit shifts, so an offset-addressed active region
 * would drift out of the region it named as soon as the user typed.
 */
export function MarkdownContainerBlock({
  blockId,
  kind,
  source,
  editable,
  onChange,
  onKeyDown,
  renderInline,
  renderBody,
}: MarkdownContainerBlockProps) {
  const [active, setActive] = useState<ActiveRegion | null>(null);
  // Which region a press landed on, recorded before the Block is active.
  //
  // The press is what activates the Block, so `editable` is still false while it is being handled
  // and a handler guarded on it records nothing. A ref rather than state, because it has to survive
  // the render activation causes without causing one of its own.
  const pendingRegionRef = useRef<ContainerRegion | null>(null);
  /** Where a press began, so its release can be read as a range rather than a caret. */
  const dragOriginRef = useRef<{
    region: ContainerRegion;
    text: string;
    at: number;
    x: number;
    y: number;
  } | null>(null);
  const pendingCaretRef = useRef<ActiveRegion["caret"]>(null);

  const container = parseMarkdownContainer(kind, source);

  // Whether the disclosure is open is view state, not document state. `<details open>` in the file
  // is only the initial value, and reading a toggle must not rewrite the user's Markdown. The
  // override is kept across edits — clearing it whenever `source` changed, which is what the
  // preview did, snapped a toggle shut on the first keystroke once its summary became editable in
  // place — and dropped only when the file's own flag moves under it, which is an undo or a
  // reload rather than a keystroke.
  const sourceOpen = container?.open ?? false;
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  useEffect(() => setOpenOverride(null), [blockId, sourceOpen]);
  const open = openOverride ?? sourceOpen;

  // A callout normally has no inline title — `> [!NOTE]` on its own line above the prose is the
  // GitHub form — so landing in the heading would put the caret in an empty region above the text
  // the user is looking at. The body is where a paragraph's caret would go.
  const defaultRegion: ContainerRegion =
    kind === "callout" && (container?.body.length ?? 0) > 0 ? "body" : "heading";

  // A Block that is active must always own an editing surface: the runtime, the tests and the
  // caret-restore machinery all look for one.
  useEffect(() => {
    if (!editable) {
      setActive(null);
      return;
    }
    if (active !== null) return;
    const region = pendingRegionRef.current;
    const caret = pendingCaretRef.current;
    pendingRegionRef.current = null;
    pendingCaretRef.current = null;
    setActive({ region: region ?? defaultRegion, caret });
  }, [editable, active, defaultRegion]);

  // The caret directive is one-shot. It is a prop of the editor, so leaving it set re-applies it on
  // every render — and a render happens on every keystroke, which pins the caret to the position
  // the press landed on and makes typing come out backwards.
  useEffect(() => {
    if (active === null || active.caret === null) return;
    setActive({ region: active.region, caret: null });
  }, [active]);

  if (!container) return null;

  const { heading, body } = container;
  // The body as both surfaces draw it: one whose last line is empty gets an anchor on that line, or
  // neither the line nor a caret on it would be drawn at all.
  const anchoredBody = body.endsWith("\n") ? body + TRAILING_LINE_ANCHOR : body;
  // A closed disclosure does not lay its body out, so an editor mounted in it cannot take focus.
  // Resolving the region here rather than letting it stand keeps the promise that an active Block
  // has exactly one focused editing surface.
  const bodyReachable = kind === "callout" || open;
  // Whether a body is actually drawn under the heading. A callout with no body draws no body line,
  // and a collapsed toggle draws nothing at all under its summary, so in both of those the down
  // arrow has nowhere inside the Block to land and belongs to the Block instead.
  const bodyOnScreen = kind === "callout" ? body.length > 0 : open;
  const activeRegion: ContainerRegion | null = !editable
    ? null
    : active === null
      ? null
      : active.region === "body" && !bodyReachable
        ? "heading"
        : active.region;
  const caret = active?.caret ?? null;

  const commit = (next: string) => {
    if (next === source) return;
    onChange(blockId, next);
  };

  /** A commit that stops this Block being a container, so the row has to re-place the caret. */
  const commitLeavingContainer = (next: string, caret: number) => {
    if (next === source) return;
    onChange(blockId, next, { surfaceChanges: true, caret });
  };

  const focusRegion = (region: ContainerRegion, at: ActiveRegion["caret"]) => {
    if (region === "body" && kind === "toggle" && !open) setOpenOverride(true);
    setActive({ region, caret: at });
  };

  /**
   * Record which region a press landed on, and where in it.
   *
   * The offset is measured against what is on screen and mapped back through the region's own
   * inline projection, so a press inside `**bold**` lands on the character shown rather than
   * somewhere in the delimiters that are not. The measurement is only trusted when the rendered
   * text is the same length as the projected text: a toggle body drawn as nested Blocks has no
   * linear mapping from a point to an offset — the newline between two Blocks is a box boundary and
   * not a character — and a caret placed from one lands short by a character per line.
   */
  const pressRegion = (
    event: PointerEvent,
    element: HTMLElement,
    region: ContainerRegion,
    text: string
  ) => {
    // A press already inside an editing surface belongs to that surface: it is how the caret is
    // placed and how a drag-selection starts, and taking it over here would break both.
    if ((event.target as HTMLElement | null)?.closest("[data-native-block-editor]")) return;
    // The default action would walk up and focus the row, after this handler has moved the editor
    // to the pressed region — the editor would mount, focus itself, then lose focus to the row in
    // the same gesture, leaving a Block that looks focused with every keystroke going to the
    // document. Placing the caret is this handler's job, so the default focus is not wanted.
    event.preventDefault();
    let at: ActiveRegion["caret"] = null;
    const projection = projectMarkdownInline(text);
    if (visibleTextLength(element) === projection.visibleText.length) {
      const visible = visibleOffsetAtPoint(element, event.clientX, event.clientY);
      if (visible !== null) at = projection.visibleOffsetToSource(visible, "forward");
    }
    if (at === null) {
      // The end of the region, not the caret the measurement would have given. Leaving this null
      // sends the caret to offset zero, which is the worst of the three answers: a press somewhere
      // in the middle of a body would put the caret in front of the first character and the next
      // thing typed would appear at the top of the toggle. A press that produced no offset at all is
      // the same case as a length that did not match: it landed on something the caret walker
      // rejects, which is what the anchor on an empty last line is — pressing that line put the
      // caret at the top of the body, and Backspace there then ate the line above.
      at = "end";
    }
    pendingRegionRef.current = region;
    pendingCaretRef.current = at;
    dragOriginRef.current =
      typeof at === "number" ? { region, text, at, x: event.clientX, y: event.clientY } : null;
    if (editable) focusRegion(region, at);
  };

  /**
   * Turn a press that travelled into a selection.
   *
   * The press activates the region and swaps the rendered text for an editor, so the browser's own
   * drag-selection has nothing left to work on by the time the pointer is released. The release point
   * is this event's own coordinates, measured against the text that was under the pointer when the
   * gesture began, so a drag ends up selecting what it crossed instead of collapsing to where it
   * started.
   */
  const releaseRegion = (event: ReactMouseEvent<HTMLElement>, element: HTMLElement) => {
    const origin = dragOriginRef.current;
    dragOriginRef.current = null;
    if (!origin) return;
    // A click is not a drag. Measuring travel in offsets rather than in pixels turned an ordinary
    // press into a one-character selection: the region swaps under the pointer between `pointerdown`
    // and `click`, so the same screen position maps to a slightly different offset either side of the
    // swap. Four pixels is the same threshold the container's own marquee uses.
    if (Math.abs(event.clientX - origin.x) < 4 && Math.abs(event.clientY - origin.y) < 4) return;
    const projection = projectMarkdownInline(origin.text);
    if (visibleTextLength(element) !== projection.visibleText.length) return;
    const visible = visibleOffsetAtPoint(element, event.clientX, event.clientY);
    if (visible === null) return;
    const head = projection.visibleOffsetToSource(visible, "forward");
    if (head === origin.at) return;
    focusRegion(origin.region, { anchor: origin.at, head });
  };

  /**
   * Tab belongs to the document, not to the browser's focus order.
   *
   * Left to its default action it took focus out of the editing surface altogether — from a callout
   * body to the next toggle's `<summary>`, from a toggle to a link in the app chrome — and the caret
   * was gone with no way back but the mouse. Every kind that edits through a textarea already
   * swallows it for the same reason, and a container's two contenteditables were the gap.
   */
  const tabStaysInside = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab" || event.metaKey || event.ctrlKey || event.altKey) return false;
    event.preventDefault();
    return true;
  };

  const handleHeadingKeyDown = (event: KeyboardEvent<HTMLElement>, selection?: SourceSelection) => {
    if (tabStaysInside(event)) return;
    // Backspace at the very start takes the container off and leaves the words behind. Both reference
    // products do this, and both make it two presses: the first strips the styling, and only then does
    // a second Backspace at the start of the resulting text merge it upward. Handing the key on after
    // the strip would collapse those two into one and swallow the previous Block by surprise.
    const at = selection ? Math.max(selection.anchor, selection.head) : -1;
    if (
      event.key === "Backspace" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      selection &&
      at === 0 &&
      Math.min(selection.anchor, selection.head) === 0
    ) {
      event.preventDefault();
      // Caret at nought: the press was at the very start, and that is where it stays, which is
      // also what lets a second Backspace mean "merge with the Block above".
      if (!event.repeat) commitLeavingContainer(container.withoutContainer(), 0);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      // A heading is one line, so a newline cannot go in it. Dropping into the body is what both
      // Notion and Feishu do with Enter on a callout's or a toggle's title, and it is the only
      // reading of the key that does not corrupt the Block.
      event.preventDefault();
      focusRegion("body", "start");
      return;
    }
    // Only when there is a body on screen to move into. Taking the key unconditionally made the
    // Block a place the down arrow could not leave: in a callout with no body it mounted an editor
    // over a line the file does not have, and in a collapsed toggle it forced the disclosure open,
    // when in both cases what the user asked for was the Block below this one. The table draws the
    // same line — it hands an arrow back the moment the move it would make does not exist.
    const plainArrow = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    if (plainArrow && event.key === "ArrowDown" && bodyOnScreen) {
      event.preventDefault();
      focusRegion("body", "start");
      return;
    }
    onKeyDown?.(event);
  };

  const handleBodyKeyDown = (event: KeyboardEvent<HTMLElement>, selection: SourceSelection) => {
    if (tabStaysInside(event)) return;
    // The surface's offsets are into the body *and* its trailing-line anchor, so an offset past the
    // end of the body itself is one that sits on the anchor and means the end of the body.
    const from = Math.min(Math.min(selection.anchor, selection.head), body.length);
    const to = Math.min(Math.max(selection.anchor, selection.head), body.length);
    if (event.key === "Enter" && !event.shiftKey) {
      // Enter is handled here rather than left to the contenteditable, which answers it by
      // inserting a `<div>` or a `<br>` — neither of which reads back as the newline the source
      // needs, so a second body line would arrive spliced onto the end of the first.
      event.preventDefault();
      commitBody(`${body.slice(0, from)}\n${body.slice(to)}`, from + 1);
      return;
    }
    const plainArrow = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    const firstBreak = body.indexOf("\n");
    if (plainArrow && event.key === "ArrowUp" && (firstBreak === -1 || to <= firstBreak)) {
      event.preventDefault();
      focusRegion("heading", "end");
      return;
    }
    if (event.key === "Backspace" && body.length > 0 && from === 0 && to === 0) {
      // Joining the first body line onto the heading. The heading and the body are one container's
      // two halves, so this is the ordinary "merge with the line above" — it was simply dead, because
      // the Block-level handler has no bare-Backspace branch for a kind that holds text.
      event.preventDefault();
      if (event.repeat) return;
      // A callout the file wrote without a title has no line above the body holding any of the
      // user's text: the line above is the `[!NOTE]` marker. Joining the first body line onto it
      // writes `> [!NOTE] callout body`, which this app still draws as a callout and GitHub does not
      // read as an alert at all, so a merge here quietly changes how the file renders everywhere
      // else. The caret goes to the empty title instead, from where a second Backspace takes the
      // container off the way it does from any other heading.
      if (kind === "callout" && heading.length === 0) {
        focusRegion("heading", "end");
        return;
      }
      const firstLine = body.indexOf("\n");
      const head = firstLine === -1 ? body : body.slice(0, firstLine);
      const rest = firstLine === -1 ? "" : body.slice(firstLine + 1);
      const merged = parseMarkdownContainer(kind, container.withHeading(heading + head));
      if (merged) {
        setActive({ region: "heading", caret: heading.length });
        commit(merged.withBody(rest));
      }
      return;
    }
    if (event.key === "Backspace" && body.length === 0 && from === 0 && to === 0) {
      // Without this, a body emptied to nothing is a dead end: there is no text left to delete, so
      // every further Backspace reaches the Block and starts deleting the Block itself.
      event.preventDefault();
      focusRegion("heading", "end");
      return;
    }
    onKeyDown?.(event);
  };

  const commitBody = (next: string, at: ActiveRegion["caret"]) => {
    setActive({ region: "body", caret: at });
    commit(container.withBody(next));
  };

  /**
   * The text a body surface handed back, with what the browser put at the end of it taken off.
   *
   * Two things can be there and neither is the user's. An anchored surface ends with the anchor, and
   * it comes off — only when this render put one there, so a zero-width space the user's own file
   * already held is never removed. And whenever the surface's text would end in a newline it cannot
   * draw, Chrome inserts a `<br>` of its own, which reads back as a second newline: measured, taking
   * a character off the last line of a body *added* an empty line to the file instead of removing
   * one. That `<br>` is never where the caret is — the edit that produced it left the caret on the
   * line above — while a newline the user really did put at the end, by pasting one, leaves the
   * caret after it. That is what tells the two apart.
   */
  const withoutTrailingAnchor = (next: string, caret: number) => {
    if (anchoredBody !== body && next.endsWith(TRAILING_LINE_ANCHOR)) return next.slice(0, -1);
    return next.endsWith("\n") && caret < next.length ? next.slice(0, -1) : next;
  };

  const headingEditor = (label: string, placeholder?: string) => (
    <SemanticInlineEditor
      label={label}
      source={heading}
      selection={selectionFor(caret, heading.length)}
      placeholder={placeholder}
      autoFocus
      className={EDITOR_CLASS}
      onSourceChange={(next) => commit(container.withHeading(next))}
      onKeyDown={handleHeadingKeyDown}
      onPasteText={(text, selection) => {
        // A heading is one line, so pasted newlines are flattened here rather than left to the
        // default path, which would write them into the source and cut the Block in half.
        const from = Math.min(selection.anchor, selection.head);
        const to = Math.max(selection.anchor, selection.head);
        const next = heading.slice(0, from) + flattenToOneLine(text) + heading.slice(to);
        commit(container.withHeading(next));
        return true;
      }}
    />
  );

  const bodyEditor = (label: string, placeholder?: string) => (
    <SemanticInlineEditor
      label={label}
      source={anchoredBody}
      selection={selectionFor(caret, body.length)}
      placeholder={placeholder}
      autoFocus
      className={EDITOR_CLASS}
      onSourceChange={(next, nextSelection) => {
        const text = withoutTrailingAnchor(next, nextSelection.head);
        commitBody(text, Math.min(nextSelection.head, text.length));
      }}
      onKeyDown={handleBodyKeyDown}
    />
  );

  /**
   * The body drawn as one flow of text with real newlines between its lines.
   *
   * The newlines are text nodes rather than a box per line, so what is on screen has exactly the
   * characters the body's text has. A line drawn as its own `<div>` puts a break between two
   * characters that are adjacent in the source, and the press-to-caret mapping counts what it can
   * see: a press on the third line landed two characters early, one for each break above it.
   */
  const bodyFlow = (text: string) => (
    <div className="whitespace-pre-wrap break-words">
      {text.split("\n").map((line, index) => (
        <Fragment key={`body-line-${index}`}>
          {index > 0 ? "\n" : null}
          <span>{renderInline(line)}</span>
        </Fragment>
      ))}
      {text.endsWith("\n") ? (
        // The rendering has to draw the empty last line the editing surface draws, or the Block
        // would change height the moment it took the caret. `aria-hidden` keeps the anchor out of
        // the walker that maps a press to an offset, the way the type label is kept out.
        <span aria-hidden="true">{TRAILING_LINE_ANCHOR}</span>
      ) : null}
    </div>
  );

  if (kind === "callout") {
    const style = CALLOUT_STYLES[container.type.toLowerCase()] ?? CALLOUT_STYLES.note;
    const Icon = style.icon;
    // An empty body is drawn as nothing at all, so that a one-line callout stays one line high. It
    // is reached with Enter from the title instead of by clicking a line that is not there, which
    // is the only way to offer it without growing the Block the moment it is activated.
    const showBody = body.length > 0 || activeRegion === "body";
    return (
      <aside
        data-testid="callout-block"
        aria-label={`${container.type} callout`}
        className={`flex min-h-9 gap-2.5 rounded-md border px-3 py-2 ${style.container}`}
      >
        {/* The icon is the control, which is how the reference product does it: you press the thing
            you want to change. It is always mounted and always the same box, so the callout cannot
            change height or width when it takes the caret, and it holds no text — a label inside the
            callout would be counted by the walker that maps a press to an offset, and every press in
            the title would then land several characters off. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`${style.label} callout, change type`}
              // Pressable whether or not the Block is active. Disabled while inactive, the first
              // press on the affordance the callout documents as its control did nothing at all —
              // no menu, and not even an activation — so the user had to click the text first and
              // then press the icon they had already pressed once.
              className={`mt-0.5 h-4 w-4 shrink-0 rounded transition-colors duration-[20ms] ease-in hover:bg-foreground/10 ${style.accent}`}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            aria-label="Callout type"
            className="w-44 rounded-xl border-border/80 bg-popover/95 p-1.5 shadow-xl backdrop-blur-xl"
          >
            {CALLOUT_TYPE_ORDER.map((name) => {
              const option = CALLOUT_STYLES[name];
              const OptionIcon = option.icon;
              return (
                <DropdownMenuItem
                  key={name}
                  className="h-8 gap-2 rounded-lg px-2.5"
                  onClick={() => {
                    const next = container.withType?.(name);
                    if (next) commit(next);
                  }}
                >
                  <span className="w-3 shrink-0 text-muted-foreground" aria-hidden="true">
                    {container.type.toLowerCase() === name ? "✓" : ""}
                  </span>
                  <OptionIcon className={`h-4 w-4 shrink-0 ${option.accent}`} aria-hidden="true" />
                  {option.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="min-w-0 flex-1">
          <div
            className="font-semibold"
            data-container-region="heading"
            onPointerDown={(event) =>
              pressRegion(event.nativeEvent, event.currentTarget, "heading", heading)
            }
            onClick={(event) => releaseRegion(event, event.currentTarget)}
          >
            {activeRegion === "heading" ? (
              headingEditor("Callout title", style.label)
            ) : heading ? (
              renderInline(heading)
            ) : (
              // Derived from `[!TYPE]`, present in no byte of the file. Hidden from the caret
              // mapping the way the icon is — the walker that measures a press rejects anything
              // under `aria-hidden`, and text it did not reject would shift every offset in the
              // region by its own length — and from screen readers too, since the `<aside>` already
              // announces the type.
              <span className={style.accent} aria-hidden="true">
                {style.label}
              </span>
            )}
          </div>
          {showBody ? (
            <div
              data-container-region="body"
              onPointerDown={(event) =>
                pressRegion(event.nativeEvent, event.currentTarget, "body", body)
              }
              onClick={(event) => releaseRegion(event, event.currentTarget)}
            >
              {activeRegion === "body" ? bodyEditor("Callout body") : bodyFlow(body)}
            </div>
          ) : null}
        </div>
      </aside>
    );
  }

  return (
    <details
      data-testid="toggle-block"
      data-native-toggle
      open={open}
      className="my-1 min-h-9 rounded-lg border border-border bg-muted/20"
    >
      <summary
        className="flex list-none items-start gap-1.5 break-words px-3 py-2 font-medium [&::-webkit-details-marker]:hidden"
        // Cancel the native disclosure but let the press keep travelling, so the row can activate
        // the Block the way it does for every other kind. Without this, clicking the summary to put
        // a caret in it collapsed the toggle instead.
        onClick={(event) => event.preventDefault()}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? "Collapse toggle" : "Expand toggle"}
          className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors duration-[20ms] ease-in hover:bg-muted hover:text-foreground"
          // The chevron owns its own press. Letting it reach the summary would move the caret into
          // the title in the same gesture that expanded the Block.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            // Collapsing takes the body off screen, so a caret inside it has to be given somewhere
            // to go. The end of the summary is where the user can carry on typing; leaving it to the
            // region resolver put it in front of the summary's first character instead, silently,
            // and the next keystroke rewrote a title nobody was aiming at.
            if (open && activeRegion === "body") setActive({ region: "heading", caret: "end" });
            setOpenOverride(!open);
          }}
        >
          <ChevronRight
            className={`h-3.5 w-3.5 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
            aria-hidden="true"
          />
        </button>
        <span
          className="min-w-0 flex-1"
          // One line high whether or not there is a summary to draw. A toggle whose summary has
          // been deleted renders nothing here, while the editing surface keeps its own `min-height:
          // 1lh`, so the disclosure shrank the moment the caret left it — activation changing the
          // Block's height, only in the direction that is easier to miss. Inline rather than a
          // utility class because the two heights have to agree exactly and a class that silently
          // failed to generate would put the jump straight back.
          style={{ minHeight: "1lh" }}
          data-container-region="heading"
          onPointerDown={(event) =>
            pressRegion(event.nativeEvent, event.currentTarget, "heading", heading)
          }
          onClick={(event) => releaseRegion(event, event.currentTarget)}
        >
          {activeRegion === "heading" ? headingEditor("Toggle summary") : renderInline(heading)}
        </span>
      </summary>
      <div
        data-native-toggle-content
        data-container-region="body"
        className="space-y-0.5 border-t border-border/70 px-3 py-2"
        onPointerDown={(event) => pressRegion(event.nativeEvent, event.currentTarget, "body", body)}
        onClick={(event) => releaseRegion(event, event.currentTarget)}
      >
        {activeRegion === "body" ? (
          bodyEditor("Toggle body", "Write something…")
        ) : body.length === 0 ? (
          // A placeholder rather than nothing, so an empty toggle has a line to click into, and
          // `aria-hidden` rather than plain text, so the press-to-caret walker skips it the way it
          // skips the callout's derived type label. The height is written inline and in the same
          // unit the editing surface uses, because the two have to be the same line high to the
          // pixel: a class that silently failed to generate would make the toggle jump the moment
          // its empty body was clicked, which is the grow-on-focus this component exists to prevent.
          <div className="text-muted-foreground" style={{ minHeight: "1lh" }} aria-hidden="true">
            Empty toggle
          </div>
        ) : renderBody ? (
          renderBody(body)
        ) : (
          bodyFlow(body)
        )}
      </div>
    </details>
  );
}

interface SourceSelection {
  readonly anchor: number;
  readonly head: number;
}

/** Where the caret goes when a region's editor mounts, in that region's own text offsets. */
function selectionFor(caret: ActiveRegion["caret"], length: number): SourceSelection | undefined {
  const clamp = (at: number) => Math.max(0, Math.min(at, length));
  if (caret === "end") return { anchor: length, head: length };
  if (caret === "start") return { anchor: 0, head: 0 };
  if (typeof caret === "number") {
    const at = clamp(caret);
    return { anchor: at, head: at };
  }
  if (caret && typeof caret === "object") {
    return { anchor: clamp(caret.anchor), head: clamp(caret.head) };
  }
  return undefined;
}

/**
 * A walker over the text a reader can actually see, skipping decoration.
 *
 * Anything under `aria-hidden` is rejected because it is not the user's text: the callout's derived
 * type label and the toggle's empty-body placeholder exist in no byte of the file, and counting
 * them would shift every caret offset in the region by their length.
 */
function visibleTextNodes(element: HTMLElement): TreeWalker {
  return document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (candidate) =>
      candidate.parentElement?.closest('[aria-hidden="true"]')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
}

function visibleTextLength(element: HTMLElement): number {
  const walker = visibleTextNodes(element);
  let total = 0;
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    total += (current.nodeValue ?? "").length;
  }
  return total;
}

/**
 * Offset of a point within an element's rendered text.
 *
 * A press has to land the caret on the character under it, in a callout as much as in a paragraph.
 * Without this the caret went to the start of whichever region was pressed, so clicking the end of
 * a word put you before the first letter of it.
 */
function visibleOffsetAtPoint(element: HTMLElement, x: number, y: number): number | null {
  const host = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = host.caretPositionFromPoint?.(x, y);
  const range = position ? null : host.caretRangeFromPoint?.(x, y);
  const node = position ? position.offsetNode : (range?.startContainer ?? null);
  const offset = position ? position.offset : (range?.startOffset ?? 0);
  if (!node || node.nodeType !== Node.TEXT_NODE || !element.contains(node)) return null;
  const walker = visibleTextNodes(element);
  let total = 0;
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (current === node) return total + offset;
    total += (current.nodeValue ?? "").length;
  }
  return null;
}
