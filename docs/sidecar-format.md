# Sidecar Format

This document is the wire-format contract for doXmind markdown-shaped Sidecars
and External-reference Custom Block placeholders. Frontend
`CustomBlockExtensions`, backend `ExternalRefBlockRegistry`, browser-dev
workspace routes, and desktop/Tauri commands must derive equivalent parsers and
serializers from this document.

Markdown is the only first-class Document type. PDF and Excel files are
Second-class files represented as Synthetic Documents with exactly one
External-reference Custom Block (`pdf-block` or `excel-block`). Those Synthetic
Documents use this same Sidecar shape; they do not own a separate PDF or Excel
Sidecar contract.

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
  "version": 2,
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

| Key             | Type    | Required            | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------- | ------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`       | integer | Yes                 | Sidecar schema version. Current value is `2`. Version `2` replaced `1` when cached editor HTML needed invalidation for ADR-0006; version checks are part of the release contract.                                                                                                                                                                                                                                                         |
| `id`            | string  | Yes for full writes | Stable document identifier. UUID v4 for natively-created documents and Synthetic Documents. For Synthetic Documents migrated from a legacy PDF/Excel sidecar, the original stable_path_id (form: `path:<hash>`) is preserved and is NOT a UUID. If frontmatter disagrees, the Sidecar id wins during read backfill. `_snapshot_from_legacy` in [`synthetic_document.py`](../server/services/synthetic_document.py) produces non-UUID ids. |
| `html`          | string  | Yes for full writes | Lossless editor HTML for fast reopen when `markdown_hash` matches the current markdown file. In the DocumentStore read model this field is exposed as `editorHtml`; it is not the Browsing Runtime's `browsingHtml`. See [ADR-0008](adr/0008-documentstore-browsing-read-model.md).                                                                                                                                                       |
| `markdown_hash` | string  | Yes                 | SHA-256 hex digest of the complete markdown text, including frontmatter. For first-class Markdown Documents this is the real `.md` file. For Synthetic Documents this is the generated markdown body containing the one External-reference placeholder.                                                                                                                                                                                   |
| `updated_at`    | string  | Yes                 | UTC timestamp in ISO-8601 form, for example `2026-04-29T17:38:00Z`.                                                                                                                                                                                                                                                                                                                                                                       |
| `extras`        | object  | Optional            | doXmind-only Custom Block state. External-reference block state lives under `extras.blocks.<id>` by default.                                                                                                                                                                                                                                                                                                                              |

Readers MUST accept any non-empty string for `id`.
`MarkdownDocumentState.write_full` rejects an empty id with `ValueError`;
readers encountering a Sidecar with an empty id, currently impossible to
produce but defensible to guard against, should treat the document as
malformed.

Any reader recomputing the hash to detect staleness must include frontmatter;
body-only hashing produces false stale results.

New markdown-shape Sidecars MUST use only these top-level keys. Legacy PDF/Excel
Sidecars may contain older top-level keys while they are awaiting Sidecar
migration. Those legacy keys are migration input only and MUST NOT be written by
new code:

- `source_path`
- `updated_at_unix_nanos`
- `pdf_editor`
- `pdf_parsed_cache`
- `excel_editor`
- `excel_parsed_cache`

Slot-only writes can create a partial Sidecar before the next full write — see
"Partial Sidecar Shape" below for the exact field set and reader contract.

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
  "version": 2,
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
  Sidecar. (An _empty-string_ `id` is still treated as malformed, per the rule
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

### Synthetic Document Shape for PDF and Excel

A Synthetic Document Sidecar lives next to its source binary and keeps the
binary filename in the sidecar name:

```text
Spec.pdf
.Spec.pdf.doxmind
Budget.xlsx
.Budget.xlsx.doxmind
```

The Sidecar `html` field MUST contain exactly one External-reference placeholder
for the matching block type:

```json
{
  "version": 2,
  "id": "fixture-pdf-doc",
  "html": "<!-- pdf-block id=\"fixture-pdf-block\" src=\"Spec.pdf\" -->",
  "markdown_hash": "0000000000000000000000000000000000000000000000000000000000000000",
  "updated_at": "2026-05-12T00:00:00Z",
  "extras": {
    "blocks": {
      "fixture-pdf-block": {
        "editor": {
          "version": 1,
          "edits": {}
        },
        "parsedCache": {
          "sourceHash": "sha256-of-source-binary-or-parser-input",
          "parsed": {}
        }
      }
    }
  }
}
```

Synthetic Document reader/writer contract:

- The only supported PDF/Excel state location is
  `extras.blocks.<block_id>`, where `<block_id>` matches the single placeholder
  in `html`.
- `editor` stores user-facing editor state for that block. PDF editors use the
  PDF editor payload; Excel editors use the workbook editor payload. The slot
  may omit `editor` before the user has edited that file.
- `parsedCache` stores parser output for the referenced source binary. It is an
  object with `sourceHash` and `parsed`; writers that update parser output must
  replace this slot field atomically and preserve `editor`.
- Unknown sibling fields inside the block slot are pass-through state and must
  be preserved, but release-facing compatibility only guarantees `editor` and
  `parsedCache`.
- The source `.pdf` / `.xlsx` file is authoritative input and is never mutated
  by open, edit, save, migration, or cache refresh. Export flows may create a
  new user-selected output file, but they do not silently rewrite the source
  binary.
- `markdown_hash` hashes the generated Synthetic Document markdown
  (frontmatter plus the one placeholder), not the source PDF/XLSX bytes. Source
  binary freshness belongs to `parsedCache.sourceHash`.

Legacy top-level `pdf_editor`, `pdf_parsed_cache`, `excel_editor`, and
`excel_parsed_cache` fields are accepted only as migration input. On first open
with migration enabled, they are moved into the matching block slot and removed
from the rewritten Sidecar.

### Legacy Migration and Recovery

Legacy PDF/Excel Sidecars migrate one way into the markdown-shaped Synthetic
Document contract. The migration path is intentionally explicit on open, not a
side effect of save:

1. Acquire the sidecar lock.
2. Read the legacy Sidecar.
3. Write the original bytes to `<sidecar>.bak`.
4. Rewrite `<sidecar>` with version `2`, one placeholder in `html`, and
   migrated `editor` / `parsedCache` values under
   `extras.blocks.<block_id>`.

Recovery and failure rules:

- If rewrite fails after `.bak` is written, restore by renaming
  `<sidecar>.bak` back to `<sidecar>`.
- If `<sidecar>.bak` already exists, migration is blocked so a maintainer can
  inspect the previous backup instead of overwriting recovery evidence.
- If the Sidecar is corrupt JSON, has non-UTF-8 bytes, or has a non-object JSON
  top level, do not rewrite it. Write a timestamped forensic copy named
  `<sidecar>.corrupt-*`, leave the original Sidecar bytes in place, and surface
  the error.
- `DOXMIND_SIDECAR_MIGRATE=0` disables the rewrite path for legacy Sidecars;
  the app may synthesize a read-only in-memory document from legacy state, but
  writes must be rejected until migration is enabled or the Sidecar is manually
  restored.

### Release Validation Fixtures

The release compatibility fixtures live in
[`tests/fixtures/sidecar_compat`](../tests/fixtures/sidecar_compat):

- `pdf_legacy.doxmind.json`
- `excel_legacy.doxmind.json`
- `pdf_markdown_shape.doxmind.json`
- `excel_markdown_shape.doxmind.json`

Release validation MUST exercise both runtime paths against these fixtures:

- Browser-dev/FastAPI path: `server/tests/test_sidecar_cross_runtime_compat.py`
  verifies that workspace invoke reads, editor writes, parsed-cache writes, and
  legacy migrations preserve the shared contract.
- Desktop/Tauri path: `src-tauri/src/lib.rs` includes the same fixture files in
  Rust tests so desktop commands and browser-dev routes cannot drift.

Any Sidecar change that touches Synthetic Documents must update all four
fixtures and both runtime validations together. A change that adds a separate
PDF-only or Excel-only top-level Sidecar field is a contract regression unless a
new ADR explicitly replaces the Markdown-first model.

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

| `block_type`  | Category           | Backend registry presence | Default `slot_key_for_id(id)` | `hydration_mode` | `salvage_rule`                           | Frontend extension class                |
| ------------- | ------------------ | ------------------------- | ----------------------------- | ---------------- | ---------------------------------------- | --------------------------------------- |
| `pdf-block`   | External-reference | Yes                       | `blocks/<id>`                 | LAZY             | Keep matching slot; discard orphan slots | `PdfBlock`                              |
| `excel-block` | External-reference | Yes                       | `blocks/<id>`                 | LAZY             | Keep matching slot; discard orphan slots | `ExcelBlock`                            |
| `mermaid`     | Self-contained     | No                        | —                             | —                | —                                        | `MermaidChart`                          |
| `callout`     | Self-contained     | No                        | —                             | —                | —                                        | `Callout`                               |
| `math`        | Self-contained     | No                        | —                             | —                | —                                        | `InlineMath`, `BlockMath`               |
| `toggle`      | Self-contained     | No                        | —                             | —                | —                                        | `Toggle`, `ToggleSummary`, `ToggleBody` |
| `page-link`   | Self-contained     | No                        | —                             | —                | —                                        | `PageLink`                              |

Self-contained Custom Blocks live entirely in markdown and the Sidecar's `html`
field; they have no backend registry presence, no slot, no hydration mode, and
no salvage rule. The deprecated `database` block is intentionally not migrated
to the frontend `CustomBlockExtensions` registry per ADR-0004 and is therefore
absent from the table above.

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
