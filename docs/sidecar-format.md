# Sidecar Format

This document is the wire-format contract for doXmind markdown Sidecars and
External-reference Custom Block placeholders. Frontend `CustomBlockExtensions`
and backend `ExternalRefBlockRegistry` implementations must derive equivalent
parsers and serializers from this document.

## Markdown Sidecar JSON Shape

A Sidecar is a hidden `.doxmind` JSON file next to a Document's `.md` file. For
a Synthetic Document opened from a Second-class file such as `.pdf` or `.xlsx`,
the Sidecar uses the same markdown shape and lives next to the original binary.

The canonical reader/writer lives in the backend Sidecar I/O path:

- `MarkdownDocumentState.write_full` writes Sidecars for markdown Documents.
- `SyntheticDocumentFactory._write_sidecar` writes the same shape for Synthetic
  Documents.
- `read_sidecar` accepts only JSON objects; corrupt JSON is handled as a corrupt
  Sidecar, not as an empty one.

Current full-write shape:

```json
{
  "version": 1,
  "id": "dfe24100-bb43-4f93-8553-2d9fdcc50172",
  "html": "<p>Rendered editor HTML</p>",
  "markdown_hash": "b1d4f1f6e2d0f0d6525f3b3e5d2a6ef6a7a6a5e81f1e8f87fd9abf437f2ed5d4",
  "updated_at": "2026-04-29T17:38:00Z",
  "extras": {
    "blocks": {
      "1a2b3c4d-1111-4aaa-8bbb-123456789abc": {}
    }
  }
}
```

| Key             | Type    | Required            | Meaning                                                                                                                        |
| --------------- | ------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `version`       | integer | Yes                 | Sidecar schema version. Current value is `1`.                                                                                  |
| `id`            | string  | Yes for full writes | Stable Document id. If frontmatter disagrees, the Sidecar id wins during read backfill.                                        |
| `html`          | string  | Yes for full writes | Lossless editor HTML for fast reopen when `markdown_hash` matches the current markdown file.                                   |
| `markdown_hash` | string  | Yes                 | Bare SHA-256 hex digest of the full markdown file content after frontmatter is applied. A mismatch means the Sidecar is stale. |
| `updated_at`    | string  | Yes                 | UTC timestamp in ISO-8601 form, for example `2026-04-29T17:38:00Z`.                                                            |
| `extras`        | object  | Optional            | doXmind-only Custom Block state. External-reference block state lives under `extras.blocks.<id>` by default.                   |

New markdown-shape Sidecars should use only these top-level keys. Legacy
PDF/Excel sidecars may contain older top-level keys while they are awaiting
Sidecar migration. Slot-only writes can create a partial Sidecar before the
next full write; readers therefore tolerate missing `id` or `html`, but full
Document and Synthetic Document writes must include them.

`extras` is reserved for doXmind-owned state that has no portable markdown
representation. Portable document content belongs in the `.md` body, not in the
Sidecar. Self-contained Custom Blocks do not require `extras` slots. The
deprecated database block may still use legacy `extras.databases` while it
exists, but new External-reference block state should use `extras.blocks.<id>`
unless the block type explicitly declares another slot key.

## Block Placeholder Grammar

An External-reference Custom Block is represented in markdown by one single-line
HTML comment:

```text
<!-- {block_type} id="{uuid_v4}" src="{relative_path}" [{attr}="{value}"]* -->
```

Example:

```text
<!-- pdf-block id="1a2b3c4d-1111-4aaa-8bbb-123456789abc" src="assets/spec.pdf" -->
```

Rules:

- `block_type` is one of the strings in the vocabulary table below.
- `id` is a UUID v4 generated when the block is inserted. It is immutable for
  the lifetime of that block instance, including when `src` changes.
- `src` is a workspace-scoped relative path to the referenced user file. Current
  writers use paths relative to the owning Document or Synthetic Document
  location; implementations must not write absolute paths.
- Additional attributes are optional extension points. They follow HTML
  attribute syntax and must be single-line `name="value"` pairs. This document
  defines no additional attribute semantics beyond `id` and `src`.
- The placeholder is doXmind internal state, not user-facing document content.
- Multi-line placeholder comments are invalid.

Canonical extraction form:

```text
<!--\s*(?P<block_type>[A-Za-z][A-Za-z0-9-]*)\s+(?P<attrs>[^>]*)-->
```

After matching a placeholder comment, parse `attrs` as HTML-style attributes and
require at least:

```text
id="(?P<id>[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})"
src="(?P<src>[^"]+)"
```

Frontend and backend implementations may use language-specific regexes or an
HTML attribute parser, but they must be equivalent to this contract for
doXmind-written placeholders.

## Block Type Vocabulary

| `block_type`  | Category           | Backend registry presence | Default `slot_key_for_id(id)` |
| ------------- | ------------------ | ------------------------- | ----------------------------- |
| `pdf-block`   | External-reference | Yes                       | `blocks/<id>`                 |
| `excel-block` | External-reference | Yes                       | `blocks/<id>`                 |

Self-contained Custom Blocks such as mermaid, callout, math, toggle, and
page-link are intentionally absent from the backend registry because all of
their state lives in markdown. They may still be present in the frontend
`CustomBlockExtensions` registry.

## Renderer Invisibility

Block placeholders are HTML comments. They must remain invisible in standard
markdown rendering, including GitHub-rendered markdown and pandoc export.

This is a contract for every current and future External-reference block type:
the markdown placeholder must preserve doXmind's internal id/src correlation
without displaying placeholder text to readers outside doXmind.

## Extension Notes

To add a new block type:

- Add the `block_type` string and category to this vocabulary. Use lowercase
  kebab-case and keep the placeholder invisible as an HTML comment.
- Add a frontend `CustomBlockExtensions` entry. Self-contained blocks stop
  there; External-reference blocks also need id/src extraction and a placeholder
  template that emits the grammar above.
- For External-reference blocks, add one backend `ExternalRefBlockRegistry`
  entry with `block_type`, `slot_key_for_id`, hydration mode, salvage behavior,
  and orphan/duplicate/new policies.
- Add tests proving the placeholder round-trips through the frontend parser and
  that backend correlation handles the block's slot policy.
