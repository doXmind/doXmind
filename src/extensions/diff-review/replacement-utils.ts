/**
 * Utility functions for HTML normalization in diff review.
 */

/**
 * Normalize table HTML for TipTap compatibility.
 *
 * TipTap's table extension doesn't parse <thead>/<tbody>/<colgroup> wrappers.
 * We unwrap thead/tbody and remove colgroup, preserving the correct <th>/<td> tags.
 */
export function normalizeTableHtml(element: HTMLElement): void {
  const tables = element.querySelectorAll("table");

  tables.forEach((table) => {
    // Remove <colgroup> - TipTap regenerates column structure
    table.querySelectorAll("colgroup").forEach((cg) => cg.remove());

    // Collect rows from thead and tbody in correct order
    const headerRows = Array.from(table.querySelectorAll("thead > tr"));
    const bodyRows = Array.from(table.querySelectorAll("tbody > tr"));

    // Remove thead and tbody wrappers (but keep the rows)
    table.querySelectorAll("thead").forEach((thead) => thead.remove());
    table.querySelectorAll("tbody").forEach((tbody) => tbody.remove());

    // Append rows directly to table in correct order
    headerRows.forEach((row) => table.appendChild(row));
    bodyRows.forEach((row) => table.appendChild(row));
  });
}

/**
 * Normalize mermaid chart HTML for TipTap compatibility.
 *
 * Ensures data-code attributes contain clean, decoded mermaid code.
 * Handles cases where the attribute value may contain HTML entities
 * from double-encoding or round-trip encoding.
 */
export function normalizeMermaidHtml(element: HTMLElement): void {
  const mermaidDivs = element.querySelectorAll<HTMLElement>('[data-type="mermaid-chart"]');

  mermaidDivs.forEach((div) => {
    const code = div.getAttribute("data-code");
    if (!code) return;

    const decoded = code
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");

    if (decoded !== code) {
      div.setAttribute("data-code", decoded);
    }
  });
}

/**
 * Normalize math block/inline HTML for TipTap compatibility.
 *
 * Ensures data-latex attributes contain clean, decoded LaTeX.
 * Handles cases where the attribute value may contain HTML entities
 * from double-encoding or round-trip encoding.
 */
export function normalizeMathHtml(element: HTMLElement): void {
  const mathElements = element.querySelectorAll<HTMLElement>(
    '[data-type="block-math"], [data-type="inline-math"]'
  );

  mathElements.forEach((el) => {
    const latex = el.getAttribute("data-latex");
    if (!latex) return;

    const decoded = latex
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");

    if (decoded !== latex) {
      el.setAttribute("data-latex", decoded);
    }
  });
}
