/**
 * Syntax highlighting for fenced code Blocks.
 *
 * Lazy by construction: `highlight.js/lib/core` carries no grammars, and each language is its own
 * dynamic import, so a Page with no code Block never loads any of it and a Page with TypeScript
 * loads only TypeScript. This mirrors how `katex` and `mermaid` are already loaded.
 *
 * The result is a token list, not HTML. `highlight.js` escapes its input, but a Page is untrusted
 * input (ADR-0011) and this module is on the path from a `.md` file to the DOM, so its output is
 * parsed and reduced to `{ text, className }` pairs. Nothing derived from a document reaches the DOM
 * as markup.
 */

export interface CodeToken {
  readonly text: string;
  /** `highlight.js` scope class, or null for unclassified text. */
  readonly className: string | null;
}

/**
 * Languages we can highlight, mapped from the aliases people actually write in a fence.
 *
 * A closed list on purpose: an unknown language falls back to plain text rather than pulling an
 * arbitrary module name out of the document and importing it.
 */
const LANGUAGE_MODULES: Record<string, () => Promise<{ default: unknown }>> = {
  bash: () => import("highlight.js/lib/languages/bash"),
  c: () => import("highlight.js/lib/languages/c"),
  cpp: () => import("highlight.js/lib/languages/cpp"),
  csharp: () => import("highlight.js/lib/languages/csharp"),
  css: () => import("highlight.js/lib/languages/css"),
  diff: () => import("highlight.js/lib/languages/diff"),
  dockerfile: () => import("highlight.js/lib/languages/dockerfile"),
  go: () => import("highlight.js/lib/languages/go"),
  graphql: () => import("highlight.js/lib/languages/graphql"),
  ini: () => import("highlight.js/lib/languages/ini"),
  java: () => import("highlight.js/lib/languages/java"),
  javascript: () => import("highlight.js/lib/languages/javascript"),
  json: () => import("highlight.js/lib/languages/json"),
  kotlin: () => import("highlight.js/lib/languages/kotlin"),
  latex: () => import("highlight.js/lib/languages/latex"),
  lua: () => import("highlight.js/lib/languages/lua"),
  markdown: () => import("highlight.js/lib/languages/markdown"),
  php: () => import("highlight.js/lib/languages/php"),
  plaintext: () => import("highlight.js/lib/languages/plaintext"),
  powershell: () => import("highlight.js/lib/languages/powershell"),
  python: () => import("highlight.js/lib/languages/python"),
  r: () => import("highlight.js/lib/languages/r"),
  ruby: () => import("highlight.js/lib/languages/ruby"),
  rust: () => import("highlight.js/lib/languages/rust"),
  scala: () => import("highlight.js/lib/languages/scala"),
  scss: () => import("highlight.js/lib/languages/scss"),
  shell: () => import("highlight.js/lib/languages/shell"),
  sql: () => import("highlight.js/lib/languages/sql"),
  swift: () => import("highlight.js/lib/languages/swift"),
  typescript: () => import("highlight.js/lib/languages/typescript"),
  xml: () => import("highlight.js/lib/languages/xml"),
  yaml: () => import("highlight.js/lib/languages/yaml"),
};

const ALIASES: Record<string, keyof typeof LANGUAGE_MODULES> = {
  "c++": "cpp",
  "c#": "csharp",
  cs: "csharp",
  golang: "go",
  htm: "xml",
  html: "xml",
  js: "javascript",
  jsx: "javascript",
  kt: "kotlin",
  md: "markdown",
  mjs: "javascript",
  objc: "cpp",
  ps1: "powershell",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "shell",
  tex: "latex",
  toml: "ini",
  ts: "typescript",
  tsx: "typescript",
  vue: "xml",
  yml: "yaml",
  zsh: "bash",
};

/** Canonical language id for a fence's info string, or null when we cannot highlight it. */
export function resolveCodeLanguage(infoString: string): string | null {
  // A fence's info string may carry more than a language, e.g. "ts title=example".
  const token =
    infoString
      .trim()
      .split(/[\s,{]/)[0]
      ?.toLowerCase() ?? "";
  if (!token) return null;
  const resolved = ALIASES[token] ?? token;
  return resolved in LANGUAGE_MODULES ? resolved : null;
}

type HighlightCore = {
  registerLanguage: (name: string, definition: unknown) => void;
  getLanguage: (name: string) => unknown;
  highlight: (
    code: string,
    options: { language: string; ignoreIllegals: boolean }
  ) => {
    value: string;
  };
};

let corePromise: Promise<HighlightCore> | null = null;
const registered = new Set<string>();

function loadCore(): Promise<HighlightCore> {
  corePromise ??= import("highlight.js/lib/core").then(
    (module) => (module.default ?? module) as unknown as HighlightCore
  );
  return corePromise;
}

/**
 * Tokenise `code` as `language`.
 *
 * Returns null when the language is unknown or highlighting fails, and the caller renders plain
 * text — a Page must never fail to display because a grammar did.
 */
export async function highlightCodeTokens(
  code: string,
  language: string
): Promise<readonly CodeToken[] | null> {
  const resolved = resolveCodeLanguage(language);
  if (!resolved) return null;
  try {
    const core = await loadCore();
    if (!registered.has(resolved)) {
      const grammar = await LANGUAGE_MODULES[resolved]();
      core.registerLanguage(resolved, grammar.default);
      registered.add(resolved);
    }
    const { value } = core.highlight(code, { language: resolved, ignoreIllegals: true });
    return tokensFromHighlightedHtml(value);
  } catch {
    return null;
  }
}

/**
 * Reduce highlight.js markup to flat `{ text, className }` tokens.
 *
 * Only text nodes and their nearest `class` survive. Parsing rather than trusting means a grammar
 * that somehow emitted an element or attribute we did not expect cannot put it in the DOM.
 */
function tokensFromHighlightedHtml(html: string): readonly CodeToken[] {
  if (typeof DOMParser === "undefined") return [{ text: stripTags(html), className: null }];
  const body = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html").body
    .firstElementChild;
  if (!body) return [{ text: stripTags(html), className: null }];
  const tokens: CodeToken[] = [];
  const walk = (node: Node, className: string | null) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? "";
        if (text) tokens.push({ text, className });
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const element = child as Element;
      const own = element.getAttribute("class");
      walk(element, own ? own : className);
    }
  };
  walk(body, null);
  return tokens;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}
