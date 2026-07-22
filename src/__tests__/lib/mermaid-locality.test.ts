import { beforeEach, describe, expect, it, vi } from "vitest";

const mermaidBoundary = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock("mermaid", () => ({
  default: mermaidBoundary,
}));

describe("Mermaid rendering locality", () => {
  beforeEach(() => {
    vi.resetModules();
    mermaidBoundary.initialize.mockReset();
    mermaidBoundary.render.mockReset();
    mermaidBoundary.render.mockResolvedValue({ svg: "<svg>local</svg>" });
  });

  it("rejects remote URLs before Mermaid can render them", async () => {
    const { renderMermaidSvg } = await import("@/lib/mermaid-renderer");
    const source = 'flowchart LR\nA@{ img: "https://example.com/private.png" }';

    await expect(renderMermaidSvg(source)).rejects.toThrow(/remote URL/i);
    expect(mermaidBoundary.render).not.toHaveBeenCalled();
  });

  it("rejects protocol-relative links before Mermaid can render them", async () => {
    const { renderMermaidSvg } = await import("@/lib/mermaid-renderer");
    const source = 'flowchart LR\nA-->B\nclick A href "//example.com/private"';

    await expect(renderMermaidSvg(source)).rejects.toThrow(/remote URL/i);
    expect(mermaidBoundary.render).not.toHaveBeenCalled();
  });

  it("keeps PDF-light rendering from loading remote diagram resources", async () => {
    const { renderMermaidSvgLight } = await import("@/lib/mermaid-renderer");
    const source = 'flowchart LR\nA@{ img: "HTTP://example.com/private.png" }';

    await expect(renderMermaidSvgLight(source)).rejects.toThrow(/remote URL/i);
    expect(mermaidBoundary.render).not.toHaveBeenCalled();
  });

  it("renders ordinary local diagrams with Mermaid's strict security mode", async () => {
    const { renderMermaidSvg } = await import("@/lib/mermaid-renderer");
    const source = "flowchart LR\nLocal-->Only";

    await expect(renderMermaidSvg(source)).resolves.toBe("<svg>local</svg>");
    expect(mermaidBoundary.render).toHaveBeenCalledWith(expect.any(String), source);
    expect(mermaidBoundary.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: "strict" })
    );
  });

  it("rejects escaped URL delimiters that Mermaid would decode", async () => {
    const { renderMermaidSvg } = await import("@/lib/mermaid-renderer");
    const source = String.raw`flowchart LR
A@{ img: "h\u0074tps:\u002f\u002fexample.com/private.png" }`;

    await expect(renderMermaidSvg(source)).rejects.toThrow(/remote URL/i);
    expect(mermaidBoundary.render).not.toHaveBeenCalled();
  });
});
