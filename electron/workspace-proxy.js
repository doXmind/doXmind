"use strict";

/**
 * Routes the workspace/document data-plane commands to the Python sidecar over
 * HTTP. These commands are already mirrored by `server/api/workspace.py`'s
 * `/invoke` dispatcher (the same surface the browser-dev HTTP fallback uses),
 * so the Electron shell forwards them verbatim instead of reimplementing the
 * Rust logic in Node.
 *
 * `workspace_read_binary` is special-cased onto the dedicated octet-stream
 * route so multi-MB PDFs/workbooks don't pay the JSON `number[]` (~4.5x) tax.
 *
 * Error messages mirror the frontend's `invokeWorkspaceHttp` so downstream
 * matchers (e.g. isReadOnlyDocumentError) keep working on the thrown string.
 *
 * Pure Node (no `electron` import) so scripts/electron-smoke.mjs can drive it.
 */

const WORKSPACE_COMMANDS = new Set([
  "workspace_default_root",
  "workspace_scan",
  "workspace_index_rebuild",
  "workspace_markdown_search",
  "doc_read",
  "workspace_read_binary",
  "workspace_stat_binary",
  "workspace_read_pdf_editor_state",
  "workspace_write_pdf_editor_state",
  "workspace_read_excel_editor_state",
  "workspace_write_excel_editor_state",
  "workspace_read_pdf_doc_state",
  "workspace_write_pdf_parsed_cache",
  "workspace_read_excel_doc_state",
  "workspace_write_excel_parsed_cache",
  "doc_write_workspace",
  "doc_create",
  "doc_create_pdf",
  "doc_create_excel",
  "doc_import_external",
  "doc_rename",
  "doc_move",
  "doc_delete",
  "workspace_create_folder",
  "workspace_rename_folder",
  "workspace_delete_folder",
  "workspace_import_asset",
]);

function isWorkspaceCommand(cmd) {
  return WORKSPACE_COMMANDS.has(cmd);
}

async function errorMessage(res, command) {
  let message = `Workspace command failed: ${command}`;
  try {
    const body = await res.json();
    const detail = body && body.detail;
    if (typeof detail === "string") message = detail;
    else if (detail && typeof detail === "object") message = JSON.stringify(detail);
    else if (typeof detail === "number" || typeof detail === "boolean") message = String(detail);
    else if (body && body.error && body.error.message) message = body.error.message;
  } catch {
    // keep the generic message
  }
  return message;
}

async function proxyWorkspace(sidecarUrl, command, payload) {
  const args = payload || {};

  if (command === "workspace_read_binary") {
    const url = new URL("/api/workspace/binary", sidecarUrl);
    url.searchParams.set("root", String(args.root ?? ""));
    url.searchParams.set("path", String(args.path ?? ""));
    const res = await fetch(url);
    if (!res.ok) throw new Error(await errorMessage(res, command));
    return new Uint8Array(await res.arrayBuffer());
  }

  const res = await fetch(new URL("/api/workspace/invoke", sidecarUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, payload: args }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, command));
  return res.json();
}

module.exports = { WORKSPACE_COMMANDS, isWorkspaceCommand, proxyWorkspace };
