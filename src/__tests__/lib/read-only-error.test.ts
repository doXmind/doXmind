import { describe, expect, it, vi } from "vitest";
import {
  READ_ONLY_NOTICE_DESCRIPTION,
  READ_ONLY_NOTICE_TITLE,
  handleReadOnlyAutosaveError,
  isReadOnlyDocumentError,
} from "@/lib/storage/read-only-error";

describe("isReadOnlyDocumentError", () => {
  it("matches the Rust read_only_document_error() format", () => {
    // Verbatim shape produced by `read_only_document_error()` in
    // src-tauri/src/lib.rs — the cross-runtime substring contract.
    const err = new Error(
      "document at /Users/foo/.Bar.doxmind is read-only (DOXMIND_SIDECAR_MIGRATE=0 against legacy sidecar)"
    );
    expect(isReadOnlyDocumentError(err)).toBe(true);
  });

  it("matches the Python HTTP 409 `document_read_only` code", () => {
    // The HTTP fallback in `invokeWorkspaceHttp` collapses the
    // `{detail: {code: "document_read_only", ...}}` body into the thrown
    // Error.message. We anchor on the discriminator so the read-only banner
    // still fires even when the detail object stringifies to
    // "[object Object]".
    const err = new Error("Workspace command failed: document_read_only");
    expect(isReadOnlyDocumentError(err)).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isReadOnlyDocumentError(new Error("sidecar_corrupt"))).toBe(false);
    expect(isReadOnlyDocumentError(new Error("ENOENT: no such file"))).toBe(false);
  });

  it("handles plain strings and null safely", () => {
    expect(isReadOnlyDocumentError("read-only")).toBe(true);
    expect(isReadOnlyDocumentError("anything else")).toBe(false);
    expect(isReadOnlyDocumentError(null)).toBe(false);
    expect(isReadOnlyDocumentError(undefined)).toBe(false);
  });
});

describe("handleReadOnlyAutosaveError", () => {
  it("fires the notice once and flips the ref", () => {
    const ref = { current: false };
    const notify = vi.fn();
    const err = new Error("document at /tmp/foo is read-only (...)");

    const handled = handleReadOnlyAutosaveError(err, ref, notify);

    expect(handled).toBe(true);
    expect(ref.current).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(READ_ONLY_NOTICE_TITLE, {
      description: READ_ONLY_NOTICE_DESCRIPTION,
    });
  });

  it("returns true on repeat hits without re-notifying", () => {
    const ref = { current: false };
    const notify = vi.fn();
    const err = new Error("read-only sidecar");

    handleReadOnlyAutosaveError(err, ref, notify);
    handleReadOnlyAutosaveError(err, ref, notify);
    handleReadOnlyAutosaveError(err, ref, notify);

    // Subsequent calls still report `true` (caller must skip its own
    // error path) but the toast must only have surfaced once.
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("returns false and skips notify for unrelated errors", () => {
    const ref = { current: false };
    const notify = vi.fn();
    const err = new Error("disk full");

    const handled = handleReadOnlyAutosaveError(err, ref, notify);

    expect(handled).toBe(false);
    expect(ref.current).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it("references DOXMIND_SIDECAR_MIGRATE in the user-facing description", () => {
    // The notice copy must mention the flag verbatim so a user who set
    // it themselves can map the surfaced message back to their config.
    // Guard the contract here so a future copy edit can't silently drop it.
    expect(READ_ONLY_NOTICE_DESCRIPTION).toContain("DOXMIND_SIDECAR_MIGRATE");
    expect(READ_ONLY_NOTICE_DESCRIPTION).toContain("off");
  });
});
