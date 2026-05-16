import { describe, expect, it } from "vitest";
import { CustomCodeBlock } from "@/extensions/code-block";

type ExtensionConfig = {
  parseMarkdown?: (
    token: Record<string, unknown>,
    helpers: {
      createNode: (
        name: string,
        attrs: Record<string, unknown>,
        content: unknown[]
      ) => { name: string; attrs: Record<string, unknown>; content: unknown[] };
      createTextNode: (text: string) => { text: string };
    }
  ) => unknown;
};

const helpers = {
  createNode: (name: string, attrs: Record<string, unknown>, content: unknown[]) => ({
    name,
    attrs,
    content,
  }),
  createTextNode: (text: string) => ({ text }),
};

const parse = (token: Record<string, unknown>) => {
  const config = (CustomCodeBlock as unknown as { config: ExtensionConfig }).config;
  return config.parseMarkdown!(token, helpers);
};

describe("CustomCodeBlock.parseMarkdown", () => {
  it("preserves clean code block text unchanged", () => {
    const result = parse({
      raw: "```\nline1\nline2\nline3\n```",
      lang: "",
      text: "line1\nline2\nline3",
    }) as { content: { text: string }[] };
    expect(result.content[0].text).toBe("line1\nline2\nline3");
  });

  it("strips trailing newlines so the gutter does not pad blank rows", () => {
    const result = parse({
      raw: "```\nline1\nline2\nline3\n\n\n\n```",
      lang: "",
      text: "line1\nline2\nline3\n\n\n",
    }) as { content: { text: string }[] };
    expect(result.content[0].text).toBe("line1\nline2\nline3");
  });

  it("emits an empty content array for a code block whose text is only newlines", () => {
    const result = parse({
      raw: "```\n\n\n```",
      lang: "",
      text: "\n\n",
    }) as { content: unknown[] };
    expect(result.content).toEqual([]);
  });

  it("returns [] for mermaid blocks so MermaidChart owns the node", () => {
    const result = parse({
      raw: "```mermaid\ngraph TD\n```",
      lang: "mermaid",
      text: "graph TD",
    });
    expect(result).toEqual([]);
  });
});
