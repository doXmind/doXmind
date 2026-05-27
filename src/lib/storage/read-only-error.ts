/**
 * Detect the cross-runtime "document is read-only" error surfaced by both
 * the Tauri (Rust) and HTTP-fallback (Python) save paths.
 *
 * Rust path: `read_only_document_error()` (src-tauri/src/lib.rs) emits a
 * String containing the literal substring `"read-only"`. That string flows
 * unmodified through `invoke()` to the frontend as an `Error.message`.
 *
 * Python path: `ReadOnlyDocumentError` is mapped to HTTP 409 with a JSON
 * body of `{detail: {code: "document_read_only", ...}}` by
 * `server/api/workspace.py`. The `invokeWorkspaceHttp` fallback in
 * `disk-storage-adapter.ts` stringifies `body.detail` into the thrown
 * `Error.message` — when `detail` is an object the result is the literal
 * `"[object Object]"`, which loses the discriminator. We therefore match
 * both the stable substring `"read-only"` and the code `"document_read_only"`
 * so either transport surface lights up.
 *
 * The contract is intentionally substring-based rather than a typed error
 * class — backend producers stay free to evolve their message wording
 * around the stable `"read-only"` anchor without coordinating a frontend
 * release.
 */
export function isReadOnlyDocumentError(err: unknown): boolean {
  if (err == null) return false;
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : (() => {
            try {
              return JSON.stringify(err);
            } catch {
              return String(err);
            }
          })();
  return message.includes("read-only") || message.includes("document_read_only");
}

/**
 * User-facing copy for the read-only banner. Centralised so the Excel and
 * PDF autosave handlers stay in sync and tests can assert on a single
 * string. References `DOXMIND_SIDECAR_MIGRATE=off` verbatim so a user who
 * set the flag themselves can map the message back to their config.
 */
export const READ_ONLY_NOTICE_TITLE = "Document opened in read-only mode";
export const READ_ONLY_NOTICE_DESCRIPTION =
  "DOXMIND_SIDECAR_MIGRATE=off is in effect against a legacy sidecar. Your edits are not being saved.";

/**
 * Shared autosave error handler. If `err` is the cross-runtime read-only
 * error and the per-file `surfacedRef` has not been flipped yet, calls
 * `notifyError` once and flips the ref so subsequent saves stay silent.
 * Returns `true` when handled (caller should skip further error
 * reporting), `false` when the error was something else.
 *
 * The ref is wrapped in a `{ current }` object so both editors can pass
 * their existing `useRef`-backed state through unchanged.
 */
export function handleReadOnlyAutosaveError(
  err: unknown,
  surfacedRef: { current: boolean },
  notifyError: (
    title: string,
    options?: { description?: string; persistent?: boolean }
  ) => void
): boolean {
  if (!isReadOnlyDocumentError(err)) return false;
  if (surfacedRef.current) return true;
  surfacedRef.current = true;
  // Persistent because the user is typing when this fires; a 5s toast
  // would dismiss before they look up, and the per-file spam guard means
  // they'd never see it again until they switch files.
  notifyError(READ_ONLY_NOTICE_TITLE, {
    description: READ_ONLY_NOTICE_DESCRIPTION,
    persistent: true,
  });
  return true;
}
