# Sidecar Format

Status: legacy recovery only

ADR-0012 removed Sidecars from the normal Markdown Page model. Everything in
this document describes bytes that older releases may already have created and
the isolated code needed to inventory, correlate, export, or recover them. New
Page create/open/save code MUST NOT create these shapes or derive current Page
identity/content from them.

This document is the historical wire-format reference for doXmind
markdown-shaped Sidecars and External-reference Custom Block placeholders.
Current code has no Page or Attachment Sidecar serializer. Read-only attachment
inspection/recovery may parse known attachment state. PAGELEG-1 inventories a
Page's legacy family and exports raw bytes without interpreting this shape;
legacy-family move/Trash operations carry the same bytes unchanged.

Markdown Page is the only first-class content type. Under ADR-0012, a Page is
one Markdown file and must not receive new Sidecar state. PDF and Excel are
Attachments and also must not receive new editor state. The contracts below
remain normative only for reading, inventorying, and exporting bytes created by
older versions.

## Legacy Markdown-shaped Sidecar JSON Shape

A Sidecar is a hidden `.doxmind` JSON file older builds placed next to a Page or
Attachment. For a legacy Synthetic Document opened for recovery from `.pdf` or
`.xlsx`, the Sidecar uses the same markdown shape and lives next to the original
binary.

Current recovery boundaries are deliberately smaller:

- Page Sidecar parsing and the historical `read_doc`/`write_doc` DTOs are
  removed. Electron Page recovery reads each existing family member as opaque bytes and
  records byte-exact Base64 in a Markdown report, including corrupt input.
- Attachment inspection/recovery reads existing JSON bytes without migration,
  cache refresh, normalization, or forensic-copy writes.
- `SyntheticDocumentFactory` and the PDF/Excel editor/write/cache/create paths
  are removed. No current runtime writes the shapes documented below.

Historical full-write shape:

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

| Key             | Type    | Historical requirement | Meaning                                                                                                                                                                                        |
| --------------- | ------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`       | integer | Yes                    | Sidecar schema version. The last written value was `2`; version `2` replaced `1` when cached editor HTML needed invalidation for ADR-0006.                                                     |
| `id`            | string  | Full shape             | Historical document identifier. It may correlate recovery state but never overrides current Page frontmatter/path identity. Synthetic migrations may contain `path:<hash>` rather than a UUID. |
| `html`          | string  | Full shape             | Historical lossless editor HTML/cache. Current Page editing never hydrates from it. See superseded [ADR-0008](adr/0008-documentstore-browsing-read-model.md).                                  |
| `markdown_hash` | string  | Yes                    | Historical SHA-256 digest of complete Markdown. Synthetic Documents hashed their generated Markdown placeholder rather than the source PDF/XLSX bytes.                                         |
| `updated_at`    | string  | Yes                    | UTC timestamp in ISO-8601 form, for example `2026-04-29T17:38:00Z`.                                                                                                                            |
| `extras`        | object  | Optional               | Historical doXmind-only state. Attachment editor state may live under `extras.blocks.<id>`; Page/DatabaseBlock extras remain relevant only to read-only inventory/export.                      |

Readers MUST accept any non-empty string for `id`.
Readers encountering a Sidecar with an empty id should treat the document as
malformed.

Any reader recomputing the hash to detect staleness must include frontmatter;
body-only hashing produces false stale results.

Historical markdown-shape Sidecars used only these top-level keys. Legacy
PDF/Excel Sidecars may instead contain the older top-level keys below. Current
inspection/recovery recognizes them without migrating or rewriting them:

- `source_path`
- `updated_at_unix_nanos`
- `pdf_editor`
- `pdf_parsed_cache`
- `excel_editor`
- `excel_parsed_cache`

Older slot-only writers could create a partial Sidecar before a full write; the
shape remains part of the read-only recovery contract below.

`extras` contains historical doXmind-owned state that lacked a portable
Markdown representation. No new Page or External-reference block state may be
added here. The deprecated database block and old attachment blocks may retain
their existing slots until export/recovery completes.

### Partial Sidecar Shape

Older releases used a slot-only writer for lazy block hydration (ADR-0002).
Against a Document without a Sidecar, it could produce only the minimal fields
needed to record a slot value and link it to the `.md` body:

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
legacy recovery state, not a corruption signal. Normal Page code leaves it
byte-identical; no current workflow upgrades it.

Reader contract for partial Sidecars:

- `id` MAY be absent. Readers MUST treat an absent `id` as "no Sidecar-recorded
  id" and MUST NOT treat it as malformed. Current Page identity still comes
  from frontmatter/path and is never synthesized from this file. (An
  _empty-string_ `id` is still malformed, per the rule above.)
- `html` MAY be absent. Current Page editing ignores Sidecar HTML; a recovery
  reader must therefore preserve absence rather than inventing Page state.
- `source_path` MAY be absent.
- `version`, `markdown_hash`, `updated_at`, and `extras` follow the same rules
  as in the full shape. In particular, `markdown_hash` is still authoritative
  for staleness detection.

Historical Synthetic Document writers used the full shape; partial shapes came
from the old Page slot writer. Both writers are retired from the current Page
and Attachment paths.

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
          "sourceHash": "sha256-of-source-binary-or-parser-input",
          "parsed": {}
        }
      }
    }
  }
}
```

Legacy Synthetic Document recovery contract:

- The historical markdown-shaped PDF/Excel state location is
  `extras.blocks.<block_id>`, where `<block_id>` matches the single placeholder
  in `html`. Zero-write recovery also recognizes the original top-level
  `pdf_editor` / `excel_editor` forms.
- `editor` stores user-facing editor state for that block. PDF editors use the
  PDF editor payload; Excel editors use the workbook editor payload. The slot
  may omit `editor` before the user has edited that file.
- `parsedCache` stores parser output for the referenced source binary. It is an
  object with `sourceHash` and `parsed`. Current recovery code does not refresh
  it; the original Sidecar bytes preserve it.
- Unknown sibling fields inside the block slot remain preserved because the
  current recovery path never rewrites the Sidecar.
- The source `.pdf` / `.xlsx` file is authoritative input. Current inspection
  and recovery never mutate it; report export writes only a separate
  user-selected Markdown file.
- `markdown_hash` hashes the generated Synthetic Document markdown
  (frontmatter plus the one placeholder), not the source PDF/XLSX bytes. Source
  binary freshness belongs to `parsedCache.sourceHash`.
- New Attachments MUST NOT create this shape. Attachment Sidecar writes are not
  permitted; export writes only a separate user-selected Markdown report.

Legacy top-level `pdf_editor`, `pdf_parsed_cache`, `excel_editor`, and
`excel_parsed_cache` fields are read-only recovery input. They stay in place and
are never normalized into a rewritten Sidecar.

### Retired Migration Algorithm (Historical)

Older builds implemented ADR-0003 by migrating legacy PDF/Excel Sidecars into
the markdown-shaped Synthetic Document contract on open:

1. Acquire the sidecar lock.
2. Read the legacy Sidecar.
3. Write the original bytes to `<sidecar>.bak`.
4. Rewrite `<sidecar>` with version `2`, one placeholder in `html`, and
   migrated `editor` / `parsedCache` values under
   `extras.blocks.<block_id>`.

That implementation explains legacy `.bak`, `.lock`, and `.corrupt-*` files a
user may still have. It has been removed. Current attachment inspection and
recovery create none of them and preserve every existing family member
byte-for-byte. `DOXMIND_SIDECAR_MIGRATE` has no current runtime caller and
setting it has no effect; ADR-0003 is retained only as a history of the retired
behavior.

### Release Validation Fixtures

The release compatibility fixtures live in
[`tests/fixtures/sidecar_compat`](../tests/fixtures/sidecar_compat):

- `pdf_legacy.doxmind.json`
- `excel_legacy.doxmind.json`
- `pdf_markdown_shape.doxmind.json`
- `excel_markdown_shape.doxmind.json`

Release validation covers the zero-write boundary in the frontend adapter and
recovery-report tests, Electron native-workspace tests, and Python Markdown-only
workspace tests. These checks prove
that recovery returns exact editor JSON while the source, Sidecar, `.bak`,
`.lock`, and `.corrupt-*` family remains unchanged and no new `.bak` appears.

Any compatibility change that touches Synthetic Documents must preserve all
four fixture forms. A change that creates this shape for a new Attachment, adds
a writer, or restores a PDF/Excel editor command is a contract regression unless
a new ADR replaces ADR-0011.

## Block Placeholder Grammar

An External-reference Custom Block is represented in markdown by one single-line
HTML comment:

```text
<!-- {block_type} id="{uuid_v4_or_legacy_id}" src="{relative_path}" [{attr}="{value}"]* -->
```

The historical canonical order was:

```text
<!-- {block_type} id={uuid_v4_or_legacy_id} src={relative_path} [{attr}={value}]* -->
```

`id` appears before `src`, and any additional attributes follow `src`.
Read-only recovery parsers may recognize this historical form but must never
serialize it into a new Attachment Sidecar.

Example:

```text
<!-- pdf-block id="1a2b3c4d-1111-4aaa-8bbb-123456789abc" src="assets/spec.pdf" -->
```

Rules:

- `block_type` is one of the strings in the vocabulary table below.
- `id` is a non-empty stable block id generated when the block is inserted. It
  is immutable for the lifetime of that block instance, including when `src`
  changes.
- `src` is a workspace-scoped relative path to the referenced user file. Older
  writers used paths relative to the owning Document or Synthetic Document.
- Additional attributes are optional extension points. They follow HTML
  attribute syntax and must be single-line `name="value"` pairs. This document
  defines no additional attribute semantics beyond `id` and `src`.
- The placeholder is doXmind internal state, not user-facing document content.
- Multi-line placeholder comments are invalid.

Canonical extraction form:

```text
<!--\s*(?P<block_type>pdf-block|excel-block)\s+id="(?P<id>[^"]+)"\s+src="(?P<src>[^"]+)"(?P<attrs>.*?)\s*-->
```

Read-only recovery implementations may use language-specific regexes or an HTML
attribute parser, but they must recognize this historical form equivalently.

## Historical Block Type Vocabulary

| `block_type`                      | Historical category | Historical state location | Current handling                                   |
| --------------------------------- | ------------------- | ------------------------- | -------------------------------------------------- |
| `pdf-block`                       | External reference  | `extras.blocks.<id>`      | Zero-write attachment recovery only                |
| `excel-block`                     | External reference  | `extras.blocks.<id>`      | Zero-write attachment recovery only                |
| `mermaid`, `callout`, `math`      | Self-contained      | None                      | Native Markdown/source rendering; no Sidecar state |
| `toggle`, `page-link`, `database` | Historical custom   | Shape-dependent           | Raw Markdown + byte-exact Page recovery report     |

Self-contained syntax lives entirely in Markdown. Historical Sidecar `html` may
contain a cached rendering, but current Page behavior does not read it.
PAGELEG-1 preserves deprecated `database` payload bytes in an explicit report.
Migration into portable Page collections remains future work and does not
justify restoring a Sidecar reader, writer, or DatabaseBlock UI.

## Renderer Invisibility

Block placeholders are HTML comments. They must remain invisible in the
explicit Python HTML-export projection in `services/markdown_export.py`. The
regression test in `test_sidecar_format.py` asserts that rendered HTML keeps the
comment as a standalone block-level node, not nested inside `<p>` or any other
element. The native editor renderer has its own source-backed fixtures.

Invisibility under GitHub-rendered markdown and pandoc export is a design
invariant of the placeholder grammar — single-line HTML comments are dropped by
both renderers — but it is **not** verified by CI. It is verified by inspection
only. If a new External-reference block type proposes a placeholder shape that
strays from the single-line HTML-comment grammar, the burden is on the proposer
to re-confirm that shape is invisible in GitHub and pandoc output before the
spec is updated.

This was the historical External-reference contract: the placeholder preserved
id/src correlation without displaying placeholder text to readers. No new
External-reference Sidecar block type may be added.

## Extension Notes

Do not add a new External-reference Sidecar block type. For a new portable
Markdown block type:

- Define a visible, lossless Markdown grammar.
- Add exact-source parser/serializer and block-command fixtures to
  `MarkdownBlockDocument`.
- Add the native UI Adapter only after unsupported source can be preserved.
- Keep all user semantics in Markdown/frontmatter; never add an Extras slot.
