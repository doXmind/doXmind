"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from "react";

import { splitDelimitedBlockSource } from "@/editor/markdown-block/block-editing-projection";
import {
  highlightCodeTokens,
  resolveCodeLanguage,
  type CodeToken,
} from "@/editor/markdown-block/code-highlight";
import type { InPlaceBlockProps } from "@/editor/markdown-block/in-place-block";

export interface MarkdownCodeBlockProps extends InPlaceBlockProps {
  /**
   * Commit a new info string for the fence, e.g. "python".
   *
   * The ``` line is projected out of the editing surface, so the language would otherwise be
   * unreachable. Optional because a printed or nested code Block has no control to offer.
   */
  readonly onSetLanguage?: (blockId: string, language: string) => void;
}

/**
 * Every metric the two stacked layers must agree on, to the pixel.
 *
 * The user types into a transparent textarea laid exactly over the highlighted `<pre>`, so the caret
 * sits on the glyph the user sees only while both layers wrap, indent and advance identically. Font
 * size, line height, letter spacing, tab size, padding, white-space handling and word breaking are
 * therefore declared once here and spread onto both elements. Any property that governs where a
 * character lands has to be in this object: a value set on one layer and inherited on the other is
 * exactly how the caret ends up a few pixels — and then, further down a long Block, a few characters
 * — away from the text it is supposed to be inside.
 *
 * Inline rather than utility classes for two reasons. `.markdown-page pre` in editor.css sets padding
 * and size on the element selector, which no class on the `<pre>` can outrank but which never reaches
 * the textarea, so a class-based pair would silently desync. And `.text-sm` in globals.css is
 * redeclared with `!important`, so a Tailwind size utility inside editor content does not mean what
 * it says. The one property deliberately absent is `font-family`: globals.css pins the mono stack
 * with `!important` on `.markdown-page pre` and on `.font-mono`, and an inline value cannot beat
 * `!important`, so the textarea carries the `font-mono` class instead and both layers end up on the
 * same stack through the same rule.
 */
const CODE_LAYER_METRICS: CSSProperties = {
  // The code-font slider, not the UI slider: editor.css says a fenced Block is a genuine code
  // surface and follows the user's code-font preference.
  fontSize: "var(--ui-code-font-size-base)",
  // 1.45 is what `.text-sm`'s `!important` line-height already gives a code Block today; keeping it
  // means the conversion does not reflow a single Page.
  lineHeight: 1.45,
  letterSpacing: "normal",
  padding: "1rem",
  // 8 is the CSS initial value, so a file indented with literal tabs renders exactly as it does
  // today. It is stated rather than left to default only so the two layers cannot drift if a parent
  // ever sets one.
  tabSize: 8,
  // Code does not wrap, and the Block scrolls sideways instead. The `<pre>` carried
  // `overflow-x: auto` from editor.css together with `pre-wrap`, which is a contradiction the
  // browser resolves by never scrolling: measured on the packaged app, `scrollWidth === clientWidth`
  // on every code Block, so the declaration had no effect and a 100-character line came out as 33
  // wrapped fragments with its indentation meaningless. Notion, Feishu and every code editor a
  // reader has ever used scroll. The scroll box is the shared parent below, not this element, so
  // both layers move together.
  whiteSpace: "pre",
  overflowWrap: "normal",
  wordBreak: "normal",
  margin: 0,
  border: 0,
};

/** Where the caret should land once the Block becomes editable, in payload offsets. */
interface PendingSelection {
  readonly start: number;
  readonly end: number;
}

/**
 * A fenced code Block that stays highlighted while it is being edited.
 *
 * Activating a code Block used to replace the highlighted `<pre>` with a plain textarea, so the
 * colours vanished the moment the user started typing — the one moment they are most useful. Notion
 * and Feishu both keep highlighting live. The `<pre>` here is mounted at the same position in the
 * tree in both states and is never unmounted; the editing surface is a transparent textarea laid
 * over it, so what the user reads is always the rendered form and what they type into is invisible.
 *
 * The fence delimiters are never shown. Only the payload between ``` lines reaches either layer, and
 * a commit splices that payload back between the exact prefix and suffix bytes the file already had,
 * so an edit cannot move, duplicate or drop a delimiter.
 */
export function MarkdownCodeBlock({
  blockId,
  source,
  editable,
  onChange,
  onKeyDown,
  onSetLanguage,
}: MarkdownCodeBlockProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const codeRef = useRef<HTMLElement>(null);
  // The caret a press asked for, recorded before the Block is active.
  //
  // A press activates the Block, but `editable` is still false while that press is being handled, so
  // a handler guarded on it records nothing and activation falls back to the end of the payload:
  // clicking line 2 of an unfocused code Block would put the caret after the last character. A ref
  // rather than state, because it has to survive the render activation triggers without causing one.
  const pendingSelectionRef = useRef<PendingSelection | null>(null);
  /** Where a press began, so its release can be read as a range rather than a caret. */
  const dragOriginRef = useRef<{ at: number; x: number; y: number } | null>(null);
  const appliedActivationRef = useRef(false);
  const composingRef = useRef(false);
  const [composingValue, setComposingValue] = useState<string | null>(null);
  /** The delimiter a refused edit would have closed the Block with, while the notice is up. */
  const [refusedDelimiter, setRefusedDelimiter] = useState<string | null>(null);

  const fence = splitDelimitedBlockSource("fenced_code", source);
  // A null split means the source is not a fence this component can take apart without risking the
  // bytes — two candidate closing lines, or text after the close. Editing the whole source verbatim
  // is then the only lossless answer, and it is a shape the scanner does not hand a `fenced_code`
  // Block in the first place.
  const rawPayload = fence ? fence.payload : source;
  // The payload as the textarea will actually hold it, plus the line ending a commit has to put
  // back.
  //
  // A textarea's value is newline-normalised by the DOM: hand it "a\r\nb" and it hands back "a\nb".
  // Two things follow, and both are bugs if they are left alone. Every offset measured here — the
  // press hit-test, the edge checks, the indent splice — has to be measured against the normalised
  // text, because the caret positions the field reports are in that text; against the raw bytes a
  // CRLF Block would land the caret one character further off for every line above the press. And a
  // commit has to re-encode, because otherwise the first keystroke anywhere in a CRLF Block would
  // rewrite every line ending in it, which is a diff over bytes the user never touched.
  const lineEnding = payloadLineEnding(fence?.prefix ?? "", rawPayload);
  const payload = composingValue ?? rawPayload.replace(/\r\n|\r/g, "\n");
  const language = fence?.infoString ?? "";

  const payloadLengthRef = useRef(payload.length);
  payloadLengthRef.current = payload.length;

  // Focus and the caret are applied once per activation. Re-applying them on later renders would
  // fight the user: a render happens on every keystroke, and re-seating the caret at the position
  // the press landed on makes typing come out backwards.
  useEffect(() => {
    if (!editable) {
      appliedActivationRef.current = false;
      pendingSelectionRef.current = null;
      setRefusedDelimiter(null);
      return;
    }
    if (appliedActivationRef.current) return;
    appliedActivationRef.current = true;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const end = payloadLengthRef.current;
    // No press means the Block was activated from the keyboard or a command, and the end of the
    // payload is where a code Block is nearly always continued from.
    const pending = pendingSelectionRef.current ?? { start: end, end };
    pendingSelectionRef.current = null;
    // Focus without the browser's scroll, then ask for the smallest one that works. A bare `focus()`
    // recentres a surface that is entirely off screen on the scroll port's midline, so reaching this
    // Block from below the fold threw the Page half a screen: measured on a 171px field parked 40px
    // under an 868px port, `focus()` scrolled 578px and this pair scrolls 211 — enough to show the
    // field and no more. Why `CenterIfNeeded` is the wrong alignment here is written out in
    // `semantic-inline-editor.tsx`.
    textarea.focus({ preventScroll: true });
    textarea.scrollIntoView?.({ block: "nearest" });
    textarea.setSelectionRange(pending.start, pending.end);
  }, [editable]);

  // A controlled textarea whose value comes back from the parent puts the caret at the end of the
  // field unless it is told otherwise, so every commit records where the caret belongs and it is
  // restored here, after the value the parent sent back has been painted.
  useLayoutEffect(() => {
    if (!editable || composingRef.current) return;
    const pending = pendingSelectionRef.current;
    if (!pending) return;
    const textarea = textareaRef.current;
    if (!textarea || document.activeElement !== textarea) return;
    pendingSelectionRef.current = null;
    textarea.setSelectionRange(pending.start, pending.end);
  });

  /**
   * Put the field back the way it was, and say why.
   *
   * Refusing is the right answer — the alternative is re-cutting the Block somewhere the user did
   * not ask for — but refusing in silence is not: a pasted snippet containing a ``` line simply
   * vanished, with no toast, no notice and no styling change, so the only way to find out was to
   * read the file afterwards. The caret goes back to where the refused edit began rather than to the
   * end of the payload, which is where a controlled field otherwise leaves it: losing the paste and
   * the insertion point is two losses for one gesture.
   */
  const refuse = (nextPayload: string, delimiter: string) => {
    const at = commonPrefixLength(payload, nextPayload);
    pendingSelectionRef.current = { start: at, end: at };
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.value = payload;
      textarea.setSelectionRange(at, at);
    }
    setRefusedDelimiter(delimiter);
  };

  /** Splice a new payload between the delimiters the file already has. */
  const commit = (nextPayload: string, selection: PendingSelection) => {
    pendingSelectionRef.current = selection;
    const encoded = lineEnding === "\r\n" ? nextPayload.replace(/\n/g, "\r\n") : nextPayload;
    const next = fence ? `${fence.prefix}${encoded}${fence.suffix}` : encoded;
    if (next === source) return;
    // A payload carrying a line that would close this fence cannot be spliced back. The parent
    // re-splits whatever this hands it, so a source that no longer comes apart into the same three
    // parts is put back together wrapped in its delimiters a second time: typing the third backtick
    // of a ``` line duplicated the opening fence into the file and cut the Block in two. Refused
    // rather than written, the way a Mermaid Block refuses the same edit.
    if (fence) {
      const resplit = splitDelimitedBlockSource("fenced_code", next);
      if (!resplit || resplit.prefix !== fence.prefix || resplit.payload !== encoded) {
        refuse(nextPayload, fence.delimiter);
        return;
      }
    }
    if (refusedDelimiter) setRefusedDelimiter(null);
    onChange(blockId, next);
  };

  /**
   * Record where in the payload a press landed, before the Block is active.
   *
   * The `<code>` element holds the payload and nothing else — no marker, no label, no decoration —
   * so counting the text before the pressed node gives a payload offset directly. That is also why
   * nothing visually hidden may ever be added inside it: a screen-reader-only string is real text and
   * would push every press several characters off.
   */
  const pressCode = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (editable) return;
    const target = event.target as HTMLElement | null;
    // The language chip is its own control, and a press on it is not a request for a caret.
    if (target?.closest("button,input")) return;
    const code = codeRef.current;
    if (!code || !target || !code.contains(target)) return;
    const offset = payloadOffsetAtPoint(code, event.clientX, event.clientY);
    if (offset === null) return;
    // Without this the browser's default action focuses the row — after this handler has run — so
    // the textarea would mount, focus itself and immediately lose focus in the same gesture, leaving
    // a Block that looks focused with every keystroke going to the document.
    event.preventDefault();
    const at = Math.min(offset, payload.length);
    pendingSelectionRef.current = { start: at, end: at };
    dragOriginRef.current = { at, x: event.clientX, y: event.clientY };
  };

  /**
   * Turn a press that travelled into a selection.
   *
   * The press mounts the editing surface over the rendered code, so the browser's own drag-selection
   * has nothing left to act on by the time the pointer comes up: dragging across a word in a code
   * Block that was not already being edited selected nothing. The release point is measured against
   * the rendered code, which is still there — it is never unmounted — so the range is exact.
   */
  const releaseCode = (event: ReactMouseEvent<HTMLDivElement>) => {
    const origin = dragOriginRef.current;
    dragOriginRef.current = null;
    if (!origin) return;
    // A click is not a drag; see the same guard in markdown-container-block.tsx.
    if (Math.abs(event.clientX - origin.x) < 4 && Math.abs(event.clientY - origin.y) < 4) return;
    const from = origin.at;
    const code = codeRef.current;
    if (!code) return;
    const offset = payloadOffsetAtPoint(code, event.clientX, event.clientY);
    if (offset === null) return;
    const to = Math.min(offset, payload.length);
    if (to === from) return;
    pendingSelectionRef.current = { start: Math.min(from, to), end: Math.max(from, to) };
    const textarea = textareaRef.current;
    if (textarea) textarea.setSelectionRange(Math.min(from, to), Math.max(from, to));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget;
    const mod = event.metaKey || event.ctrlKey;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    if (event.key === "Tab") {
      // Tab indents rather than moving focus. Indentation is content in a code Block, and a Tab that
      // escaped to the next control would make a code Block the one place in the editor where the
      // obvious key does nothing to the text.
      event.preventDefault();
      const shifted = shiftPayloadIndent(payload, start, end, event.shiftKey ? -1 : 1);
      if (shifted) commit(shifted.payload, shifted.selection);
      return;
    }

    if (event.key === "Enter" && !mod) {
      // A code Block is genuinely multi-line, so Enter is a newline and the textarea's own handling
      // is exactly right. Deliberately not handed back to the Block: the Block reads Enter as "split
      // here", which would cut the Block in half every time the user started a new line.
      return;
    }

    if (event.key.startsWith("Arrow")) {
      // Alt+Arrow moves the Block and belongs to it wherever the caret is.
      if (event.altKey) {
        onKeyDown?.(event);
        return;
      }
      // A modifier or a held Shift makes this the field's own navigation or selection — start of
      // line, extend by a line — and the payload is multi-line, so it has somewhere to go.
      if (mod || event.shiftKey) return;
      if (!atPayloadEdge(payload, event.key, start, end)) return;
      // Only at the payload's own edge does an arrow mean "leave this Block".
      onKeyDown?.(event);
      return;
    }

    if ((event.key === "Backspace" || event.key === "Delete") && !mod) {
      // Inside the payload these delete a character; at its edge they are the Block's merge and are
      // handed back. Mod-modified variants — delete Block, delete to line start — are never the
      // field's, so they fall through to the Block below.
      const collapsed = start === end;
      const atEdge = event.key === "Backspace" ? start === 0 : start === payload.length;
      if (!collapsed || !atEdge) return;
    }

    // Everything this surface does not own belongs to the Block: Escape, undo, redo, duplicate,
    // delete, move. A surface that swallowed them would leave the Block unreachable from its own
    // caret — with the caret in a code Block, Ctrl/Cmd+Z would reach nothing at all.
    onKeyDown?.(event);
  };

  return (
    <div className="relative" onPointerDown={pressCode} onClick={releaseCode}>
      {/*
       * The scroll box, and the only element in the Block that scrolls.
       *
       * It has to be the *shared parent* of both layers rather than the `<pre>` itself: the textarea
       * is positioned against the sizing wrapper inside, so a `<pre>` that scrolled on its own would
       * carry the glyphs sideways and leave the caret behind. Scrolling their common ancestor moves
       * them as one.
       *
       * The `<pre>` keeps painting the surface, because it is never narrower than this box; the
       * radius is repeated here so the corners are clipped from the *visible* box. Without it the
       * Block's rounded left corner is whatever happens to be at scroll offset 0 and the edge turns
       * square as soon as the code is scrolled.
       */}
      <div
        data-code-scroll
        // `autohide-scrollbar` is the app's own idiom for a scroll surface inside content: a track
        // whose thumb is transparent until the pointer or focus is on the Block. The document
        // default is an always-drawn 8px bar, which inside a code Block reads as a piece of UI
        // sitting on the code. The track only takes its height on a Block that actually overflows.
        className="autohide-scrollbar rounded-lg"
        style={{
          overflowX: "auto",
          overflowY: "hidden",
          // `autohide-scrollbar` also asks for a stable gutter, which is right for the panels it was
          // written for and wrong here: a box that can only scroll sideways still had 11px reserved
          // down its right edge for a vertical bar that can never appear, and every code Block —
          // including the ones with nothing to scroll — lost that much of its content width.
          scrollbarGutter: "auto",
        }}
      >
        {/*
         * Sized by the longest line, never narrower than the Block.
         *
         * `max-content` is what gives the scroll box something to scroll; `min-width: 100%` keeps a
         * short Block full width, so the surface behind two words of code is still a code Block and
         * not a chip. The textarea's `inset-0` resolves against this element, which is why both
         * layers end up on exactly the same box at exactly the same width.
         */}
        <div className="relative" style={{ width: "max-content", minWidth: "100%" }}>
          <pre
            data-testid="fenced-code-block"
            className="rounded-lg bg-muted"
            style={{
              ...CODE_LAYER_METRICS,
              // One line of code plus the padding above and below it, because the editing surface is
              // sized to this element's box. An empty payload renders no line here but always shows
              // one line of caret in the textarea, so a `<pre>` allowed to collapse to its padding
              // would clip the line the caret is on.
              minHeight: "calc(2rem + 1.45em)",
              // `.markdown-page pre` also declares `overflow-x: auto`, which would make this element
              // a second, competing scroll container inside the one above — and the wrong one, since
              // it is the layer the caret is *not* in.
              overflow: "visible",
            }}
          >
            <HighlightedCode ref={codeRef} code={payload} language={language} />
          </pre>
          {/*
           * The editing surface: same text, same metrics, no colour of its own.
           *
           * Absolutely positioned over the `<pre>`, so it cannot contribute a single pixel of height
           * — activation leaves the Block exactly the size it was. It is mounted in both states and
           * made inert rather than removed while the Block is inactive: read-only, out of the tab
           * order, out of the accessibility tree and transparent to the pointer, so the press that
           * activates the Block still reaches the code underneath it. A surface that appeared on
           * activation is how every earlier version of this grew on focus.
           */}
          <textarea
            ref={textareaRef}
            aria-label="Markdown block"
            aria-hidden={editable ? undefined : true}
            data-native-block-editor={editable ? "" : undefined}
            data-code-editing-surface
            readOnly={!editable}
            tabIndex={editable ? 0 : -1}
            // Squiggles under code are noise, and the browser's dictionary does not know any
            // language in the fence.
            spellCheck={false}
            // `off`, so the field lays its text out on one line per line of source exactly as the
            // `<pre>` under it now does. Left on `soft` it would keep wrapping while the rendered
            // code did not, and the caret would be a line further down with every wrap above it.
            wrap="off"
            className="absolute inset-0 h-full w-full font-mono"
            style={{
              ...CODE_LAYER_METRICS,
              // The glyphs the user reads are the highlighted ones underneath; this layer
              // contributes only a caret and a selection. Making the text transparent rather than
              // hiding the field is what keeps the caret on the real character positions.
              color: "transparent",
              caretColor: "hsl(var(--foreground))",
              background: "transparent",
              resize: "none",
              // This layer is exactly as wide as the box it is stretched over, which is as wide as
              // the longest line, so it has nothing of its own to scroll. Saying so keeps it that
              // way: a field that scrolled itself would slide its caret off the glyph underneath.
              overflow: "hidden",
              outline: "none",
              boxShadow: "none",
              appearance: "none",
              pointerEvents: editable ? undefined : "none",
            }}
            value={payload}
            onChange={(event) => {
              const value = event.target.value;
              const caret = event.target.selectionStart;
              if (composingRef.current) {
                // Mid-composition text is not something to write to the file: sending it through
                // the parent and back replaces the field's value under the IME and drops the
                // candidate.
                setComposingValue(value);
                return;
              }
              commit(value, { start: caret, end: event.target.selectionEnd });
            }}
            onCompositionStart={(event) => {
              composingRef.current = true;
              setComposingValue(event.currentTarget.value);
            }}
            onCompositionUpdate={(event) => setComposingValue(event.currentTarget.value)}
            onCompositionEnd={(event) => {
              composingRef.current = false;
              const settled = event.currentTarget.value;
              const caret = event.currentTarget.selectionEnd;
              setComposingValue(null);
              commit(settled, { start: caret, end: caret });
            }}
            onKeyDown={handleKeyDown}
          />
        </div>
      </div>
      {refusedDelimiter ? (
        // Out of flow, below the Block, so a refusal cannot move the code the user is looking at.
        // `role="status"` rather than an alert: nothing was written and nothing is at risk, the user
        // simply has to be told that the characters they typed or pasted did not go in.
        <p
          role="status"
          data-code-edit-refused
          className="pointer-events-none absolute left-0 right-0 top-full z-20 mt-1 text-xs text-muted-foreground"
        >
          {`A ${refusedDelimiter} line would end this code Block, so that edit was not applied.`}
        </p>
      ) : null}
      {onSetLanguage ? (
        <CodeLanguageChip language={language} onCommit={(next) => onSetLanguage(blockId, next)} />
      ) : language ? (
        <span
          data-code-language
          className={`pointer-events-none select-none bg-muted text-muted-foreground ${CODE_CHIP_CLASSES}`}
        >
          {language}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The payload, highlighted once its grammar has loaded.
 *
 * Plain text first, upgraded in place, so a code Block is never blank while a grammar loads and never
 * disappears if one fails. Tokens are rendered as React elements: nothing derived from the document
 * becomes markup (ADR-0011).
 *
 * A copy of the row's `HighlightedCode`, which is module-private there. The duplicate goes away with
 * the row's fenced-code arm once this component is wired in.
 */
function HighlightedCode({
  code,
  language,
  ref,
}: {
  code: string;
  language: string;
  ref: Ref<HTMLElement>;
}) {
  const [tokens, setTokens] = useState<readonly CodeToken[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTokens(null);
    if (!resolveCodeLanguage(language)) return () => undefined;
    void highlightCodeTokens(code, language).then((next) => {
      if (!cancelled) setTokens(next);
    });
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  // A `<pre>` drops the empty line a trailing newline would produce and a textarea does not, so
  // without this the last line of the code sits one line above the caret that is on it.
  const trailer = code.endsWith("\n") || code === "" ? "\n" : "";

  if (!tokens) {
    return (
      <code ref={ref} style={CODE_INNER_METRICS}>
        {code}
        {trailer}
      </code>
    );
  }
  return (
    <code ref={ref} style={CODE_INNER_METRICS}>
      {tokens.map((token, index) => (
        <span key={index} className={token.className ?? undefined}>
          {token.text}
        </span>
      ))}
      {trailer}
    </code>
  );
}

/**
 * What the shared inline-code styling has to stop doing once a caret is laid over it.
 *
 * `.markdown-page code` in editor.css styles every `code` element in a Page as an inline-code chip:
 * `px-1 py-0.5`, a tint and a radius. On the `<code>` inside a fenced Block that padding lands at
 * the start of the inline box, which is the first character of the first line — so the highlighted
 * text begins 4px to the right of where the textarea's identically-metered first line begins, and
 * the caret sits visibly beside the glyph it is supposed to be on. Only line one is affected, which
 * is exactly the kind of small, positional wrongness that gets reported as "the cursor is off" and
 * never reproduced. The tint and the radius go with it: with no padding they enclose nothing, and
 * the surface underneath is already `bg-muted`.
 */
const CODE_INNER_METRICS: CSSProperties = {
  padding: 0,
  background: "transparent",
  borderRadius: 0,
};

/**
 * Where the language label sits, and how big it is allowed to be.
 *
 * It has to fit *entirely inside the `pre`'s 16px top padding*, above line 1's glyph band. Sized by
 * its own text and dropped 6px down, it was 25px tall and overlapped the first line by its full
 * height — a grey word composited straight onto the first line of code, with no plate behind it
 * because the background only appeared under the pointer. `leading-[14px]` with no vertical padding
 * makes the chip exactly 14px, and `top-0.5` leaves it 1.5px clear of the first glyph at any line
 * length, so it cannot reach the code however long line 1 is.
 *
 * Every state carries an opaque background — `bg-muted`, the `pre`'s own surface, so it is seamless
 * at rest — because a transparent label is what let it composite over glyphs. The padding above line
 * 1 is the same 16px on the textarea, so the region the chip takes out of the editing surface holds
 * no character to put a caret on. The field uses a ring rather than a border, which would add 2px to
 * a box measured to fit the padding exactly.
 */
const CODE_CHIP_CLASSES =
  "absolute right-2 top-0.5 z-10 rounded px-1.5 py-0 font-mono text-[11px] leading-[14px]";

/**
 * The code Block's language, as an editable chip.
 *
 * Absolutely positioned and mounted in both states, so it can neither add height on activation nor
 * disappear from a Block that is being edited. A free-text field rather than a menu, because a fence
 * info string is arbitrary in Markdown and a closed list would silently drop whatever the file
 * already says.
 *
 * Shown at rest rather than on hover. At `opacity: 0` a Block's language was unreadable until the
 * pointer was on the row, so the one thing that says what a code Block *is* could only be found by
 * hunting for it — and both reference products label the Block permanently.
 *
 * A copy of the row's `CodeLanguageChip`, which is module-private there; it goes away with the row's
 * fenced-code arm.
 */
function CodeLanguageChip({
  language,
  onCommit,
}: {
  language: string;
  onCommit: (language: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(language);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next !== language) onCommit(next);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        aria-label="Code language"
        value={draft}
        placeholder="language"
        spellCheck={false}
        className={`w-24 bg-background text-foreground outline-none ring-1 ring-ring ${CODE_CHIP_CLASSES}`}
        onChange={(event) => setDraft(event.target.value)}
        onClick={(event) => event.stopPropagation()}
        onBlur={commit}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraft(language);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      data-code-language
      aria-label={language ? `Code language: ${language}` : "Set code language"}
      // `z-10` keeps the chip above the editing surface. The textarea covers the whole Block, so
      // without it the chip is unclickable for exactly as long as the Block is being edited.
      className={`bg-muted text-muted-foreground transition-colors duration-[20ms] ease-in hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${CODE_CHIP_CLASSES}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        setDraft(language);
        setEditing(true);
      }}
    >
      {language || "plain text"}
    </button>
  );
}

/**
 * The line ending a commit writes back into the payload.
 *
 * CRLF only when the Block already agrees with itself about it: every break in the payload is a
 * CRLF, or the payload holds no break at all and the opening fence line ended in one. A Block with
 * mixed endings stays on LF, because the textarea has already flattened them by the time anything
 * can be read back and re-encoding would impose CRLF on lines that never carried it — inventing
 * bytes is worse than the flattening it would be trying to undo.
 */
function payloadLineEnding(prefix: string, rawPayload: string): "\r\n" | "\n" {
  const breaks = rawPayload.match(/\r\n|\n|\r/g);
  if (breaks) return breaks.every((candidate) => candidate === "\r\n") ? "\r\n" : "\n";
  return prefix.endsWith("\r\n") ? "\r\n" : "\n";
}

/**
 * Where two payloads stop agreeing, which is where the refused edit began.
 *
 * A field reports its whole value, not the edit that produced it, so this is what recovers the
 * caret: the paste that was turned away started exactly here, and this is where the user was.
 */
function commonPrefixLength(before: string, after: string): number {
  const limit = Math.min(before.length, after.length);
  let index = 0;
  while (index < limit && before[index] === after[index]) index += 1;
  return index;
}

/** Whether an arrow key at this caret would leave the payload rather than move inside it. */
function atPayloadEdge(payload: string, key: string, start: number, end: number): boolean {
  if (start !== end) return false;
  if (key === "ArrowLeft") return start === 0;
  if (key === "ArrowRight") return start === payload.length;
  if (key === "ArrowUp") return !payload.slice(0, start).includes("\n");
  if (key === "ArrowDown") return !payload.slice(start).includes("\n");
  return false;
}

/**
 * Shift every line the selection touches by one two-space step.
 *
 * Two spaces matches what the rest of the editor already writes for an indent-significant Block, so
 * a code Block does not indent by a different amount than the Block above it. A collapsed caret gets
 * a plain insertion instead, because indenting the whole line would move text the user was in the
 * middle of and put the caret somewhere they did not leave it.
 */
function shiftPayloadIndent(
  payload: string,
  start: number,
  end: number,
  direction: -1 | 1
): { payload: string; selection: PendingSelection } | null {
  if (start === end && direction === 1) {
    return {
      payload: `${payload.slice(0, start)}  ${payload.slice(start)}`,
      selection: { start: start + 2, end: start + 2 },
    };
  }
  const lineStart = start === 0 ? 0 : payload.lastIndexOf("\n", start - 1) + 1;
  const lineEndIndex = payload.indexOf("\n", end);
  const lineEnd = lineEndIndex === -1 ? payload.length : lineEndIndex;
  const region = payload.slice(lineStart, lineEnd);
  const lines = region.split("\n");
  const shifted = lines.map((line) =>
    direction === 1 ? `  ${line}` : line.replace(/^ {1,2}/, "")
  );
  const next = shifted.join("\n");
  if (next === region) return null;
  const firstDelta = shifted[0].length - lines[0].length;
  const totalDelta = next.length - region.length;
  return {
    payload: `${payload.slice(0, lineStart)}${next}${payload.slice(lineEnd)}`,
    selection: {
      start: Math.max(lineStart, start + firstDelta),
      end: Math.max(lineStart, end + totalDelta),
    },
  };
}

/**
 * Offset of a point within the rendered code.
 *
 * A press has to land the caret on the character under it. Without this, activating a code Block put
 * the caret wherever the previous surface happened to focus, so clicking the middle of line 4 jumped
 * to the end of the Block.
 */
function payloadOffsetAtPoint(code: HTMLElement, x: number, y: number): number | null {
  const host = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = host.caretPositionFromPoint?.(x, y);
  const range = position ? null : host.caretRangeFromPoint?.(x, y);
  const node = position ? position.offsetNode : (range?.startContainer ?? null);
  const offset = position ? position.offset : (range?.startOffset ?? 0);
  if (!node || node.nodeType !== Node.TEXT_NODE || !code.contains(node)) return null;
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  let total = 0;
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (current === node) return total + offset;
    total += (current.nodeValue ?? "").length;
  }
  return null;
}
