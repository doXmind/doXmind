# Sidecar Format

This document is the wire-format contract for doXmind markdown-shaped Sidecars
and External-reference Custom Block placeholders. Frontend
`CustomBlockExtensions`, backend `ExternalRefBlockRegistry`, browser-dev
workspace routes, and desktop/Tauri commands must derive equivalent parsers and
serializers from this document.

Markdown Page is the only first-class content type. Under ADR-0012, PDF and
Excel are Attachments and must not receive new editor state. The Synthetic
Document and External-reference contracts below remain normative only for
strictly reading, correlating, and exporting sidecars created by older versions,
and for documenting historical migration artifacts. They are a legacy recovery
format, not a new-write product model. Recovery parsing also follows the
untrusted-document rules in
[ADR-0011](adr/0011-documents-are-untrusted-input.md).

This wire contract does not expand workspace discovery. Current scanning and
native opening support PDF, spreadsheet, and HTML Attachments; `other` is only a
safe read-only fallback if an unknown format reaches the shared surface. Images
inserted into Pages remain Markdown assets, not standalone workspace documents.

## Markdown Sidecar JSON Shape

A Sidecar is a hidden `.doxmind` JSON file next to a Document's `.md` file. For
a legacy Synthetic Document opened for recovery from `.pdf` or `.xlsx`, the
Sidecar uses the same markdown shape and lives next to the original binary.

The canonical Markdown Page reader/writer lives in the backend Sidecar I/O path:

- `MarkdownDocumentState.write_full` writes Sidecars for markdown Documents.
- `SyntheticDocumentFactory._write_sidecar` is the frozen historical writer for
  Synthetic Documents; the Attachment recovery bridge does not call it.
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

### Legacy Synthetic Document Shape for PDF and Excel

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
          "sourceHash": "0000000000000000000000000000000000000000000000000000000000000000",
          "parsed": {}
        }
      }
    }
  }
}
```

Legacy Synthetic Document recovery contract:

- A recovery candidate may be the main sidecar or `<sidecar>.bak`. Both are
  parsed independently and strictly; neither is copied, migrated, or rewritten.
- In the markdown-shaped form, the only supported PDF/Excel state location is
  `extras.blocks.<block_id>`, where `<block_id>` matches the single placeholder
  in `html`.
- `editor` stores user-facing editor state for that block. PDF editors use the
  PDF editor payload; Excel editors use the workbook editor payload. The slot
  may omit `editor` before the user has edited that file.
- `parsedCache` stores historical parser output and the SHA-256 hash of the
  referenced source binary. Recovery reads only the hash; it does not hydrate or
  refresh the cached parser output.
- Unknown non-empty editor fields, corrupt JSON, future or invalid versions,
  mixed legacy/current shapes, and structurally ambiguous blocks are
  conservatively `unknown`; they are never treated as an empty edit state.
- A legacy PDF `edits` key is eligible for an isolated recovery attempt only when it uses the
  production PDF.js item grammar `p<zero-based-page>-t<item-index>`. Historical
  storage fixtures such as `1:0` have no deterministic source mapping and stay
  `unknown` for manual recovery.
- The source `.pdf` / `.xlsx` file is authoritative input and is never mutated
  by open, edit, save, migration, or cache refresh. Export flows may create a
  new user-selected output file, but they do not silently rewrite the source
  binary.
- `markdown_hash` hashes the generated Synthetic Document markdown
  (frontmatter plus the one placeholder), not the source PDF/XLSX bytes. Source
  binary freshness belongs to `parsedCache.sourceHash`.
- New Attachments MUST NOT create this shape. The recovery bridge reads the
  user-selected `editor` state and its cache hash, checks that hash against the
  exact source bytes used for the attempt, then downloads a new output only if
  strict application succeeds. Historical builds could update `parsedCache`
  without rebinding `editor`, so a matching hash is a mismatch guard—not proof
  of editor provenance. Every attempt is labeled unverified. The bridge MUST
  NOT write the source, main sidecar, `.bak`, or `.lock`.

Legacy top-level `pdf_editor`, `pdf_parsed_cache`, `excel_editor`, and
`excel_parsed_cache` fields are accepted by the strict recovery inspector as the
older shape. They were historically migration input; current Attachment
recovery reads them in place and never moves or removes them.

### Historical Migration and Current Recovery

Older builds migrated PDF/Excel Sidecars one way into the markdown-shaped
Synthetic Document contract:

1. Acquire the sidecar lock.
2. Read the legacy Sidecar.
3. Write the original bytes to `<sidecar>.bak`.
4. Rewrite `<sidecar>` with version `2`, one placeholder in `html`, and
   migrated `editor` / `parsedCache` values under
   `extras.blocks.<block_id>`.

Those historical migration artifacts remain recovery evidence:

- If rewrite fails after `.bak` is written, restore by renaming
  `<sidecar>.bak` back to `<sidecar>`.
- If `<sidecar>.bak` already exists, migration is blocked so a maintainer can
  inspect the previous backup instead of overwriting recovery evidence.
- `<sidecar>.lock` may remain after migration and must not be removed as cleanup.
- A timestamped `<sidecar>.corrupt-*` may contain bytes preserved by an older
  build when migration could not proceed.

The current Attachment recovery flow does not run those migration steps. It:

1. Reads the main sidecar and `.bak` independently with the strict parser.
2. Reports each candidate as `available`, `none`, or `unknown`.
3. Requires an explicit source choice when both candidates have different
   recoverable editor state; equivalent candidates recommend the main sidecar.
4. Returns the selected editor state plus its normalized cache hash. The
   frontend hashes the exact source bytes it will use and refuses a mismatch
   before calling the isolated PDF/XLSX exporter. It clearly labels the result
   an unverified recovery copy and downloads `<name> recovered.pdf` or
   `<name> recovered.xlsx` only after complete application succeeds.

The recovery path does not mount the legacy PDF/Excel editor and does not call
legacy readers, writers, migration, or process caches. PDF export fails as a
whole if stored edits cannot be matched strictly to the source. The Excel
recovery path validates and accounts for every requested mutation; missing
sheets, malformed targets, or silently skipped operations fail the whole export.
Non-empty Excel `filters` or `filterMode` are `unknown` rather than silently
omitted. An `.xlsm` source exports as `.xlsx`, and the UI warns that macros are
not included.

Tests assert byte-for-byte content, mtimes, and directory membership for the
source, main sidecar, `.bak`, and `.lock` around inspection and export. These
files must remain in place even after a successful export. `Unknown` or
unsupported candidates still require a manual recovery path and block the
ADR-0012 legacy-code removal gate.

### Release Validation Fixtures

The release compatibility fixtures live in
[`tests/fixtures/sidecar_compat`](../tests/fixtures/sidecar_compat):

- `pdf_legacy.doxmind.json`
- `excel_legacy.doxmind.json`
- `pdf_markdown_shape.doxmind.json`
- `excel_markdown_shape.doxmind.json`

The frozen legacy stack still validates its historical read/write/migration
contract against these fixtures. The current recovery bridge has a separate,
zero-write release gate:

- `server/tests/test_workspace.py` and
  `src-tauri/src/attachment_inspection.rs` exercise equivalent strict inspection
  and selected-source reads for the browser-dev and desktop paths.
- Frontend attachment and PDF/XLSX recovery tests verify source selection,
  strict exporter refusal, recovered-copy downloads, and the `.xlsm` warning.
- Recovery tests snapshot bytes, mtimes, and directory membership so the source,
  main sidecar, `.bak`, and `.lock` cannot be changed accidentally.

Any compatibility change that touches Synthetic Documents must update all four
fixtures and both runtime validations together. A change that creates this
shape for a new Attachment, or adds a separate PDF-only or Excel-only top-level
field, is a contract regression unless a new ADR replaces ADR-0012.

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
