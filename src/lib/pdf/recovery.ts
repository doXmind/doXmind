import {
  type ExportEditsPayload,
  type ExportHighlightPayload,
  type ExportPagePayload,
  type ExportTextEditPayload,
} from "@/lib/pdf/export-edited";
import {
  fetchPdfBlocks,
  paragraphsFromResponse,
  type PdfBlocksResponse,
} from "@/lib/pdf/parse-blocks";
import { getPdfjs } from "@/lib/pdf/pdfjs";
import type { PdfEditorState, PdfTextStyleRange } from "@/lib/storage/types";

type JsonObject = Record<string, unknown>;

export async function buildPdfRecoveryPayload(
  sourceBytes: Uint8Array,
  state: PdfEditorState
): Promise<ExportEditsPayload> {
  if (sourceBytes.byteLength === 0) throw new Error("PDF recovery source is empty");
  if (
    !isObject(state) ||
    (state.version !== undefined && state.version !== 1 && state.version !== 2)
  ) {
    throw new Error("PDF recovery state has an invalid structure");
  }
  assertKnownKeys(
    state,
    ["version", "edits", "textEdits", "paragraphEdits", "freeText", "highlights"],
    "PDF recovery state"
  );

  const pdfjs = getPdfjs();
  const document = await pdfjs.getDocument({ data: new Uint8Array(sourceBytes) }).promise;
  try {
    if (!Number.isInteger(document.numPages) || document.numPages < 1) {
      throw new Error("PDF recovery source has no readable pages");
    }

    const pages = new Map<number, ExportPagePayload>();
    const ensurePage = (pageIndex: number) => {
      assertPageIndex(pageIndex, document.numPages);
      let page = pages.get(pageIndex);
      if (!page) {
        page = { pageIndex, textEdits: [], freeText: [], highlights: [] };
        pages.set(pageIndex, page);
      }
      return page;
    };

    const textEdits = readOptionalRecord(state, "textEdits");
    const legacyEdits = readOptionalRecord(state, "edits");
    const paragraphEdits = readOptionalRecord(state, "paragraphEdits");

    // Extract only pages needed to reconstruct source text identifiers. A
    // full-document PDF.js text walk can exhaust the renderer on large PDFs,
    // while free-text and highlight recovery do not need source text at all.
    const textPageIndexes = new Set<number>();
    const sourceStylePageIndexes = new Set<number>();
    for (const [id, value] of Object.entries(textEdits)) {
      const edit = requireObject(value, `PDF text edit ${id}`);
      assertKnownKeys(
        edit,
        [
          "pageIndex",
          "text",
          "originalText",
          "x",
          "y",
          "width",
          "height",
          "fontSize",
          "originalFontSize",
          "fontName",
          "fontFamily",
          "color",
          "bold",
          "italic",
          "styleRanges",
        ],
        `PDF text edit ${id}`
      );
      const pageIndex = requirePageIndex(edit.pageIndex, document.numPages, `PDF text edit ${id}`);
      textPageIndexes.add(pageIndex);
      const recoveredText = requireBmpText(edit.text, `PDF text edit ${id}.text`);
      if (
        recoveredText !== "" &&
        (edit.color === undefined || edit.bold === undefined || edit.italic === undefined)
      ) {
        sourceStylePageIndexes.add(pageIndex);
      }
      requireBmpText(edit.originalText, `PDF text edit ${id}.originalText`);
      textEditFromGeometry(edit, `PDF text edit ${id}`);
      optionalPositiveNumber(edit.originalFontSize, `PDF text edit ${id}.originalFontSize`);
      optionalString(edit.fontName, `PDF text edit ${id}.fontName`);
    }
    for (const [id, value] of Object.entries(legacyEdits)) {
      const edit = requireObject(value, `PDF legacy edit ${id}`);
      assertKnownKeys(edit, ["text"], `PDF legacy edit ${id}`);
      const legacyText = requireBmpText(edit.text, `PDF legacy edit ${id}.text`);
      if (id in textEdits) {
        const current = requireObject(textEdits[id], `PDF text edit ${id}`);
        if (legacyText !== requireBmpText(current.text, `PDF text edit ${id}.text`)) {
          throw new Error(`PDF recovery has conflicting saved text for edit ${id}`);
        }
        continue;
      }
      const match = /^p([0-9]+)-t[0-9]+$/.exec(id);
      if (!match) throw new Error(`PDF recovery could not map legacy edit ${id}`);
      const pageIndex = Number(match[1]);
      assertPageIndex(pageIndex, document.numPages);
      textPageIndexes.add(pageIndex);
      if (legacyText !== "") sourceStylePageIndexes.add(pageIndex);
    }

    const paragraphPageIndexes = new Set<number>();
    for (const [id, value] of Object.entries(paragraphEdits)) {
      const edit = requireObject(value, `PDF paragraph edit ${id}`);
      assertKnownKeys(
        edit,
        [
          "pageIndex",
          "text",
          "originalText",
          "bbox",
          "fontSize",
          "fontFamily",
          "color",
          "bold",
          "italic",
          "textAlign",
          "styleRanges",
          "deleted",
        ],
        `PDF paragraph edit ${id}`
      );
      paragraphPageIndexes.add(
        requirePageIndex(edit.pageIndex, document.numPages, `PDF paragraph edit ${id}`)
      );
      requireBmpText(edit.text, `PDF paragraph edit ${id}.text`);
      requireBmpText(edit.originalText, `PDF paragraph edit ${id}.originalText`);
    }

    const sourceText = new Map<
      string,
      {
        pageIndex: number;
        text: string;
        rect: [number, number, number, number];
        fontSize: number;
        fontFamily?: string;
      }
    >();

    // Rebuild every p{page}-t{index} identifier from the source bytes. Both
    // the oldest `edits` and later `textEdits` need the original glyph rect
    // so moved text is redacted at its source location.
    for (const pageIndex of Array.from(textPageIndexes).sort((a, b) => a - b)) {
      const page = await document.getPage(pageIndex + 1);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      if (!textContent || !Array.isArray(textContent.items) || !isObject(textContent.styles)) {
        throw new Error(`PDF recovery could not read page ${pageIndex + 1} text`);
      }
      textContent.items.forEach((item, itemIndex) => {
        const candidate: unknown = item;
        if (!isObject(candidate) || typeof candidate.str !== "string" || candidate.str.length === 0)
          return;
        const id = `p${pageIndex}-t${itemIndex}`;
        const textItem = requirePdfTextItem(candidate, id);
        const transformed = pdfjs.Util.transform(viewport.transform, textItem.transform);
        if (
          !Array.isArray(transformed) ||
          transformed.length < 6 ||
          !transformed.every(isFiniteNumber)
        ) {
          throw new Error(`PDF source text ${id} has invalid geometry`);
        }
        const fontSize = Math.max(Math.abs(transformed[3]), textItem.height, 8);
        const height = Math.max(fontSize * 1.15, 10);
        const style = textItem.fontName ? textContent.styles[textItem.fontName] : undefined;
        sourceText.set(id, {
          pageIndex,
          text: textItem.str,
          rect: [
            transformed[4],
            transformed[5] - height * 0.78,
            Math.max(textItem.width, 8),
            height,
          ],
          fontSize,
          fontFamily:
            isObject(style) && typeof style.fontFamily === "string"
              ? style.fontFamily
              : fontFamilyFromLegacyName(textItem.fontName),
        });
      });
    }

    // Resolve every persisted text id before the style parse so malformed or
    // stale recovery state is reported directly, rather than being masked by
    // a later source-style lookup failure.
    for (const [id, value] of Object.entries(textEdits)) {
      const edit = requireObject(value, `PDF text edit ${id}`);
      const pageIndex = requirePageIndex(edit.pageIndex, document.numPages, `PDF text edit ${id}`);
      const source = sourceText.get(id);
      if (!source || source.pageIndex !== pageIndex) {
        throw new Error(`PDF recovery could not match text edit ${id}`);
      }
      if (source.text !== requireBmpText(edit.originalText, `PDF text edit ${id}.originalText`)) {
        throw new Error(`PDF recovery source text changed for edit ${id}`);
      }
    }
    for (const id of Object.keys(legacyEdits)) {
      if (id in textEdits) continue;
      if (!sourceText.has(id)) throw new Error(`PDF recovery could not match legacy edit ${id}`);
    }

    const blockPageIndexes = Array.from(
      new Set([...paragraphPageIndexes, ...sourceStylePageIndexes])
    ).sort((a, b) => a - b);
    const sourceBlocks =
      blockPageIndexes.length > 0
        ? await fetchPdfBlocks(sourceBytes, { pageIndexes: blockPageIndexes })
        : null;
    if (blockPageIndexes.length > 0 && !sourceBlocks) {
      throw new Error("PDF recovery could not parse source styling");
    }

    for (const [id, value] of Object.entries(textEdits)) {
      const edit = requireObject(value, `PDF text edit ${id}`);
      const pageIndex = requirePageIndex(edit.pageIndex, document.numPages, `PDF text edit ${id}`);
      const source = sourceText.get(id);
      if (!source || source.pageIndex !== pageIndex) {
        throw new Error(`PDF recovery could not match text edit ${id}`);
      }
      const originalText = requireBmpText(edit.originalText, `PDF text edit ${id}.originalText`);
      if (source.text !== originalText) {
        throw new Error(`PDF recovery source text changed for edit ${id}`);
      }
      const sourceStyle =
        edit.text !== "" &&
        (edit.color === undefined || edit.bold === undefined || edit.italic === undefined)
          ? requireMatchingSourceSpanStyle(
              sourceBlocks!,
              pageIndex,
              source.text,
              source.rect,
              `PDF text edit ${id}`
            )
          : undefined;
      const payload = textEditFromGeometry(
        {
          ...edit,
          color: edit.color ?? sourceStyle?.color,
          bold: edit.bold ?? sourceStyle?.bold,
          italic: edit.italic ?? sourceStyle?.italic,
        },
        `PDF text edit ${id}`,
        source.fontFamily
      );
      if (payload.text === "") payload.deleted = true;
      payload.originalRect = [...source.rect];
      ensurePage(pageIndex).textEdits!.push(payload);
    }

    if (Object.keys(paragraphEdits).length > 0) {
      const sourceParagraphs = new Map(
        paragraphsFromResponse(sourceBlocks!).map((paragraph) => [paragraph.id, paragraph])
      );
      for (const [id, value] of Object.entries(paragraphEdits)) {
        const edit = requireObject(value, `PDF paragraph edit ${id}`);
        const pageIndex = requirePageIndex(
          edit.pageIndex,
          document.numPages,
          `PDF paragraph edit ${id}`
        );
        const source = sourceParagraphs.get(id);
        if (!source || source.pageIndex !== pageIndex) {
          throw new Error(`PDF recovery could not match paragraph edit ${id}`);
        }
        const originalText = requireBmpText(
          edit.originalText,
          `PDF paragraph edit ${id}.originalText`
        );
        const recoveredText = requireBmpText(edit.text, `PDF paragraph edit ${id}.text`);
        if (source.originalText !== originalText) {
          throw new Error(`PDF recovery source paragraph changed for edit ${id}`);
        }
        assertKnownKeys(
          requireObject(edit.bbox, `PDF paragraph edit ${id}.bbox`),
          ["x", "y", "width", "height"],
          `PDF paragraph edit ${id}.bbox`
        );
        const bbox = requireRectObject(edit.bbox, `PDF paragraph edit ${id}`);
        const payloadInput: JsonObject = {
          ...edit,
          fontFamily: edit.fontFamily ?? source.fontFamily,
          color: edit.color ?? source.color,
          bold: edit.bold ?? source.bold,
          italic: edit.italic ?? source.italic,
          styleRanges:
            edit.styleRanges ?? normalizedStyleFallback(source.styleRanges, recoveredText.length),
        };
        const payload = textEditFromRect(payloadInput, bbox, `PDF paragraph edit ${id}`);
        payload.originalRect = [
          source.originalBbox.x,
          source.originalBbox.y,
          source.originalBbox.width,
          source.originalBbox.height,
        ];
        ensurePage(pageIndex).textEdits!.push(payload);
      }
    }

    const freeText = readOptionalArray(state, "freeText");
    for (const [index, value] of freeText.entries()) {
      const edit = requireObject(value, `PDF free text ${index}`);
      assertKnownKeys(
        edit,
        [
          "id",
          "pageIndex",
          "text",
          "x",
          "y",
          "width",
          "height",
          "fontSize",
          "fontFamily",
          "color",
          "bold",
          "italic",
          "textAlign",
          "styleRanges",
        ],
        `PDF free text ${index}`
      );
      requireNonEmptyString(edit.id, `PDF free text ${index}.id`);
      if (requireBmpText(edit.text, `PDF free text ${index}.text`) === "") {
        throw new Error(`PDF free text ${index}.text must be non-empty`);
      }
      const pageIndex = requirePageIndex(
        edit.pageIndex,
        document.numPages,
        `PDF free text ${index}`
      );
      ensurePage(pageIndex).freeText!.push(
        textEditFromGeometry(edit, `PDF free text ${index}`, '"Times New Roman", Times, serif')
      );
    }

    const highlights = readOptionalArray(state, "highlights");
    for (const [index, value] of highlights.entries()) {
      const edit = requireObject(value, `PDF highlight ${index}`);
      assertKnownKeys(
        edit,
        ["id", "pageIndex", "x", "y", "width", "height", "color", "opacity"],
        `PDF highlight ${index}`
      );
      requireNonEmptyString(edit.id, `PDF highlight ${index}.id`);
      const pageIndex = requirePageIndex(
        edit.pageIndex,
        document.numPages,
        `PDF highlight ${index}`
      );
      const payload: ExportHighlightPayload = {
        rect: requireGeometryRect(edit, `PDF highlight ${index}`),
        color: optionalHexColor(edit.color, `PDF highlight ${index}.color`),
        opacity: optionalOpacity(edit.opacity, `PDF highlight ${index}.opacity`),
      };
      ensurePage(pageIndex).highlights!.push(payload);
    }

    for (const [id, value] of Object.entries(legacyEdits)) {
      if (id in textEdits) continue;
      const edit = requireObject(value, `PDF legacy edit ${id}`);
      const recoveredText = requireBmpText(edit.text, `PDF legacy edit ${id}.text`);
      const source = sourceText.get(id);
      if (!source) throw new Error(`PDF recovery could not match legacy edit ${id}`);
      const sourceStyle =
        recoveredText === ""
          ? undefined
          : requireMatchingSourceSpanStyle(
              sourceBlocks!,
              source.pageIndex,
              source.text,
              source.rect,
              `PDF legacy edit ${id}`
            );
      ensurePage(source.pageIndex).textEdits!.push({
        rect: [...source.rect],
        originalRect: [...source.rect],
        text: recoveredText,
        fontSize: source.fontSize,
        fontFamily: source.fontFamily,
        color: sourceStyle?.color,
        bold: sourceStyle?.bold,
        italic: sourceStyle?.italic,
        deleted: recoveredText === "" ? true : undefined,
      });
    }

    return { pages: Array.from(pages.values()).sort((a, b) => a.pageIndex - b.pageIndex) };
  } finally {
    await document.destroy();
  }
}

function textEditFromGeometry(
  value: JsonObject,
  label: string,
  fallbackFontFamily?: string
): ExportTextEditPayload {
  return textEditFromRect(value, requireGeometryRect(value, label), label, fallbackFontFamily);
}

function textEditFromRect(
  value: JsonObject,
  rect: [number, number, number, number],
  label: string,
  fallbackFontFamily?: string
): ExportTextEditPayload {
  const fontSize = requirePositiveNumber(value.fontSize, `${label}.fontSize`);
  const align = optionalString(value.textAlign, `${label}.textAlign`);
  if (align !== undefined && align !== "left" && align !== "center" && align !== "right") {
    throw new Error(`${label}.textAlign is invalid`);
  }
  return {
    rect,
    text: requireBmpText(value.text, `${label}.text`),
    fontSize,
    fontFamily:
      optionalString(value.fontFamily, `${label}.fontFamily`) ??
      fallbackFontFamily ??
      fontFamilyFromLegacyName(optionalString(value.fontName, `${label}.fontName`)),
    color: optionalHexColor(value.color, `${label}.color`),
    bold: optionalBoolean(value.bold, `${label}.bold`),
    italic: optionalBoolean(value.italic, `${label}.italic`),
    align,
    deleted: optionalBoolean(value.deleted, `${label}.deleted`),
    styleRanges: readStyleRanges(
      value.styleRanges,
      requireBmpText(value.text, `${label}.text`),
      label
    ),
  };
}

function fontFamilyFromLegacyName(fontName: string | undefined): string | undefined {
  if (fontName === undefined) return undefined;
  return /serif|times|georgia|roman/i.test(fontName)
    ? '"Times New Roman", Times, serif'
    : "Arial, Helvetica, sans-serif";
}

function requireMatchingSourceSpanStyle(
  blocks: PdfBlocksResponse,
  pageIndex: number,
  originalText: string,
  rect: [number, number, number, number],
  label: string
): { color: string; bold: boolean; italic: boolean } {
  const page = blocks.pages.find((candidate) => candidate.pageIndex === pageIndex);
  const matches = (page?.blocks ?? [])
    .flatMap((block) => block.lines)
    .flatMap((line) => line.spans)
    .filter(
      (span) =>
        span.text === originalText &&
        Array.isArray(span.bbox) &&
        span.bbox.length === 4 &&
        span.bbox.every(isFiniteNumber) &&
        rectOverlapsBbox(rect, span.bbox)
    );
  if (matches.length !== 1) {
    throw new Error(`${label} could not uniquely match source styling`);
  }
  const [match] = matches;
  const color = optionalHexColor(match.color, `${label} source color`);
  if (color === undefined || typeof match.bold !== "boolean" || typeof match.italic !== "boolean") {
    throw new Error(`${label} source styling is incomplete`);
  }
  return { color, bold: match.bold, italic: match.italic };
}

function rectOverlapsBbox(
  rect: [number, number, number, number],
  bbox: [number, number, number, number]
): boolean {
  const [x, y, width, height] = rect;
  const [x0, y0, x1, y1] = bbox;
  return x < x1 && x + width > x0 && y < y1 && y + height > y0;
}

function normalizedStyleFallback(
  ranges: PdfTextStyleRange[] | undefined,
  textLength: number
): PdfTextStyleRange[] | undefined {
  const normalized = (ranges ?? [])
    .map((range) => ({
      ...range,
      start: Math.max(0, Math.min(textLength, range.start)),
      end: Math.max(0, Math.min(textLength, range.end)),
    }))
    .filter((range) => range.end > range.start);
  return normalized.length > 0 ? normalized : undefined;
}

function readStyleRanges(
  value: unknown,
  text: string,
  label: string
): PdfTextStyleRange[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${label}.styleRanges must be an array`);
  return value.map((entry, index) => {
    const range = requireObject(entry, `${label}.styleRanges[${index}]`);
    assertKnownKeys(
      range,
      ["start", "end", "color", "highlightColor", "bold", "italic"],
      `${label}.styleRanges[${index}]`
    );
    const start = requireInteger(range.start, `${label}.styleRanges[${index}].start`);
    const end = requireInteger(range.end, `${label}.styleRanges[${index}].end`);
    if (start < 0 || end <= start || end > text.length) {
      throw new Error(`${label}.styleRanges[${index}] has invalid bounds`);
    }
    return {
      start,
      end,
      color: optionalHexColor(range.color, `${label}.styleRanges[${index}].color`),
      highlightColor: optionalHexColor(
        range.highlightColor,
        `${label}.styleRanges[${index}].highlightColor`
      ),
      bold: optionalBoolean(range.bold, `${label}.styleRanges[${index}].bold`),
      italic: optionalBoolean(range.italic, `${label}.styleRanges[${index}].italic`),
    };
  });
}

function requireGeometryRect(value: JsonObject, label: string): [number, number, number, number] {
  return [
    requireFiniteNumber(value.x, `${label}.x`),
    requireFiniteNumber(value.y, `${label}.y`),
    requirePositiveNumber(value.width, `${label}.width`),
    requirePositiveNumber(value.height, `${label}.height`),
  ];
}

function requireRectObject(value: unknown, label: string): [number, number, number, number] {
  const rect = requireObject(value, `${label}.bbox`);
  return requireGeometryRect(rect, `${label}.bbox`);
}

function requirePdfTextItem(
  value: unknown,
  id: string
): { str: string; transform: number[]; width: number; height: number; fontName?: string } {
  const item = requireObject(value, `PDF source text ${id}`);
  if (
    typeof item.str !== "string" ||
    !Array.isArray(item.transform) ||
    item.transform.length < 6 ||
    !item.transform.every(isFiniteNumber)
  ) {
    throw new Error(`PDF source text ${id} has an invalid structure`);
  }
  const fontName = optionalString(item.fontName, `PDF source text ${id}.fontName`);
  return {
    str: item.str,
    transform: item.transform,
    width: requirePositiveNumber(item.width, `PDF source text ${id}.width`),
    height: requirePositiveNumber(item.height, `PDF source text ${id}.height`),
    fontName,
  };
}

function readOptionalRecord(value: JsonObject, key: string): JsonObject {
  const field = value[key];
  if (field === undefined) return {};
  return requireObject(field, `PDF recovery state.${key}`);
}

function readOptionalArray(value: JsonObject, key: string): unknown[] {
  const field = value[key];
  if (field === undefined) return [];
  if (!Array.isArray(field)) throw new Error(`PDF recovery state.${key} must be an array`);
  return field;
}

function requirePageIndex(value: unknown, pageCount: number, label: string): number {
  const pageIndex = requireInteger(value, `${label}.pageIndex`);
  assertPageIndex(pageIndex, pageCount);
  return pageIndex;
}

function assertPageIndex(pageIndex: number, pageCount: number): void {
  if (pageIndex < 0 || pageIndex >= pageCount) {
    throw new Error(`PDF recovery page index ${pageIndex} is out of range`);
  }
}

function requireObject(value: unknown, label: string): JsonObject {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  return value;
}

function assertKnownKeys(value: JsonObject, allowed: readonly string[], label: string): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknown) throw new Error(`${label} has unsupported field ${unknown}`);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function requireNonEmptyString(value: unknown, label: string): string {
  const text = requireString(value, label);
  if (!text) throw new Error(`${label} must be a non-empty string`);
  return text;
}

function requireBmpText(value: unknown, label: string): string {
  const text = requireString(value, label);
  if (/[\uD800-\uDFFF]/.test(text)) {
    throw new Error(`${label} contains text that the strict PDF recovery font cannot preserve`);
  }
  return text;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, label);
}

function optionalHexColor(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  const color = requireString(value, label);
  if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) {
    throw new Error(`${label} must be a 3- or 6-digit hex color`);
  }
  return color;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (!isFiniteNumber(value)) throw new Error(`${label} must be a finite number`);
  return value;
}

function optionalFiniteNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  return requireFiniteNumber(value, label);
}

function optionalPositiveNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  return requirePositiveNumber(value, label);
}

function optionalOpacity(value: unknown, label: string): number | undefined {
  const opacity = optionalFiniteNumber(value, label);
  if (opacity !== undefined && (opacity < 0 || opacity > 1)) {
    throw new Error(`${label} must be between zero and one`);
  }
  return opacity;
}

function requirePositiveNumber(value: unknown, label: string): number {
  const number = requireFiniteNumber(value, label);
  if (number <= 0) throw new Error(`${label} must be greater than zero`);
  return number;
}

function requireInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value)) throw new Error(`${label} must be an integer`);
  return value as number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
