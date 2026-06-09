import { describe, expect, it } from "vitest";
import { PageMention } from "@/extensions/page-mention";

type ExtensionConfig = {
  name: string;
  group?: string;
  inline?: boolean;
  atom?: boolean;
  renderMarkdown?: (node: { attrs?: Record<string, unknown> }, helpers: unknown) => string;
};

const configOf = (extension: unknown): ExtensionConfig =>
  (extension as { config: ExtensionConfig }).config;

describe("PageMention inline node", () => {
  it("is an inline atom node named pageMention", () => {
    const cfg = configOf(PageMention);
    expect(cfg.name).toBe("pageMention");
    expect(cfg.group).toBe("inline");
    expect(cfg.inline).toBe(true);
    expect(cfg.atom).toBe(true);
  });

  it("renderMarkdown emits the page title for a linked page", () => {
    const rendered = configOf(PageMention).renderMarkdown?.(
      { attrs: { pageId: "abc-123", pageTitle: "Specs" } },
      {}
    );
    expect(rendered).toBe("Specs");
  });

  it("renderMarkdown falls back to 'Untitled' when a linked page has no title", () => {
    const rendered = configOf(PageMention).renderMarkdown?.(
      { attrs: { pageId: "abc-123", pageTitle: "" } },
      {}
    );
    expect(rendered).toBe("Untitled");
  });

  it("renderMarkdown skips empty placeholders (no pageId)", () => {
    // pageId is a machine-local id and is intentionally never written to the
    // portable .md — an unlinked placeholder has no markdown form. The node is
    // restored from the sidecar HTML on reopen.
    const rendered = configOf(PageMention).renderMarkdown?.({ attrs: { pageId: "" } }, {});
    expect(rendered).toBe("");
  });
});
