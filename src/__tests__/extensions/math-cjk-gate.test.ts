import { describe, expect, it } from "vitest";
import { containsCjk } from "@/extensions/math/cjk";
import { unwrapCjkMath } from "@/lib/markdown";

describe("containsCjk", () => {
  it("detects CJK Unified Ideographs", () => {
    expect(containsCjk("市值")).toBe(true);
    expect(containsCjk("計画")).toBe(true);
    expect(containsCjk("混mix")).toBe(true);
  });

  it("detects Hiragana / Katakana / Hangul / halfwidth Katakana", () => {
    expect(containsCjk("ひらがな")).toBe(true);
    expect(containsCjk("カタカナ")).toBe(true);
    expect(containsCjk("한국어")).toBe(true);
    expect(containsCjk("ｶﾅ")).toBe(true);
  });

  it("returns false for ASCII LaTeX", () => {
    expect(containsCjk("x=1")).toBe(false);
    expect(containsCjk("\\alpha")).toBe(false);
    expect(containsCjk("\\sum_{i=0}^n a_i")).toBe(false);
    expect(containsCjk("$5 to $10")).toBe(false);
    expect(containsCjk("")).toBe(false);
  });
});

describe("unwrapCjkMath", () => {
  it("unwraps inline-math whose latex contains CJK back to literal $...$", () => {
    const html = '<p>前<span data-type="inline-math" data-latex="市值"></span>后</p>';
    expect(unwrapCjkMath(html)).toBe("<p>前$市值$后</p>");
  });

  it("unwraps block-math whose latex contains CJK back to literal $$...$$", () => {
    const html = '<div data-type="block-math" data-latex="計画"></div>';
    expect(unwrapCjkMath(html)).toBe("$$計画$$");
  });

  it("leaves real math (ASCII latex) alone", () => {
    const html = '<p><span data-type="inline-math" data-latex="\\alpha"></span></p>';
    expect(unwrapCjkMath(html)).toBe(html);
  });

  it("leaves HTML without math nodes alone (fast path)", () => {
    const html = "<p>just text 市值 in chinese</p>";
    expect(unwrapCjkMath(html)).toBe(html);
  });

  it("handles a mix: unwraps CJK ones, keeps ASCII ones", () => {
    const html =
      '<p><span data-type="inline-math" data-latex="市值"></span> and ' +
      '<span data-type="inline-math" data-latex="x=1"></span></p>';
    const out = unwrapCjkMath(html);
    expect(out).toContain("$市值$");
    expect(out).toContain('data-latex="x=1"');
    expect(out).not.toContain('data-latex="市值"');
  });
});
