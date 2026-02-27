/**
 * Tests for replacement-utils
 *
 * Verifies HTML normalization for TipTap compatibility:
 * - normalizeTableHtml: unwraps thead/tbody/colgroup
 * - normalizeMermaidHtml: decodes HTML entities in data-code attributes
 */
import { describe, it, expect } from "vitest";
import {
  normalizeTableHtml,
  normalizeMermaidHtml,
} from "@/extensions/diff-review/replacement-utils";

// ---------------------------------------------------------------------------
// Helper to create a detached HTML element
// ---------------------------------------------------------------------------
function htmlElement(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

describe("normalizeTableHtml", () => {
  it("removes colgroup elements", () => {
    const el = htmlElement(`
      <table>
        <colgroup><col><col></colgroup>
        <tr><td>A</td><td>B</td></tr>
      </table>
    `);

    normalizeTableHtml(el);

    expect(el.querySelectorAll("colgroup")).toHaveLength(0);
    expect(el.querySelectorAll("col")).toHaveLength(0);
  });

  it("unwraps thead rows into table", () => {
    const el = htmlElement(`
      <table>
        <thead><tr><th>Header</th></tr></thead>
        <tbody><tr><td>Cell</td></tr></tbody>
      </table>
    `);

    normalizeTableHtml(el);

    expect(el.querySelectorAll("thead")).toHaveLength(0);
    expect(el.querySelectorAll("tbody")).toHaveLength(0);
    // Rows should be direct children of table
    const rows = el.querySelectorAll("table > tr");
    expect(rows).toHaveLength(2);
    // First row has th, second has td
    expect(rows[0].querySelector("th")!.textContent).toBe("Header");
    expect(rows[1].querySelector("td")!.textContent).toBe("Cell");
  });

  it("preserves header rows before body rows", () => {
    const el = htmlElement(`
      <table>
        <tbody><tr><td>Body 1</td></tr><tr><td>Body 2</td></tr></tbody>
        <thead><tr><th>Header</th></tr></thead>
      </table>
    `);

    normalizeTableHtml(el);

    const rows = el.querySelectorAll("table > tr");
    expect(rows).toHaveLength(3);
    // thead rows come first even though tbody was first in source
    expect(rows[0].querySelector("th")!.textContent).toBe("Header");
    expect(rows[1].querySelector("td")!.textContent).toBe("Body 1");
  });

  it("handles table with no thead/tbody (already flat)", () => {
    const el = htmlElement(`
      <table>
        <tr><td>A</td></tr>
        <tr><td>B</td></tr>
      </table>
    `);

    normalizeTableHtml(el);

    const rows = el.querySelectorAll("table > tr");
    expect(rows).toHaveLength(2);
  });

  it("handles multiple tables in one element", () => {
    const el = htmlElement(`
      <table><thead><tr><th>T1</th></tr></thead></table>
      <p>separator</p>
      <table><thead><tr><th>T2</th></tr></thead></table>
    `);

    normalizeTableHtml(el);

    expect(el.querySelectorAll("thead")).toHaveLength(0);
    const tables = el.querySelectorAll("table");
    expect(tables).toHaveLength(2);
    expect(tables[0].querySelector("th")!.textContent).toBe("T1");
    expect(tables[1].querySelector("th")!.textContent).toBe("T2");
  });

  it("noop when no tables present", () => {
    const el = htmlElement("<p>No tables here</p>");
    normalizeTableHtml(el);
    expect(el.innerHTML).toContain("No tables here");
  });
});

describe("normalizeMermaidHtml", () => {
  it("decodes &amp; in data-code", () => {
    const el = htmlElement('<div data-type="mermaid-chart" data-code="A &amp; B"></div>');

    normalizeMermaidHtml(el);

    expect(el.querySelector('[data-type="mermaid-chart"]')!.getAttribute("data-code")).toBe(
      "A & B"
    );
  });

  it("decodes &quot; in data-code", () => {
    const el = htmlElement(
      '<div data-type="mermaid-chart" data-code="say &quot;hello&quot;"></div>'
    );

    normalizeMermaidHtml(el);

    expect(el.querySelector('[data-type="mermaid-chart"]')!.getAttribute("data-code")).toBe(
      'say "hello"'
    );
  });

  it("decodes &lt; and &gt; in data-code", () => {
    const el = htmlElement('<div data-type="mermaid-chart" data-code="A &lt;-&gt; B"></div>');

    normalizeMermaidHtml(el);

    expect(el.querySelector('[data-type="mermaid-chart"]')!.getAttribute("data-code")).toBe(
      "A <-> B"
    );
  });

  it("decodes multiple entity types in one attribute", () => {
    const el = htmlElement(
      '<div data-type="mermaid-chart" data-code="A &amp; B &lt; C &gt; D &quot;E&quot;"></div>'
    );

    normalizeMermaidHtml(el);

    expect(el.querySelector('[data-type="mermaid-chart"]')!.getAttribute("data-code")).toBe(
      'A & B < C > D "E"'
    );
  });

  it("does not modify data-code without entities", () => {
    const el = htmlElement('<div data-type="mermaid-chart" data-code="graph TD\n  A --> B"></div>');

    normalizeMermaidHtml(el);

    expect(el.querySelector('[data-type="mermaid-chart"]')!.getAttribute("data-code")).toBe(
      "graph TD\n  A --> B"
    );
  });

  it("skips divs without data-code attribute", () => {
    const el = htmlElement('<div data-type="mermaid-chart"></div>');

    normalizeMermaidHtml(el);

    expect(el.querySelector('[data-type="mermaid-chart"]')!.getAttribute("data-code")).toBeNull();
  });

  it("handles multiple mermaid divs", () => {
    const el = htmlElement(`
      <div data-type="mermaid-chart" data-code="A &amp; B"></div>
      <div data-type="mermaid-chart" data-code="C &lt; D"></div>
    `);

    normalizeMermaidHtml(el);

    const divs = el.querySelectorAll('[data-type="mermaid-chart"]');
    expect(divs[0].getAttribute("data-code")).toBe("A & B");
    expect(divs[1].getAttribute("data-code")).toBe("C < D");
  });

  it("noop when no mermaid divs present", () => {
    const el = htmlElement("<p>No mermaid here</p>");
    normalizeMermaidHtml(el);
    expect(el.innerHTML).toContain("No mermaid here");
  });
});
