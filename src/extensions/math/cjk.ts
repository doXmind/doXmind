/**
 * `$...$` / `$$...$$` auto-detection is gated on content: any CJK character
 * inside the delimiters disables the conversion. CJK paragraphs use `$X$`
 * habitually as emphasis/quoting (`$市值$`, `$計画$`, `$수익$`), not LaTeX —
 * converting them produces broken KaTeX output and a flood of strict-mode
 * warnings, with secondary perf cost on big docs.
 *
 * See docs/adr/0006-feature-scope-typora-notion.md.
 *
 * Ranges covered:
 *   U+3040–30FF  Hiragana + Katakana
 *   U+3400–9FFF  CJK Unified Ideographs (incl. Ext A)
 *   U+AC00–D7AF  Hangul Syllables
 *   U+FF66–FF9F  Halfwidth Katakana
 */
const CJK_RE = /[぀-ヿ㐀-鿿가-힯ｦ-ﾟ]/;

export function containsCjk(text: string): boolean {
  return CJK_RE.test(text);
}
