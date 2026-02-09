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
