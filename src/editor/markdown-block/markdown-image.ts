import { Lexer, type Token } from "marked";

export interface MarkdownImageReference {
  /** Exact source block, including its authored line endings and trailing separator. */
  source: string;
  alt: string;
  destination: string;
  title: string | null;
}

export const MARKDOWN_IMAGE_EXTENSIONS = [
  ".apng",
  ".avif",
  ".bmp",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".webp",
] as const;

export type MarkdownImageDiagnosticCode =
  | "not-standalone-image"
  | "empty-destination"
  | "external-destination"
  | "absolute-destination"
  | "query-or-fragment"
  | "invalid-uri-encoding"
  | "unsupported-extension"
  | "nul-byte"
  | "invalid-destination"
  | "invalid-page-path"
  | "outside-workspace";

export interface MarkdownImageDiagnostic {
  code: MarkdownImageDiagnosticCode;
  message: string;
}

export type MarkdownImageParseResult =
  { ok: true; image: MarkdownImageReference } | { ok: false; diagnostic: MarkdownImageDiagnostic };

export interface ResolvedMarkdownImagePath {
  /** Canonical workspace-relative path of the Page containing the image. */
  pagePath: string;
  /** CommonMark-decoded destination exactly as returned by the parser. */
  destination: string;
  /** URI-decoded, canonical workspace-relative filesystem path. */
  workspacePath: string;
}

export type MarkdownImageResolveResult =
  | { ok: true; imagePath: ResolvedMarkdownImagePath }
  | { ok: false; diagnostic: MarkdownImageDiagnostic };

/** Build the shortest portable destination from a Page to an imported asset. */
export function markdownImageDestinationForPage(pagePath: string, assetPath: string): string {
  const page = normalizeWorkspacePath(pagePath);
  const asset = normalizeWorkspacePath(assetPath);
  if (!page.ok || !/\.(?:md|markdown)$/i.test(page.segments.at(-1) ?? "")) {
    throw new Error("Page path is not a workspace-relative Markdown path");
  }
  if (
    !asset.ok ||
    !MARKDOWN_IMAGE_EXTENSIONS.some((extension) => assetPath.toLowerCase().endsWith(extension))
  ) {
    throw new Error("Asset path is not a supported workspace-relative image path");
  }
  const pageDirectory = page.segments.slice(0, -1);
  let common = 0;
  while (
    common < pageDirectory.length &&
    common < asset.segments.length &&
    pageDirectory[common] === asset.segments[common]
  ) {
    common += 1;
  }
  const relative = [
    ...Array.from({ length: pageDirectory.length - common }, () => ".."),
    ...asset.segments.slice(common),
  ];
  const destination = relative
    .map((segment) => (segment === ".." ? segment : encodeURIComponent(segment)))
    .join("/");
  const resolved = resolveMarkdownImagePath(page.segments.join("/"), destination);
  if (!resolved.ok || resolved.imagePath.workspacePath !== asset.segments.join("/")) {
    throw new Error("Imported image cannot be represented by a safe Markdown destination");
  }
  return destination;
}

/** Parse only when the complete source block is one inline CommonMark image. */
export function parseMarkdownImageBlock(source: string): MarkdownImageParseResult {
  if (source.includes("\0")) return diagnostic("nul-byte");
  const expression = standaloneExpression(source);
  const tokens = expression === null ? [] : Lexer.lexInline(expression, { gfm: true });
  const image = tokens.length === 1 && tokens[0]?.type === "image" ? tokens[0] : null;
  if (!image || image.raw !== expression) return diagnostic("not-standalone-image");
  const destinationDiagnostic = validateDestination(image.href);
  if (destinationDiagnostic) return { ok: false, diagnostic: destinationDiagnostic };

  return {
    ok: true,
    image: {
      source,
      alt: inlineText(image.tokens),
      destination: image.href,
      title: image.title,
    },
  };
}

/** Resolve an already-parsed image destination without allowing workspace escape. */
export function resolveMarkdownImagePath(
  pagePath: string,
  destination: string
): MarkdownImageResolveResult {
  const destinationDiagnostic = validateDestination(destination);
  if (destinationDiagnostic) return { ok: false, diagnostic: destinationDiagnostic };

  const normalizedPage = normalizeWorkspacePath(pagePath);
  if (!normalizedPage.ok || !/\.(?:md|markdown)$/i.test(normalizedPage.segments.at(-1) ?? "")) {
    return { ok: false, diagnostic: makeDiagnostic("invalid-page-path") };
  }

  const decodedDestination = decodeURIComponent(destination);
  const resolved = normalizeWorkspacePath(decodedDestination, normalizedPage.segments.slice(0, -1));
  if (!resolved.ok) {
    return {
      ok: false,
      diagnostic: makeDiagnostic(
        resolved.reason === "outside-workspace" ? "outside-workspace" : "invalid-destination"
      ),
    };
  }

  return {
    ok: true,
    imagePath: {
      pagePath: normalizedPage.segments.join("/"),
      destination,
      workspacePath: resolved.segments.join("/"),
    },
  };
}

function standaloneExpression(source: string): string | null {
  const withoutSeparator = source.replace(/(?:[ \t]*(?:\r\n|\n|\r))+[ \t]*$/, "");
  if (/\r|\n/.test(withoutSeparator)) return null;
  return withoutSeparator.replace(/^ {0,3}/, "").replace(/[ \t]+$/, "");
}

function inlineText(tokens: readonly Token[] | undefined): string {
  if (!tokens) return "";
  return tokens
    .map((token) => {
      if (token.type === "escape") return token.text;
      if ("tokens" in token && Array.isArray(token.tokens)) return inlineText(token.tokens);
      return "text" in token && typeof token.text === "string" ? token.text : "";
    })
    .join("");
}

function diagnostic(code: MarkdownImageDiagnosticCode): MarkdownImageParseResult {
  return {
    ok: false,
    diagnostic: {
      code,
      message: DIAGNOSTIC_MESSAGES[code],
    },
  };
}

function validateDestination(destination: string): MarkdownImageDiagnostic | null {
  if (!destination) return makeDiagnostic("empty-destination");
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(destination)) {
    return makeDiagnostic("external-destination");
  }
  if (destination.startsWith("/") || destination.startsWith("\\")) {
    return makeDiagnostic("absolute-destination");
  }
  if (/[?#]/.test(destination)) return makeDiagnostic("query-or-fragment");

  let decoded: string;
  try {
    decoded = decodeURIComponent(destination);
  } catch {
    return makeDiagnostic("invalid-uri-encoding");
  }
  if (decoded.includes("\0")) return makeDiagnostic("nul-byte");
  if (/[?#]/.test(decoded)) return makeDiagnostic("query-or-fragment");
  if (
    decoded.startsWith("/") ||
    decoded.includes("\\") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(decoded)
  ) {
    return makeDiagnostic("absolute-destination");
  }
  if (!MARKDOWN_IMAGE_EXTENSIONS.some((extension) => decoded.toLowerCase().endsWith(extension))) {
    return makeDiagnostic("unsupported-extension");
  }
  return null;
}

function makeDiagnostic(code: MarkdownImageDiagnosticCode): MarkdownImageDiagnostic {
  return { code, message: DIAGNOSTIC_MESSAGES[code] };
}

const DIAGNOSTIC_MESSAGES: Record<MarkdownImageDiagnosticCode, string> = {
  "not-standalone-image": "The source block is not one standalone CommonMark image.",
  "empty-destination": "The image destination is empty.",
  "external-destination": "Only local workspace image destinations are supported.",
  "absolute-destination": "The image destination must be relative to the current Page.",
  "query-or-fragment": "Image destinations cannot contain a query or fragment.",
  "invalid-uri-encoding": "The image destination contains invalid URI encoding.",
  "unsupported-extension": "The destination does not use a supported image extension.",
  "nul-byte": "Image source cannot contain a NUL byte.",
  "invalid-destination": "The image destination is not a valid workspace-relative path.",
  "invalid-page-path": "The current Page path is not a valid workspace-relative Markdown path.",
  "outside-workspace": "The image destination resolves outside the workspace root.",
};

type NormalizedWorkspacePath =
  { ok: true; segments: string[] } | { ok: false; reason: "invalid-path" | "outside-workspace" };

function normalizeWorkspacePath(
  source: string,
  baseSegments: readonly string[] = []
): NormalizedWorkspacePath {
  if (
    !source ||
    source.includes("\0") ||
    source.includes("\\") ||
    source.startsWith("/") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(source)
  ) {
    return { ok: false, reason: "invalid-path" };
  }

  const segments = [...baseSegments];
  for (const segment of source.split("/")) {
    if (!segment || segment === ".") {
      if (!segment) return { ok: false, reason: "invalid-path" };
      continue;
    }
    if (segment === "..") {
      if (segments.length === 0) return { ok: false, reason: "outside-workspace" };
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length > 0 ? { ok: true, segments } : { ok: false, reason: "invalid-path" };
}
