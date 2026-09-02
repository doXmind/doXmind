# GUI Preflight Test Design

GUI preflight is the fast, local confidence suite for doXmind's desktop shell.
It protects the native Markdown Page workflow, read-only Attachment boundary,
and local-only product surface.

Run it with:

```bash
npm run preflight:gui
```

## Goals

- Catch broken first-run, workspace, and document-routing flows before slower manual testing.
- Cover the primary Markdown Page workflow and safe handling of Attachments.
- Exercise behavior through accessible UI surfaces and store state, not through private implementation details.
- Keep the suite deterministic enough to run on every local branch and in CI.
- Protect the local desktop edition from accidental cloud/auth/AI UI surfaces.

## Current Coverage

The first GUI preflight lives in `src/__tests__/preflight/gui-preflight.test.tsx` and covers the editor shell:

- First-run state renders the welcome surface without the file sidebar.
- Opened folder with no selected file keeps the file tree and workspace home visible.
- Selected document shows a loading placeholder until content hydration completes.
- Hydrated Markdown Pages route into the editor; PDF, spreadsheet, and HTML
  files route into the generic read-only Attachment surface.
- Markdown headings expose the collapsed outline rail and reserve editor gutter space.
- Native Markdown Pages route through the source-backed Block runtime; focused
  editor tests cover lossless text/list/quote/code/table/math/Mermaid/callout
  projections, portable Toggles, slash-command source insertion, structural
  Block commands and keyboard focus/navigation, exact multi-Block paste,
  autosave, conflicts, search, outline, Wiki links, recursive Page/heading/block-id
  embeds, explicit failure states, target navigation, and PDF-export readiness.
- Focused Page Modules cover scalar/list and exact Wiki-Link relation frontmatter
  patches, local-date Daily Notes, the shared zero-write Page Catalog, read-only
  `doxmind-collection` Table/Board/Calendar views, computed relation/formula/rollup
  diagnostics, the derived Page graph, safe local-image Blob preview, and
  no-overwrite Electron paste/drop import.
- Attachment scenarios prove that PDF and spreadsheet files expose Open
  Externally and Reveal without editor or Page-export controls.
- Focus mode hides header/sidebar chrome and can be exited from the hover control.

This preflight mocks native shell actions while preserving the real
`DocumentWorkspace` and `PageEditorHost` routing boundaries. There is no TipTap
engine or custom-extension registry. New native Block kinds need focused source
round-trip tests and user-visible runtime coverage.

Cross-boundary browser acceptance lives in `tests/e2e/`. It uses a fresh local
workspace for each scenario, drives the accessible GUI with Playwright, captures
unexpected renderer errors, and reads the resulting Markdown or complete legacy
artifact family back from disk. The matrix covers Block editing and history,
Slash insertion, Properties and relations, Wiki navigation/backlinks/unlinked
mentions/graph, Daily Notes, Table/Board/Calendar collections, computed fields,
Page/heading/block embeds, local images, autosave, import conflicts, read-only
attachments, and untouched legacy artifact families.

The production-shell acceptance is `scripts/electron-gui-acceptance.mjs`. It
launches the packaged app with isolated user data and a temporary workspace, then
checks the real preload/IPC boundary, renderer sandbox, native menu delivery,
window creation and target de-duplication, Block operations, autosave, image
paste/drop, real printer-independent Page PDF generation, attachment
Open/Reveal request, focus mode, and light/dark Settings. For PDF it
controls only the Save-dialog destination, leaves `printToPDF` untouched, reads
the real file back, checks its PDF signature/pages/text, and proves the Page and
legacy artifact family stayed byte-identical. It fails on any `pageerror` or
renderer `console.error` and writes screenshots plus `report.json` under
`test-results/electron-gui-acceptance/`.

## Expansion Matrix

Add scenarios to preflight when they cross multiple UI boundaries or represent a release-blocking happy path.

| Area            | Scenario                                                                                    | Assertion style                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| First run       | Start writing, open folder unavailable in browser, recent file/workspace reopen             | User clicks visible controls; assert selected state and notification text                                                    |
| Workspace       | Create Page/folder/template, open settings, collapse folders                                | Assert Page creation uses the Markdown path and no PDF/Excel creation action exists                                          |
| Markdown editor | Research note with supported Block kinds, then type/reorder/format/save                     | Assert exact Markdown source changes, command payloads, focus stability, and save/conflict behavior                          |
| Source blocks   | Callout, block math, Mermaid, Wiki link/embed, table, code, raw unsupported syntax          | Assert semantic preview plus byte-identical untouched source; unsupported structure remains editable raw Markdown            |
| Core blocks     | Text, headings 1-6, quote, divider, bullet list, ordered list, task list, table, code block | Assert native Block projection, keyboard operations, and Markdown-only persistence                                           |
| Legacy sidecars | Open a workbook or PDF whose hidden sidecar still exists                                    | Assert the read-only card offers Open/Reveal only, and source, sidecar, timestamps, and directory members are byte-identical |
| Properties      | Edit tags, aliases, scalar/list fields, and exact Wiki-Link relations                       | Assert one revision-checked minimal frontmatter patch and byte-identical unrelated source                                    |
| Daily Notes     | Open today's note from workspace home/palette                                               | Assert local-date `Daily Notes/YYYY-MM-DD.md`, safe dirty-Page save, and no private record                                   |
| Collections     | Query Pages through Table, Board, and Calendar; derive relations/formulas/rollups           | Assert deterministic read-only Page projections, fail-closed diagnostics, and zero persistence                               |
| Knowledge graph | Open, rebuild, and navigate the active Page neighborhood                                    | Assert nodes/edges derive from resolved links with no workspace write                                                        |
| Local images    | Preview safe relative images; paste/drop a supported raster in Electron                     | Assert typed Blob revocation, confined no-overwrite asset copy, relative source insertion, and no remote request             |
| Block embeds    | Project one unique trailing `^block-id` and reject missing/duplicate/code-fence anchors     | Assert exact source projection, canonical expression preservation, recursive guards, and zero workspace writes               |
| Future blocks   | Inline math, layout syntax, image resize/crop, or another semantic extension                | Add only after a portable Markdown grammar exists; assert exact round-trip before UI coverage                                |
| Attachments     | Open PDF/spreadsheet/HTML, reveal, open externally                                          | Assert no editable document toolbar and no new sidecar write                                                                 |
| Settings        | Theme, typography, workspace settings                                                       | Assert local settings state and immediately visible UI changes                                                               |
| Safety rails    | No sign-in, provider, telemetry, billing, or sharing entry points                           | Assert forbidden labels are absent from shell surfaces                                                                       |

## Test Rules

- Prefer role/name queries such as `getByRole("button", { name: /new/i })`.
- Use `data-testid` only for structural shell elements that do not have stable accessible names.
- Mock native shell actions at preflight level; test the Block kernel in focused component/unit suites.
- Assert user-visible outcomes, persisted state, or command payloads. Avoid CSS class snapshots.
- Keep each scenario under one second. If it needs real browser rendering, move it to the Playwright or Electron smoke suite.

## Release Gate

Minimum local release preflight:

```bash
npm run preflight:gui
npm run preflight:excel
npm run type-check
```

For larger UI changes, also run:

```bash
npm run test:ci
npm run lint
npm run test:e2e
npm run electron:test-native
npm run dist:electron
npm run electron:smoke
npm run test:electron-gui
```

## Native OS Boundary

The automated Electron suite redirects only the PDF Save dialog to a temporary
test path; the packaged app still runs its real `webContents.printToPDF` and
atomic file writer. Open Externally and Reveal are intercepted at Electron's
final system-API boundary so CI never opens Finder or Preview. A macOS release
pass clicks the real Save dialog, exports a file without any configured printer,
opens that file in Preview, and visually checks traffic lights and window focus.
Windows release candidates run the same packaged suite on a Windows runner and
receive a separate native-frame spot check.

### macOS release pass — 2026-07-22

- Browser GUI acceptance: 19/19 scenarios passed with no unexpected renderer
  errors.
- Packaged Electron GUI acceptance: 19/19 checks passed with no `pageerror` or
  renderer `console.error` output.
- Packaged Electron smoke: 15/15 checks passed.
- The signed, notarized, and stapled arm64 app was opened with isolated user
  data and a temporary workspace. Its real macOS Save dialog generated a
  one-page A4 PDF (60,256 bytes) without any configured printer. Preview opened
  the file and exposed the expected heading, tasks, quote, and code; the
  workspace still contained only the original Markdown Page. Evidence is
  `real-save-dialog.pdf` and `real-save-dialog-preview.jpg`. A second real Save
  dialog was cancelled; the existing PDF SHA-256 and workspace entries remained
  unchanged.
- The final DMG was accepted by Apple notarization, stapled, and validated.
  Its blockmap and `latest-mac.yml` checksum/size were regenerated after
  stapling.
- The former system-print/no-printer check is superseded by
  [ADR-0014](adr/0014-local-page-pdf-export.md) and no longer counts as PDF
  acceptance. Current acceptance requires a real generated PDF, deterministic
  save/cancel outcomes, and byte-identical source and sidecar artifacts.

Screenshots and the packaged-run report are written under
`test-results/electron-gui-acceptance/`.
