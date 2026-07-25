import { describe, expect, it } from "vitest";

import { highlightCodeTokens, resolveCodeLanguage } from "@/editor/markdown-block/code-highlight";

describe("resolveCodeLanguage", () => {
  it.each([
    ["ts", "typescript"],
    ["TSX", "typescript"],
    ["js", "javascript"],
    ["py", "python"],
    ["c++", "cpp"],
    ["html", "xml"],
    ["yml", "yaml"],
    ["sh", "shell"],
    ["typescript", "typescript"],
  ])("maps %s to %s", (input, expected) => {
    expect(resolveCodeLanguage(input)).toBe(expected);
  });

  it("reads only the first token of an info string", () => {
    expect(resolveCodeLanguage("ts title=example.ts")).toBe("typescript");
    expect(resolveCodeLanguage("json{1,3}")).toBe("json");
  });

  it("returns null for anything it cannot highlight, rather than guessing", () => {
    expect(resolveCodeLanguage("")).toBeNull();
    expect(resolveCodeLanguage("   ")).toBeNull();
    expect(resolveCodeLanguage("brainfuck")).toBeNull();
    // Never derive a module path from the document.
    expect(resolveCodeLanguage("../../etc/passwd")).toBeNull();
  });
});

describe("highlightCodeTokens", () => {
  it("tokenises code and preserves it exactly when concatenated", async () => {
    const code = 'const answer = 42; // "why"';
    const tokens = await highlightCodeTokens(code, "ts");
    expect(tokens).not.toBeNull();
    // The rendered text must equal the source, or the Block would display something the file
    // does not say.
    expect(tokens!.map((token) => token.text).join("")).toBe(code);
    expect(tokens!.some((token) => token.className?.includes("hljs-keyword"))).toBe(true);
    expect(tokens!.some((token) => token.className?.includes("hljs-comment"))).toBe(true);
  });

  it("keeps markup in the code as text, never as markup", async () => {
    const code = "<script>alert(1)</script>";
    const tokens = await highlightCodeTokens(code, "html");
    expect(tokens!.map((token) => token.text).join("")).toBe(code);
    // Tokens carry text and a class, and nothing else — there is no path to the DOM as markup.
    for (const token of tokens!) {
      expect(Object.keys(token).sort()).toEqual(["className", "text"]);
    }
  });

  it("returns null for an unknown language so the caller falls back to plain text", async () => {
    expect(await highlightCodeTokens("x = 1", "brainfuck")).toBeNull();
    expect(await highlightCodeTokens("x = 1", "")).toBeNull();
  });

  it("survives a payload that violates the grammar", async () => {
    const code = "const = = = ;;; }}}";
    const tokens = await highlightCodeTokens(code, "ts");
    expect(tokens!.map((token) => token.text).join("")).toBe(code);
  });
});
