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
  "markdown_hash": "0000000000000000000000000000000000000000000000000000000000000000",
  "updated_at": "2026-04-29T17:38:00Z",
  "extras": {
    "blocks": {
      "1a2b3c4d-1111-4aaa-8bbb-123456789abc": {}
    }
  }
}
```

| Key             | Type    | Required            | Meaning                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------- | ------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`       | integer | Yes                 | Sidecar schema version. Current value is `1`.                                                                                                                                                                                                                                                                                                                                                                  |
| `id`            | string  | Yes for full writes | Stable document identifier. UUID v4 for natively-created documents and Synthetic Documents. For Synthetic Documents migrated from a legacy PDF/Excel sidecar, the original stable_path_id (form: `path:<hash>`) is preserved and is NOT a UUID. If frontmatter disagrees, the Sidecar id wins during read backfill. `_snapshot_from_legacy` in [`synthetic_document.py`](../server/services/synthetic_document.py) produces non-UUID ids. |
| `html`          | string  | Yes for full writes | Lossless editor HTML for fast reopen when `markdown_hash` matches the current markdown file.                                                                                                                                                                                                                                                                                                                   |
| `markdown_hash` | string  | Yes                 | SHA-256 hex digest of the complete `.md` file content, including frontmatter. A mismatch means the Sidecar is stale.                                                                                                                                                                                                                                                                                            |
| `updated_at`    | string  | Yes                 | UTC timestamp in ISO-8601 form, for example `2026-04-29T17:38:00Z`.                                                                                                                                                                                                                                                                                                                                            |
| `extras`        | object  | Optional            | doXmind-only Custom Block state. External-reference block state lives under `extras.blocks.<id>` by default.                                                                                                                                                                                                                                                                                                   |

Readers MUST accept any non-empty string for `id`.
`MarkdownDocumentState.write_full` rejects an empty id with `ValueError`;
readers encountering a Sidecar with an empty id, currently impossible to
produce but defensible to guard against, should treat the document as
malformed.

Any reader recomputing the hash to detect staleness must include frontmatter;
body-only hashing produces false stale results.

New markdown-shape Sidecars should use only these top-level keys. Legacy
PDF/Excel sidecars may contain older top-level keys while they are awaiting
Sidecar migration. Slot-only writes can create a partial Sidecar before the
next full write — see "Partial Sidecar Shape" below for the exact field set
and reader contract.

`extras` is reserved for doXmind-owned state that has no portable markdown
representation. Portable document content belongs in the `.md` body, not in the
Sidecar. Self-contained Custom Blocks do not require `extras` slots. The
deprecated database block may still use legacy `extras.databases` while it
exists, but new External-reference block state should use `extras.blocks.<id>`
unless the block type explicitly declares another slot key.

### Partial Sidecar Shape

`MarkdownDocumentState.write_slot` is a slot-only writer used by lazy block
hydration paths (per ADR-0002). When it runs against a Document whose Sidecar
does not yet exist, it produces a Sidecar with only the minimal fields needed
to record the slot value and link the Sidecar to the current `.md` body:

```json
{
  "version": 1,
  "markdown_hash": "0000000000000000000000000000000000000000000000000000000000000000",
  "extras": {
    "blocks": {
      "1a2b3c4d-1111-4aaa-8bbb-123456789abc": {}
    }
  },
  "updated_at": "2026-04-29T17:38:00Z"
}
```

A partial Sidecar omits `id`, `html`, and `source_path`. It is a legitimate
on-disk state, not a corruption signal — the next `MarkdownDocumentState.write_full`
upgrades the Sidecar to the full shape.

Reader contract for partial Sidecars:

- `id` MAY be absent. Readers MUST treat an absent `id` as "no Sidecar-recorded
  id"; resolution falls back to frontmatter or to assigning a fresh id at the
  next full write. Readers MUST NOT treat an absent `id` as a malformed
  Sidecar. (An *empty-string* `id` is still treated as malformed, per the rule
  above.)
- `html` MAY be absent. Readers MUST treat an absent `html` as the empty
  string for the purpose of editor hydration; the editor then re-imports HTML
  from the `.md` body, just as it would for a missing Sidecar.
- `source_path` MAY be absent.
- `version`, `markdown_hash`, `updated_at`, and `extras` follow the same rules
  as in the full shape. In particular, `markdown_hash` is still authoritative
  for staleness detection.

`SyntheticDocumentFactory._write_sidecar` always writes the full shape; the
partial shape is exclusive to `MarkdownDocumentState.write_slot` against a
previously-absent Sidecar.

## Block Placeholder Grammar

An External-reference Custom Block is represented in markdown by one single-line
HTML comment:

```text
<!-- {block_type} id="{uuid_v4_or_legacy_id}" src="{relative_path}" [{attr}="{value}"]* -->
```

The canonical production order is:

```text
<!-- {block_type} id={uuid_v4_or_legacy_id} src={relative_path} [{attr}={value}]* -->
```

`id` MUST appear before `src`, and any additional attributes MUST follow `src`.
Slice #33's frontend regex will be derived from this spec; order-agnostic specs
cause silent frontend/backend disagreement.

Example:

```text
<!-- pdf-block id="1a2b3c4d-1111-4aaa-8bbb-123456789abc" src="assets/spec.pdf" -->
```

Rules:

- `block_type` is one of the strings in the vocabulary table below.
- `id` is a non-empty stable block id generated when the block is inserted. It
  is immutable for the lifetime of that block instance, including when `src`
  changes.
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
<!--\s*(?P<block_type>pdf-block|excel-block)\s+id="(?P<id>[^"]+)"\s+src="(?P<src>[^"]+)"(?P<attrs>.*?)\s*-->
```

Implementer's tip: slice #33's frontend regex must anchor the attrs group the
same way.

Frontend and backend implementations may use language-specific regexes or an
HTML attribute parser, but they must be equivalent to this contract for
doXmind-written placeholders.

## Block Type Vocabulary

| `block_type`  | Category           | Backend registry presence | Default `slot_key_for_id(id)` | `hydration_mode` | `salvage_rule`                              | Frontend extension class |
| ------------- | ------------------ | ------------------------- | ----------------------------- | ---------------- | ------------------------------------------- | ------------------------ |
| `pdf-block`   | External-reference | Yes                       | `blocks/<id>`                 | LAZY             | Keep matching slot; discard orphan slots    | —                        |
| `excel-block` | External-reference | Yes                       | `blocks/<id>`                 | LAZY             | Keep matching slot; discard orphan slots    | —                        |

_The frontend extension class column will be filled in when slice #33 (#33) creates the corresponding CustomBlockExtensions entries._

Self-contained Custom Blocks such as mermaid, callout, math, toggle, and
page-link are intentionally absent from the backend registry because all of
their state lives in markdown. They may still be present in the frontend
`CustomBlockExtensions` registry.

## Renderer Invisibility

Block placeholders are HTML comments. They must remain invisible to readers in
doXmind's internal markdown rendering — that is, the path that runs through
`markdown_to_html` in `sidecar_io.py`. This is the only renderer covered by CI;
the regression test in `test_sidecar_format.py` locks the placeholder to
production output by importing the canonical placeholder helper and asserting
that the rendered HTML keeps the comment as a standalone block-level node, not
nested inside `<p>` or any other element.

Invisibility under GitHub-rendered markdown and pandoc export is a design
invariant of the placeholder grammar — single-line HTML comments are dropped by
both renderers — but it is **not** verified by CI. It is verified by inspection
only. If a new External-reference block type proposes a placeholder shape that
strays from the single-line HTML-comment grammar, the burden is on the proposer
to re-confirm that shape is invisible in GitHub and pandoc output before the
spec is updated.

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
- Any new External-reference `block_type` MUST declare both `hydration_mode` and
  `salvage_rule` in the vocabulary table. ADR-0002,
  [Hybrid Hydration for Custom Blocks](adr/0002-hybrid-hydration-for-custom-blocks.md),
  is the governing contract.
- Add tests proving the placeholder round-trips through the frontend parser and
  that backend correlation handles the block's slot policy.
