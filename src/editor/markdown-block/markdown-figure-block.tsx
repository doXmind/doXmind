"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";

import { splitDelimitedBlockSource } from "@/editor/markdown-block/block-editing-projection";
import type { InPlaceBlockProps } from "@/editor/markdown-block/in-place-block";
import { MarkdownBlockDocument } from "@/editor/markdown-block/markdown-block-document";
import {
  getMermaidThemeKey,
  renderMermaidSvg,
  renderMermaidSvgLight,
  subscribeMermaidTheme,
} from "@/lib/mermaid-renderer";

/** The two kinds whose rendered form is a picture of their source rather than a projection of it. */
export type MarkdownFigureKind = "block_math" | "mermaid";

export interface MarkdownFigureBlockProps extends InPlaceBlockProps {
  readonly kind: MarkdownFigureKind;
}

let katexPromise: Promise<typeof import("katex").default> | null = null;

function loadKatex(): Promise<typeof import("katex").default> {
  katexPromise ??= import("katex").then((module) => module.default);
  return katexPromise;
}

const FIELD_LABEL: Record<MarkdownFigureKind, string> = {
  block_math: "LaTeX source",
  mermaid: "Mermaid source",
};

/**
 * An equation or a diagram that stays rendered while its source is edited.
 *
 * Activating either kind used to replace the picture with a textarea holding the raw `$$ … $$` or the
 * raw ```` ```mermaid ```` fence, so the one thing the user needed while writing an equation — the
 * equation — was the thing that disappeared the moment they clicked it. The render therefore lives at
 * a fixed position in this component's tree and is never unmounted (rule 1); the source field is an
 * addition to it, not a replacement for it.
 *
 * The field sits in flow under the figure, and only while the Block is active, so the row grows to
 * contain it and no reader who is not editing pays for it.
 *
 * The two obvious alternatives are both worse. Out of flow inside the row it was painted over: every
 * row carries `contain: layout style`, which makes the row its own stacking context, so the panel's
 * z-index never applied outside it and the following rows drew straight through it — measured, a
 * one-line equation's panel hung 34.8px past its row with 87% of the next paragraph over it, and a
 * twelve-line one hung 188.8px past, over five whole Blocks. Portalled to the body it paints
 * correctly and the row keeps its height, but the editing surface then lives outside the row it
 * belongs to, and the caret mapping, the focus restoration and six lookups in the e2e harness all
 * read the surface out of the row — that is a load-bearing assumption across the whole matrix, and
 * moving it for two kinds is a larger change than the defect justifies.
 *
 * In flow, activation grows the row: 56.8px for a one-line equation, capped by the eight-row limit
 * below. The figure itself does not move, only what follows it does, which is the same trade Feishu
 * makes for its own equation editor. `in-place.spec.ts` records why these two kinds are the
 * exception to its no-resize rule.
 */
export function MarkdownFigureBlock({
  blockId,
  kind,
  source,
  editable,
  onChange,
  onKeyDown,
}: MarkdownFigureBlockProps) {
  const split = splitFigureSource(kind, source);
  // A fence has no escape sequence, so a payload that already contains a line which would close the
  // Block cannot be spliced back safely under any edit. Reading it is still worth offering; writing
  // it is refused rather than allowed to re-cut the Block somewhere the user did not ask for.
  const locked = kind === "mermaid" && FENCE_CLOSING_LINE.test(split.payload);

  const commit = (payload: string): boolean => {
    const next = assembleFigureSource(kind, split, payload);
    if (next === null || next === source) return false;
    onChange(blockId, next);
    return true;
  };

  return (
    <div>
      {kind === "block_math" ? (
        <BlockMathRender latex={split.payload.trim()} />
      ) : (
        <MermaidRender code={normalizeLineEndings(split.payload)} />
      )}
      {editable ? (
        <FigureSourceField
          kind={kind}
          payload={split.payload}
          readOnly={locked}
          onPayloadChange={commit}
          onKeyDown={onKeyDown}
        />
      ) : null}
    </div>
  );
}

/**
 * The source panel, mounted only while the Block is active.
 *
 * It is the element rule 4 requires — the one thing carrying `data-native-block-editor` and holding
 * focus — so a figure still answers Escape and the Block shortcuts while the caret is inside it.
 */
function FigureSourceField({
  kind,
  payload,
  readOnly,
  onPayloadChange,
  onKeyDown,
}: {
  kind: MarkdownFigureKind;
  payload: string;
  readOnly: boolean;
  onPayloadChange: (payload: string) => boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
}) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  /**
   * The in-flight IME value, held here and committed once.
   *
   * `onChange` fires for every candidate an input method offers, so committing from it turned one
   * composed word into one command per keystroke: the document saw two edits where the user made
   * one, and a single undo took back only the last of them. Every other surface in this editor holds
   * the composing value locally and commits at `compositionend`; this one did not.
   */
  const [composingValue, setComposingValue] = useState<string | null>(null);
  const composingRef = useRef(false);
  /**
   * The empty line Enter has just opened, held here until there is something on it.
   *
   * An equation cannot carry a trailing blank line: it would sit against the closing `$$` and end
   * the Block, so `assembleFigureSource` trims it and the assembled source comes back identical to
   * the one on disk. Nothing is written, the controlled field snaps back, and Enter reads as a key
   * that does nothing at all — `\begin{aligned}` could only be written through the clipboard. Held
   * locally instead, the same way this field already holds an in-flight composition: the caret sits
   * on the new line, and the first character typed there commits both.
   */
  const [openedLine, setOpenedLine] = useState<string | null>(null);

  useEffect(() => {
    setOpenedLine(null);
  }, [payload]);

  // The caret goes to the end of what is already written, which is where a person who just clicked an
  // equation to change it expects to continue. Doing it on mount rather than on every render matters:
  // a field re-focused on each keystroke would fight the user's own caret and make typing in the
  // middle of a formula impossible.
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    // Focus without the browser's scroll, then ask for the smallest one that works. A bare `focus()`
    // recentres a surface that is entirely off screen on the scroll port's midline, and this panel is
    // the surface most often in that state: it does not exist until the Block is active, so it mounts
    // below whatever the equation already occupies. Measured on an 868px port, `focus()` scrolled the
    // Page 492px and this pair scrolls 109. End to end that was an arrow walk stepping 39, 39, 39,
    // 491 into the equation — far enough past it that the next eleven presses moved the Page not at
    // all — against 171 with the pair. Why `CenterIfNeeded` is the wrong alignment here is written
    // out in `semantic-inline-editor.tsx`.
    field.focus({ preventScroll: true });
    field.scrollIntoView?.({ block: "nearest" });
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);

  const lines = payload.split(/\r\n|\n|\r/).length;

  return (
    <div
      data-figure-source-panel={kind}
      className="mt-1 rounded-md border border-border bg-popover p-2 shadow-lg"
    >
      <textarea
        ref={fieldRef}
        data-native-block-editor
        data-figure-source-field={kind}
        aria-label={FIELD_LABEL[kind]}
        // The name lives in `aria-label` and not in a visually hidden span, because hidden text
        // inside a Block is real text that the caret mapping counts, and every press then lands
        // several characters away from where it was aimed.
        className="native-block-editor-surface block w-full resize-none bg-transparent font-mono text-xs leading-5 text-foreground outline-none"
        spellCheck={false}
        // The panel is in flow, so every row it asks for is a row the Page is pushed down by. Eight
        // is the point where a longer source scrolls inside the field instead of growing the Block
        // further: at fourteen a `\begin{aligned}` block grew the row by more than a screenful of
        // paragraphs, which is the same "an equation swallowed the document" complaint the overlay
        // used to produce by painting over them.
        rows={Math.min(Math.max(lines, 2), 8)}
        readOnly={readOnly}
        value={composingValue ?? openedLine ?? payload}
        onChange={(event) => {
          if (composingRef.current) {
            setComposingValue(event.target.value);
            return;
          }
          const value = event.target.value;
          const written = onPayloadChange(value);
          setOpenedLine(written || !opensTrailingLine(payload, value) ? null : value);
        }}
        onCompositionStart={(event) => {
          composingRef.current = true;
          setComposingValue(event.currentTarget.value);
        }}
        onCompositionUpdate={(event) => setComposingValue(event.currentTarget.value)}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          const settled = event.currentTarget.value;
          setComposingValue(null);
          if (settled !== payload) onPayloadChange(settled);
        }}
        onKeyDown={(event) => {
          // Enter is the one key this field owns outright. Handing it back would reach the Block's
          // split handler, and splitting a figure in half leaves two fragments of a fence that are
          // no longer an equation or a diagram at all.
          if (event.key === "Enter") return;
          onKeyDown?.(event);
        }}
      />
    </div>
  );
}

/**
 * Whether the only thing this value adds to the payload is empty lines at the end.
 *
 * That is the one refusal worth holding on screen: the file already says everything the value says,
 * so nothing is being shown that the document does not have. A payload refused for any other reason
 * — a list marker, a fence line — still reverts, because keeping it would leave the field claiming
 * an equation the file never got.
 */
function opensTrailingLine(payload: string, value: string): boolean {
  return value !== payload && value.replace(/(?:[ \t]*(?:\r\n|\n|\r))+[ \t]*$/, "") === payload;
}

/**
 * The KaTeX render, kept byte-for-byte the behaviour the preview already had.
 *
 * `throwOnError: false` is what makes a half-typed formula survive: KaTeX returns markup describing
 * the parse failure in red instead of raising, so the Block shows what is wrong with the equation
 * while the user is still writing it rather than collapsing to nothing. The injected string is
 * KaTeX's own output for a payload it escapes itself, with `trust: false` refusing every construct
 * that could emit arbitrary markup, so this is not the document-derived markup ADR-0011 forbids;
 * there is also no API for building KaTeX's DOM any other way.
 */
function BlockMathRender({ latex }: { latex: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    if (!latex) return () => undefined;
    void loadKatex()
      .then((katex) => {
        if (cancelled) return;
        setHtml(
          katex.renderToString(latex, {
            displayMode: true,
            throwOnError: false,
            errorColor: "#ef4444",
            strict: "warn",
            trust: false,
          })
        );
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [latex]);

  return (
    <div
      data-testid="block-math-block"
      data-latex={latex}
      // Left, and only left. The wrapper used to ask for `text-center` while math-mermaid.css
      // pinned `.katex-display` and `.katex-display > .katex` to `text-align: left`, so the Block
      // held two opposite answers and the stylesheet won every time — an equation that computed
      // `center` on its own box and painted flush left. Left is the intended one: the two rules
      // were written deliberately to match Notion, whose equation Block is not centred, and they
      // are what every equation on every Page has actually rendered as since.
      //
      // Removing the class is not cosmetic. The fallback below is a bare `<code>` shown until
      // KaTeX has loaded, and nothing pins *it* left — so a fresh equation was drawn centred and
      // then jumped to the left margin the moment the render arrived. Measured on the packaged app
      // in a 947px content column, `E = mc^2` was laid out at x 807.97 centred and lands at x
      // 389.0: 418.97px of sideways travel on first paint, on the one Block whose content is
      // supposed to sit still while it loads.
      className="block-math-wrapper min-h-9 overflow-x-auto rounded-md bg-muted/35 px-3 py-2"
    >
      {/*
       * Deliberately unclassed.
       *
       * `math-rendered` exists for exactly two rules in math-mermaid.css — `cursor: pointer` and a
       * hover tint — and nothing else in the app reads it. BLOCK_UX_REFERENCE records that a row
       * hover tint was shipped and then removed because it painted a full-column band over a short
       * piece of content; this one survived that removal and did the same thing. Measured on the
       * packaged app, hovering `E = mc^2` painted 923px of band for a formula whose ink is a
       * fraction of it, while hovering the paragraph above it painted nothing. The gutter controls
       * are the hover affordance everywhere else in the matrix, and they are enough here.
       */}
      <div>
        {html ? (
          <span dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <code className="whitespace-pre-wrap font-serif text-base">{latex || " "}</code>
        )}
      </div>
    </div>
  );
}

/**
 * The Mermaid render, with the last diagram that parsed held on screen.
 *
 * Every intermediate state of a diagram being typed is a parse error — `graph T` is not a diagram —
 * so dropping the picture the instant a render fails would make the figure flicker empty on almost
 * every keystroke, which is the same "you edit blind" complaint in a different costume. The previous
 * SVG stays, the failure is reported underneath it, and nothing the user typed is discarded. Holding
 * the last good render is a concession to the screen only: the light-themed second copy is rebuilt
 * from scratch on every run so the exported PDF can never show a diagram the current source does not
 * describe, and the `data-mermaid-print-ready` flag still flips exactly once per run because the
 * local PDF export waits on it and generates nothing without it.
 */
function MermaidRender({ code }: { code: string }) {
  const themeKey = useSyncExternalStore(subscribeMermaidTheme, getMermaidThemeKey, () => "ssr");
  const [svg, setSvg] = useState<string | null>(null);
  const [printSvg, setPrintSvg] = useState<string | null>(null);
  const [printReady, setPrintReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPrintReady(false);
    // Only the on-screen SVG is held across a failed render. The print copy is dropped on every run
    // and rebuilt, because it is the one the local PDF export reads: keeping the last diagram that
    // parsed would put a picture of an older version of the source into the exported file, where
    // there is no editing session in progress to explain it. It is inside a `hidden` element, so
    // clearing it costs the reader nothing.
    setPrintSvg(null);
    if (!code.trim()) {
      setSvg(null);
      setError(null);
      setPrintReady(true);
      return () => undefined;
    }
    void (async () => {
      try {
        const rendered = await renderMermaidSvg(code);
        if (cancelled) return;
        setSvg(rendered);
        setError(null);

        if (themeKey.endsWith("-dark")) {
          try {
            const printable = await renderMermaidSvgLight(code);
            if (!cancelled) setPrintSvg(printable);
          } catch {
            // The print-only fallback remains the local Mermaid source.
          }
        } else {
          setPrintSvg(rendered);
        }
      } catch (failure) {
        if (!cancelled) setError(mermaidFailureMessage(failure));
      } finally {
        if (!cancelled) setPrintReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, themeKey]);

  return (
    <figure
      data-testid="mermaid-block"
      data-code={code}
      data-mermaid-print-ready={printReady ? "true" : "false"}
      className="mermaid-chart-wrapper min-h-9 overflow-x-auto rounded-md border border-border bg-muted/25 px-3 py-2"
    >
      <figcaption className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Mermaid diagram
      </figcaption>
      <div data-mermaid-screen-preview className="mermaid-rendered">
        {svg ? (
          // Generated local SVGs have no stable dimensions or URL for next/image.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
            alt="Mermaid diagram"
            className="mx-auto h-auto max-w-full"
          />
        ) : (
          <pre className="whitespace-pre-wrap font-mono text-sm leading-6">
            <code>{code || " "}</code>
          </pre>
        )}
      </div>
      {error ? (
        <p
          data-mermaid-error
          role="status"
          className="mt-1 whitespace-pre-wrap break-words text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}
      <div data-mermaid-print-preview className="hidden">
        {printSvg ? (
          // This light-themed copy exists only for local PDF output.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(printSvg)}`}
            alt=""
            aria-hidden="true"
            className="mx-auto h-auto max-w-full"
          />
        ) : (
          <pre className="whitespace-pre-wrap font-mono text-sm leading-6">
            <code>{code || " "}</code>
          </pre>
        )}
      </div>
    </figure>
  );
}

function mermaidFailureMessage(failure: unknown): string {
  const message = failure instanceof Error ? failure.message : String(failure);
  return message.trim() || "Mermaid could not draw this diagram";
}

export interface FigureSourceSplit {
  /** Opening delimiter, verbatim, including its line ending where it has one. */
  readonly prefix: string;
  /** The formula or the diagram: everything the user is allowed to edit. */
  readonly payload: string;
  /** Closing delimiter, verbatim. */
  readonly suffix: string;
}

const MATH_OPENING_LINE = /^[ \t]{0,3}\$\$[ \t]*(?:\r\n|\n|\r)/;
const MATH_CLOSING_LINE = /(?:\r\n|\n|\r)[ \t]{0,3}\$\$[ \t]*$/;
const MATH_SINGLE_LINE = /^([ \t]{0,3}\$\$)([\s\S]*)(\$\$[ \t]*)$/;
// The trailing `\r?` is load-bearing on a Windows file. Under the `m` flag `$` matches before the
// `\n` of a CRLF pair, so the `\r` sits between the delimiter run and the anchor and a payload line
// of exactly ``` went unrecognised — the field stayed writable on a diagram whose every edit the
// parser would then refuse, which reads as a keyboard that has stopped working.
const FENCE_CLOSING_LINE = /^[ \t]*(?:`{3,}|~{3,})[ \t]*\r?$/m;

/**
 * Split a figure into the delimiters nobody edits and the payload everybody does.
 *
 * The three parts are reassembled verbatim, so the split is the guarantee that editing an equation
 * cannot rewrite the `$$` around it and editing a diagram cannot rewrite its fence. Rule 3 needs the
 * same thing from the other direction: the render hides those delimiters, so the field must not put
 * them back in front of the user the moment the Block is touched.
 */
export function splitFigureSource(kind: MarkdownFigureKind, source: string): FigureSourceSplit {
  if (kind === "mermaid") {
    // `splitDelimitedBlockSource` already covers a Mermaid fence and already fails closed on the
    // ambiguous shapes, so the only reason to look at the lines directly is that it returned null.
    const fence = splitDelimitedBlockSource("mermaid", source);
    if (fence) {
      return { prefix: fence.prefix, payload: fence.payload, suffix: fence.suffix };
    }
    return splitOuterLines(source);
  }

  // `block_math` is deliberately outside `splitDelimitedBlockSource`, so the `$$` split lives here.
  const opening = MATH_OPENING_LINE.exec(source);
  if (opening) {
    const closing = MATH_CLOSING_LINE.exec(source);
    if (closing && closing.index >= opening[0].length) {
      return {
        prefix: opening[0],
        payload: source.slice(opening[0].length, closing.index),
        suffix: source.slice(closing.index),
      };
    }
  }
  const single = MATH_SINGLE_LINE.exec(source);
  if (single) return { prefix: single[1], payload: single[2], suffix: single[3] };
  return { prefix: "", payload: source, suffix: "" };
}

/** First line and last line as delimiters, for a fence shape the delimited splitter would not take. */
function splitOuterLines(source: string): FigureSourceSplit {
  const opening = /^[^\r\n]*(?:\r\n|\n|\r)/.exec(source);
  const closing = /(?:\r\n|\n|\r)[^\r\n]*$/.exec(source);
  if (!opening || !closing || closing.index < opening[0].length) {
    return { prefix: "", payload: source, suffix: "" };
  }
  return {
    prefix: opening[0],
    payload: source.slice(opening[0].length, closing.index),
    suffix: source.slice(closing.index),
  };
}

/**
 * The Markdown a new payload produces, or null when that Markdown would stop being this Block.
 *
 * A figure is one of the few kinds where a single ordinary keystroke can dissolve the Block: a blank
 * line inside `$$ … $$` ends the paragraph and leaves two stray `$$` lines behind, and a fence line
 * inside a diagram closes it early. Refusing the keystroke is the lesser harm, because the
 * alternative is the Block silently turning into the raw delimiters this whole component exists to
 * stop the user from ever seeing.
 */
export function assembleFigureSource(
  kind: MarkdownFigureKind,
  split: FigureSourceSplit,
  payload: string
): string | null {
  const adopted = adoptLineEndings(split.prefix + split.payload + split.suffix, payload);
  const next = kind === "mermaid" ? assembleMermaid(split, adopted) : assembleMath(split, adopted);
  if (next === null) return null;
  return keepsOneBlockOf(kind, next) ? next : null;
}

/**
 * The incoming payload rewritten with the line ending the Block was already using.
 *
 * A `<textarea>` reports its value with the line breaks normalised to `\n` no matter what was put
 * into it, so on a CRLF file the first edit to a multi-line figure handed back a payload with bare
 * `\n` while the delimiters spliced around it kept their `\r\n`. The Block then carried two different
 * line endings, which is a byte the user never touched being rewritten — the one thing splicing
 * verbatim was supposed to make impossible. A payload that already carries a `\r` is left exactly as
 * it is, because that came from somewhere other than the field's own normalisation and guessing at it
 * would be the same mistake in the other direction.
 */
function adoptLineEndings(original: string, payload: string): string {
  if (/\r/.test(payload)) return payload;
  const eol = /\r\n|\r/.exec(original)?.[0];
  if (!eol) return payload;
  return payload.replace(/\n/g, eol);
}

function assembleMermaid(split: FigureSourceSplit, payload: string): string | null {
  if (FENCE_CLOSING_LINE.test(payload)) return null;
  return split.prefix + payload + split.suffix;
}

function assembleMath(split: FigureSourceSplit, payload: string): string | null {
  const indent = /^[ \t]*/.exec(split.prefix)?.[0] ?? "";
  const body = collapseBlankLines(payload);

  // An emptied equation cannot stay in the two-line-delimiter shape, because `$$`, blank, `$$` is a
  // blank line between two `$$` paragraphs and the Block would come apart in the user's hands the
  // first time they selected all and deleted. The one-line shape holds an empty formula safely, so
  // clearing an equation collapses it to `$$ $$` and leaves something to type back into.
  if (body.trim() === "") return `${indent}$$ $$`;

  const fenced = /[\r\n]/.test(split.prefix);
  if (fenced) return split.prefix + trimBlankEdges(body) + split.suffix;
  if (!/[\r\n]/.test(body)) return split.prefix + body + split.suffix;

  // The first newline typed into a one-line equation promotes it to the delimited shape rather than
  // producing `$$a`, `b$$`, which is two paragraphs and no longer an equation.
  const eol = /\r\n|\n|\r/.exec(body)?.[0] ?? "\n";
  return `${indent}$$${eol}${trimBlankEdges(body)}${eol}$$`;
}

/**
 * Every run of blank lines reduced to a single line ending.
 *
 * A blank line is a Block boundary everywhere in Markdown, and display math has no use for one, so
 * swallowing it costs the user nothing and saves the equation. This is the same trade the pipe table
 * makes when it flattens a newline pasted into a cell.
 *
 * The `\r(?!\n)` is not decoration. Written as a plain `\r`, the engine backtracks on a CRLF file:
 * having matched `\r\n` as the first break it finds nothing after it, retries with the `\r` alone,
 * and then happily reads the `\n` of that same pair as a second break — so an ordinary line ending
 * counted as a blank line and every edit to a Windows equation silently rewrote `\r\n` to a bare
 * `\r`, corrupting a byte the user never touched.
 */
function collapseBlankLines(value: string): string {
  return value.replace(/(\r\n|\n|\r(?!\n))(?:[ \t]*(?:\r\n|\n|\r(?!\n)))+/g, "$1");
}

/** Leading and trailing blank lines, which would sit against a `$$` and end the Block there. */
function trimBlankEdges(value: string): string {
  return value.replace(/^(?:[ \t]*(?:\r\n|\n|\r))+/, "").replace(/(?:(?:\r\n|\n|\r)[ \t]*)+$/, "");
}

/**
 * Whether the candidate source is still exactly one Block of this kind.
 *
 * The targeted guards above cover the two failures that are worth turning into a supported edit; this
 * asks the canonical parser about everything else, so a payload line that happens to read as a list
 * marker or a heading is refused instead of quietly splitting the figure into pieces.
 */
function keepsOneBlockOf(kind: MarkdownFigureKind, candidate: string): boolean {
  const { blocks } = MarkdownBlockDocument.fromMarkdown(candidate).getSnapshot();
  return blocks.length === 1 && blocks[0].kind === kind;
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n|\r/g, "\n");
}
