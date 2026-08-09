"use client";

import { Pencil } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import type { InPlaceBlockProps } from "@/editor/markdown-block/in-place-block";
import { parseMarkdownImageBlock } from "@/editor/markdown-block/markdown-image";
import { cn } from "@/lib/utils";

/** The kinds that render something the user looks at and never types into. */
export type StaticBlockKind = "image" | "thematic_break" | "collection";

export interface MarkdownStaticBlockProps extends InPlaceBlockProps {
  readonly kind: StaticBlockKind;
  /**
   * The Block's rendered form, which is `BlockPreview`'s arm for this kind.
   *
   * Taken as a child rather than rebuilt here so there is exactly one implementation of what an
   * image, a divider and a collection look like. A second copy would drift from the first, and the
   * copy that drifts is the one the user edits.
   */
  readonly children: ReactNode;
}

const SHELL_ROLE_LABEL: Record<StaticBlockKind, string> = {
  image: "Image",
  thematic_break: "Divider",
  collection: "Collection",
};

/**
 * An image, a divider or a collection, selected rather than opened when it is activated.
 *
 * These three kinds have nothing to type into, and pressing one used to replace the picture, the
 * rule or the projected table with a textarea holding `![Alt](path.png)`, `---` or the raw fence.
 * That is the complaint this component answers: there is no state in which the source is shown.
 * Notion and Feishu both put a selection outline around the rendered thing instead, and everything
 * that can still be changed about it is reached from a control drawn over it.
 *
 * The rendered form is the `children` of a shell that is mounted in both states, so activation
 * changes attributes on an element and never tears one down. Rule 4 still needs one focusable
 * element carrying `data-native-block-editor`, and here that is the shell itself: a Block with no
 * text field still has to answer Escape, Backspace and the arrow keys, and the runtime, the caret
 * machinery and the test matrix all look for that element by attribute.
 */
export function MarkdownStaticBlock({
  blockId,
  source,
  kind,
  editable,
  onChange,
  onKeyDown,
  children,
}: MarkdownStaticBlockProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const image = kind === "image" ? splitImageSource(source) : null;

  // A Block that is active must own the focus, the way an activated paragraph owns its caret.
  // Guarded on the shell not already containing the active element so that a press which lands
  // directly on the alt-text field is not pulled back out to the shell by this effect.
  useEffect(() => {
    if (!editable) return;
    const shell = shellRef.current;
    if (!shell || shell.contains(document.activeElement)) return;
    shell.focus({ preventScroll: true });
  }, [editable]);

  const label =
    kind === "image" && image?.alt
      ? `${SHELL_ROLE_LABEL.image}: ${image.alt}`
      : SHELL_ROLE_LABEL[kind];

  return (
    // An ordinary block box, and the containing block for everything positioned over the Block
    // below. The rendered forms themselves are not reliable anchors — an image arrives wrapped in a
    // `<figure class="overflow-hidden">` that would clip a panel, and a collection projects a table
    // whose cells Chromium does not treat as containing blocks for absolutely positioned children.
    <div className="relative">
      <div
        ref={shellRef}
        // Only while the Block is active. A read-only copy of a Block — printed, or nested inside a
        // toggle — must not answer to the machinery that looks this attribute up, and there is
        // exactly one active Block, so there is exactly one of these in the document.
        data-native-block-editor={editable ? "" : undefined}
        data-static-block={kind}
        role="group"
        aria-label={label}
        // Reachable by Tab only while active; otherwise the row owns keyboard entry and a shell that
        // also took a tab stop would put two stops on one Block.
        tabIndex={editable ? 0 : -1}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          // Every key belongs to the Block, because this shell owns no text and therefore owns no
          // key. Forwarding only Escape, Backspace and Enter would repeat the mistake the table
          // cell made with Ctrl/Cmd+Z: the Block would be the one you could select and not undo,
          // duplicate, delete or move.
          onKeyDown?.(event);
        }}
        // The ring is drawn by `box-shadow`, so a Block that gains it on activation is the same
        // height as the one that did not have it. A border would have cost two pixels and moved
        // every Block below it the moment the user pressed this one.
        className={cn(
          "rounded-md outline-none ring-offset-0 transition-shadow duration-[20ms] ease-in",
          editable && "ring-2 ring-primary/50"
        )}
      >
        {children}
      </div>
      {kind === "image" && editable && image ? (
        <ImageSourceControls
          image={image}
          onCommit={(next) => {
            if (next !== source) onChange(blockId, next);
          }}
          onDismissed={() => shellRef.current?.focus({ preventScroll: true })}
        />
      ) : null}
    </div>
  );
}

/**
 * An image Block's source, taken apart so the two fields can be put back without the rest moving.
 *
 * Every run the user is not editing is kept as the bytes the file actually holds, not as the value
 * the parser decoded out of them. The two are not interchangeable: `parseMarkdownImageBlock` reports
 * the alt of `![*Fig* 1](a.png)` as `Fig 1`, its destination of `![a](<my file.png>)` as
 * `my file.png`, and its title of `![a](p.png 'Fig')` as `Fig`. Rebuilding the expression from those
 * decoded values rewrote the emphasis out of the alt, dropped the angle brackets, and turned every
 * title into a double-quoted one with exactly one space in front of it — all of it in a Block whose
 * user had asked to change something else entirely.
 */
interface ImageSourceParts {
  /** The decoded alt, which is what the alt field shows and what a changed alt is compared against. */
  readonly alt: string;
  readonly destination: string;
  /** The decoded CommonMark title, used only to check that a commit did not disturb it. */
  readonly title: string | null;
  /** The alt run exactly as written, between `![` and `](`. */
  readonly altRaw: string;
  /** The destination run exactly as written, angle brackets and escapes included. */
  readonly destinationRaw: string;
  /** Everything between the destination and the closing paren: the padding and the title, verbatim. */
  readonly titleRaw: string;
  /** Leading indentation and trailing spaces, preserved so a commit rewrites only the expression. */
  readonly prefix: string;
  readonly suffix: string;
}

function splitImageSource(source: string): ImageSourceParts | null {
  // The parser rather than a regex of our own: an image Block is only classified as one because
  // `parseMarkdownImageBlock` accepted it, so anything else here would disagree with the kind at
  // the edges — a bracket in the alt text, an angle-bracketed path, a percent-encoded space.
  const parsed = parseMarkdownImageBlock(source);
  if (!parsed.ok) return null;
  const prefix = /^[ \t]*/.exec(source)?.[0] ?? "";
  const suffix = /[ \t]*$/.exec(source)?.[0] ?? "";
  const runs = splitImageExpression(source.slice(prefix.length, source.length - suffix.length));
  // A parsed image whose expression cannot be taken apart would have to be rebuilt from decoded
  // values, which is the byte loss described above. Returning null instead leaves the Block with no
  // Edit control at all: the image still renders, and nothing is written that the user did not ask
  // for.
  if (!runs) return null;
  return {
    alt: parsed.image.alt,
    destination: parsed.image.destination,
    title: parsed.image.title,
    ...runs,
    prefix,
    suffix,
  };
}

/**
 * The three runs of `![alt](destination title)`, located rather than decoded.
 *
 * The alt is found by scanning for the `]` that closes it at bracket depth zero, honouring backslash
 * escapes, because an alt is allowed to contain balanced brackets and even a whole link; stopping at
 * the first `]` would have cut `![a [b](c) d](e.png)` in the wrong place.
 */
function splitImageExpression(
  expression: string
): Pick<ImageSourceParts, "altRaw" | "destinationRaw" | "titleRaw"> | null {
  if (!expression.startsWith("![") || !expression.endsWith(")")) return null;
  let cursor = 2;
  let depth = 0;
  for (; cursor < expression.length; cursor += 1) {
    const character = expression[cursor];
    if (character === "\\") {
      cursor += 1;
      continue;
    }
    if (character === "[") depth += 1;
    else if (character === "]") {
      if (depth === 0) break;
      depth -= 1;
    }
  }
  if (expression[cursor] !== "]" || expression[cursor + 1] !== "(") return null;

  const body = expression.slice(cursor + 2, expression.length - 1);
  const destinationEnd = destinationRunLength(body);
  return {
    altRaw: expression.slice(2, cursor),
    destinationRaw: body.slice(0, destinationEnd),
    titleRaw: body.slice(destinationEnd),
  };
}

/** How much of a link body the destination occupies, so the title behind it can be kept verbatim. */
function destinationRunLength(body: string): number {
  let cursor = 0;
  if (body.startsWith("<")) {
    cursor = 1;
    while (cursor < body.length) {
      if (body[cursor] === "\\") {
        cursor += 2;
        continue;
      }
      cursor += 1;
      if (body[cursor - 1] === ">") break;
    }
    return cursor;
  }
  let parens = 0;
  while (cursor < body.length) {
    const character = body[cursor];
    if (character === "\\") {
      cursor += 2;
      continue;
    }
    // A bare destination ends at the first whitespace, or at the paren that closes the body. Balanced
    // parens inside it are part of the path, which is how `![a](notes/plan(final).png)` stays whole.
    if (/\s/.test(character)) break;
    if (character === "(") parens += 1;
    if (character === ")") {
      if (parens === 0) break;
      parens -= 1;
    }
    cursor += 1;
  }
  return cursor;
}

/**
 * The Markdown for an edited image, or null when the values cannot be written as one.
 *
 * A field the user left alone is spliced back as the bytes it already had, so the only part of the
 * file a commit can change is the part that was typed into.
 *
 * The candidate is parsed back before it is returned, and the round trip has to produce the alt,
 * destination and title that went in. An image Block stops being an image Block the moment its
 * source no longer parses as one: it would fall back to a paragraph, and a paragraph shows its raw
 * text. Clearing the path to retype it would therefore have dropped the user into the raw
 * `![Alt](path.png)` this component exists to keep off the screen.
 */
export function buildImageBlockSource(
  parts: ImageSourceParts,
  alt: string,
  destination: string,
  title: string
): string | null {
  const target = destination.trim();
  const flattenedAlt = flattenImageAlt(alt);
  const destinationRaw =
    target === parts.destination ? parts.destinationRaw : escapeImageDestination(target);
  // CommonMark's title is the figure caption: rendered below the image (`<figcaption>` in
  // `BlockPreview`), read from no state but the file. An empty field means no title at all rather
  // than an empty-string one, since `"" !== null` on the way back out and every commit would be
  // "rejected" by the round-trip check below without ever having changed anything.
  const wantTitle = flattenImageAlt(title).trim() || null;
  const titleRaw = wantTitle === parts.title ? parts.titleRaw : buildImageTitleRaw(wantTitle);
  // Written plainly first and escaped only if that failed, because most alt text needs no escaping
  // at all and a file full of `Q3 \(final\)` is worse to read than the one the user typed. The
  // fallback is what lets an asterisk or a backtick be typed into alt text: written plainly those
  // become emphasis and code, the decoded alt then disagrees with the field, and the commit would
  // otherwise be refused for a character the user is entitled to use.
  const altCandidates =
    alt === parts.alt
      ? [parts.altRaw]
      : [escapeImageAlt(flattenedAlt), escapeImageAltFully(flattenedAlt)];
  for (const altRaw of altCandidates) {
    const next = `${parts.prefix}![${altRaw}](${destinationRaw}${titleRaw})${parts.suffix}`;
    const parsed = parseMarkdownImageBlock(next);
    if (!parsed.ok) continue;
    // A parsed alt is single-line by construction, so the flattened value is what an untouched alt
    // decodes to as well and the same comparison covers both branches.
    if (parsed.image.alt !== flattenedAlt) continue;
    if (parsed.image.destination !== target) continue;
    if (parsed.image.title !== wantTitle) continue;
    return next;
  }
  return null;
}

/** The padding-and-title run for a changed title: nothing at all, or a space then a quoted title. */
function buildImageTitleRaw(title: string | null): string {
  if (title === null) return "";
  return ` "${escapeImageTitle(title)}"`;
}

function escapeImageTitle(title: string): string {
  // The backslash and the delimiting quote are the two characters that would end the title early
  // or invent a literal backslash the file never had.
  return title.replace(/[\\"]/g, "\\$&");
}

function flattenImageAlt(alt: string): string {
  // A newline would end the Block and split the image in two, so it can never survive as itself.
  return alt.replace(/[\r\n]+/g, " ");
}

function escapeImageAlt(alt: string): string {
  // The brackets and the backslash are the three characters that change the shape of the expression
  // rather than its text: they would close the alt early, open a nested image inside it, or eat the
  // character behind them.
  return alt.replace(/[\\[\]]/g, "\\$&");
}

function escapeImageAltFully(alt: string): string {
  // Every ASCII punctuation mark CommonMark accepts a backslash escape for. Reached only when the
  // plain form did not survive the round trip, which means something in it was being read as markup.
  return alt.replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, "\\$&");
}

function escapeImageDestination(destination: string): string {
  if (destination === "") return "";
  // A bare destination ends at the first space or unbalanced paren, so anything that could end it
  // early goes inside angle brackets instead. Paths that need neither are written exactly as typed,
  // which keeps the common case byte-identical to what the user sees in the field.
  if (!/[\s()<>\\]/.test(destination)) return destination;
  return `<${destination.replace(/[\\<>]/g, "\\$&")}>`;
}

/**
 * The alt text and path of the image, reached from a button drawn over it.
 *
 * Positioned out of flow, which is what rule 2 requires of anything that appears only while the
 * Block is active: a panel in the flow would push the rest of the Page down by its own height every
 * time the user pressed an image, and back up again when they pressed away.
 */
function ImageSourceControls({
  image,
  onCommit,
  onDismissed,
}: {
  image: ImageSourceParts;
  onCommit: (nextSource: string) => void;
  /** Called after the panel closes, so the shell can take the focus the panel is giving up. */
  onDismissed: () => void;
}) {
  const [draft, setDraft] = useState<{ alt: string; destination: string; title: string } | null>(
    null
  );
  const [rejected, setRejected] = useState(false);
  const altRef = useRef<HTMLInputElement>(null);
  // Whether the panel has already given up its draft. State cannot answer this in time: closing
  // moves the focus back to the shell in the same tick, the panel is still in the DOM when that
  // happens, and its own focusout handler then committed a second time — one keystroke, two
  // identical writes, and two entries in the undo stack.
  const closingRef = useRef(false);
  const open = draft !== null;

  // On the transition to open, and not on every draft. Keyed on the draft itself this pulled the
  // focus back to the alt field on each keystroke, so the path could only ever be typed one
  // character at a time.
  useEffect(() => {
    if (open) altRef.current?.focus();
  }, [open]);

  const close = () => {
    closingRef.current = true;
    setDraft(null);
    setRejected(false);
    onDismissed();
  };

  const commit = () => {
    if (!draft || closingRef.current) return;
    const next = buildImageBlockSource(image, draft.alt, draft.destination, draft.title);
    if (next === null) {
      // Kept open with the draft intact. Closing here would throw away what the user typed and
      // leave the old path in the file with no sign that anything was rejected.
      setRejected(true);
      return;
    }
    onCommit(next);
    close();
  };

  if (!draft) {
    return (
      <button
        type="button"
        aria-label="Edit image alt text, path and caption"
        title="Edit image"
        className="absolute z-20 flex items-center gap-1 rounded-md bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow-sm ring-1 ring-border backdrop-blur transition-colors duration-[20ms] ease-in hover:text-foreground"
        // Inline rather than utility classes, because the button has to sit inside the image's own
        // padding: a class that silently fails to generate would park it at the top-left corner of
        // the Block, over the first thing the user wants to see.
        style={{ top: 8, right: 8 }}
        // The press stops here rather than reaching the row underneath, which treats a press on a
        // Block as a request to activate it and place a caret and calls `preventDefault` to do so —
        // that default is what gives this button its focus, and the row taking it away would open
        // the panel with the focus still on the shell behind it.
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => {
          closingRef.current = false;
          setDraft({ alt: image.alt, destination: image.destination, title: image.title ?? "" });
        }}
      >
        <Pencil aria-hidden="true" className="h-3 w-3" />
        Edit
      </button>
    );
  }

  return (
    <div
      className="absolute z-20 space-y-2 rounded-lg bg-popover p-2.5 text-popover-foreground shadow-xl ring-1 ring-border"
      style={{ top: 8, right: 8, width: 264 }}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        // Nothing pressed inside these fields is a Block command. Without this, Backspace clearing
        // the path would also reach whatever handles Backspace on a selected Block and delete the
        // image the user was in the middle of repairing.
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      }}
      onBlur={(event) => {
        // Focus leaving the panel altogether is the same intent as pressing Enter. A rejected
        // commit leaves the panel up rather than following focus out, so the failure is visible.
        if (event.currentTarget.contains(event.relatedTarget)) return;
        commit();
      }}
    >
      <label className="block text-[11px] font-medium text-muted-foreground">
        Alt text
        <input
          ref={altRef}
          value={draft.alt}
          spellCheck={false}
          className="mt-1 h-7 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
          onChange={(event) => {
            setRejected(false);
            setDraft({ ...draft, alt: event.target.value });
          }}
        />
      </label>
      <label className="block text-[11px] font-medium text-muted-foreground">
        Path
        <input
          value={draft.destination}
          spellCheck={false}
          className="mt-1 h-7 w-full rounded-md border border-border bg-background px-2 font-mono text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
          onChange={(event) => {
            setRejected(false);
            setDraft({ ...draft, destination: event.target.value });
          }}
        />
      </label>
      <label className="block text-[11px] font-medium text-muted-foreground">
        Caption
        <input
          value={draft.title}
          spellCheck={false}
          placeholder="Shown below the image"
          className="mt-1 h-7 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
          onChange={(event) => {
            setRejected(false);
            setDraft({ ...draft, title: event.target.value });
          }}
        />
      </label>
      {rejected ? (
        <p role="alert" className="text-[11px] text-destructive">
          These values cannot be written as a workspace image, so the Block was left as it was.
        </p>
      ) : null}
    </div>
  );
}
