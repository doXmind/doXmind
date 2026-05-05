import { Node } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import {
  CustomBlockExtensions,
  customBlockTipTapExtensions,
  type CustomBlockExtension,
  type SelfContainedCustomBlockExtension,
} from "@/extensions/registry";

const SELF_CONTAINED_BLOCK_TYPES = [
  "mermaid",
  "callout",
  "math",
  "toggle",
  "page-link",
] as const;

type ExtensionConfig = {
  name: string;
  renderMarkdown?: (node: { attrs?: Record<string, unknown>; content?: unknown }, helpers: unknown) => string;
};

const configOf = (extension: unknown): ExtensionConfig =>
  (extension as { config: ExtensionConfig }).config;

describe("Self-contained blocks in CustomBlockExtensions", () => {
  it.each(SELF_CONTAINED_BLOCK_TYPES)(
    "registers %s as category 'self-contained'",
    (blockType) => {
      const entry = CustomBlockExtensions[blockType];
      expect(entry.category).toBe("self-contained");
      expect(entry.blockType).toBe(blockType);
      expect(entry.extensions.length).toBeGreaterThan(0);
    }
  );

  it("exposes the canonical TipTap node names per block", () => {
    const namesByBlock: Record<(typeof SELF_CONTAINED_BLOCK_TYPES)[number], string[]> = {
      mermaid: ["mermaidChart"],
      callout: ["callout"],
      math: ["inlineMath", "blockMath"],
      toggle: ["toggle", "toggleSummary", "toggleBody"],
      "page-link": ["pageLink"],
    };

    for (const blockType of SELF_CONTAINED_BLOCK_TYPES) {
      const entry = CustomBlockExtensions[blockType];
      const names = entry.extensions.map((ext) => configOf(ext).name);
      expect(names).toEqual(namesByBlock[blockType]);
    }
  });

  it("flattens self-contained + external-reference extensions into customBlockTipTapExtensions", () => {
    const flattened = customBlockTipTapExtensions.map((ext) => configOf(ext).name);
    expect(flattened).toEqual([
      "pdfBlock",
      "excelBlock",
      "mermaidChart",
      "callout",
      "inlineMath",
      "blockMath",
      "toggle",
      "toggleSummary",
      "toggleBody",
      "pageLink",
    ]);
  });

  it("type-rejects external-reference helpers on a self-contained entry", () => {
    const entry: CustomBlockExtension = CustomBlockExtensions.mermaid;
    if (entry.category !== "self-contained") throw new Error("expected self-contained");
    // @ts-expect-error — Self-contained entries do not declare placeholderTemplate.
    void entry.placeholderTemplate;
    // @ts-expect-error — Self-contained entries do not declare extractIdFromNode.
    void entry.extractIdFromNode;
    // @ts-expect-error — Self-contained entries do not declare extractSrcFromNode.
    void entry.extractSrcFromNode;
  });
});

describe("Self-contained block round-trips", () => {
  it("mermaid renderMarkdown emits a fenced ```mermaid code block", () => {
    const [mermaid] = CustomBlockExtensions.mermaid.extensions;
    const rendered = configOf(mermaid).renderMarkdown?.(
      { attrs: { code: "graph TD\nA --> B" } },
      {}
    );
    expect(rendered).toBe("```mermaid\ngraph TD\nA --> B\n```");
  });

  it("inline math renderMarkdown wraps latex in $...$", () => {
    const [inline] = CustomBlockExtensions.math.extensions;
    const rendered = configOf(inline).renderMarkdown?.({ attrs: { latex: "x^2" } }, {});
    expect(rendered).toBe("$x^2$");
  });

  it("block math renderMarkdown wraps latex in $$\\n...\\n$$", () => {
    const [, block] = CustomBlockExtensions.math.extensions;
    const rendered = configOf(block).renderMarkdown?.({ attrs: { latex: "E = mc^2" } }, {});
    expect(rendered).toBe("$$\nE = mc^2\n$$");
  });

  it("callout renderMarkdown emits GFM '> [!TYPE]' alert syntax", () => {
    const [callout] = CustomBlockExtensions.callout.extensions;
    const helpers = { renderChildren: () => "Heads up!" };
    const rendered = configOf(callout).renderMarkdown?.(
      { attrs: { type: "warning" }, content: [{}] },
      helpers
    );
    expect(rendered).toBe("> [!WARNING]\n> Heads up!");
  });

  it("toggle renderMarkdown emits a <details><summary> block", () => {
    const [toggleNode] = CustomBlockExtensions.toggle.extensions;
    const helpers = { renderChildren: (node: { id: string }) => (node.id === "summary" ? "Title" : "Body") };
    const rendered = configOf(toggleNode).renderMarkdown?.(
      { content: [{ id: "summary" }, { id: "body" }] },
      helpers
    );
    expect(rendered).toBe("<details>\n<summary>Title</summary>\n\nBody\n\n</details>");
  });

  it("page-link renderMarkdown emits the page title for a linked page", () => {
    const [pageLink] = CustomBlockExtensions["page-link"].extensions;
    const rendered = configOf(pageLink).renderMarkdown?.(
      { attrs: { pageId: "abc-123", pageTitle: "Specs" } },
      {}
    );
    expect(rendered).toBe("Specs");
  });

  it("page-link renderMarkdown skips empty placeholders", () => {
    const [pageLink] = CustomBlockExtensions["page-link"].extensions;
    const rendered = configOf(pageLink).renderMarkdown?.({ attrs: { pageId: "" } }, {});
    expect(rendered).toBe("");
  });
});

describe("Adding a new Self-contained block needs zero backend changes", () => {
  // A test-only block defined inline. Its mere presence — registered as
  // SelfContainedCustomBlockExtension — proves that adding a new self-contained
  // Custom Block requires no backend registry, no sidecar slot, and no Block
  // placeholder grammar update. Slice #34's contract.
  const TestSelfContainedNode = Node.create({
    name: "testSelfContainedBlock",
    group: "block",
    atom: true,
    addAttributes() {
      return {
        value: {
          default: "",
          parseHTML: (element) => element.getAttribute("data-value") || "",
          renderHTML: (attributes) => ({ "data-value": attributes.value }),
        },
      };
    },
    parseHTML() {
      return [{ tag: 'div[data-type="test-self-contained-block"]' }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", { ...HTMLAttributes, "data-type": "test-self-contained-block" }];
    },
    renderMarkdown(node) {
      const value = (node.attrs?.value as string) || "";
      return value ? `:::test ${value} :::` : "";
    },
  });

  const TestSelfContainedBlock: SelfContainedCustomBlockExtension = {
    blockType: "test-self-contained-block",
    category: "self-contained",
    extensions: [TestSelfContainedNode],
  };

  it("satisfies the SelfContainedCustomBlockExtension contract", () => {
    expect(TestSelfContainedBlock.category).toBe("self-contained");
    expect(TestSelfContainedBlock.extensions).toHaveLength(1);
    expect(configOf(TestSelfContainedBlock.extensions[0]).name).toBe("testSelfContainedBlock");
  });

  it("round-trips its renderMarkdown output", () => {
    const [extension] = TestSelfContainedBlock.extensions;
    const rendered = configOf(extension).renderMarkdown?.({ attrs: { value: "hello" } }, {});
    expect(rendered).toBe(":::test hello :::");
  });

  it("composes with the registry-derived TipTap extension list", () => {
    const composed = [...customBlockTipTapExtensions, ...TestSelfContainedBlock.extensions];
    expect(composed.map((ext) => configOf(ext).name)).toContain("testSelfContainedBlock");
    expect(composed.length).toBe(customBlockTipTapExtensions.length + 1);
  });
});
