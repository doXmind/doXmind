# GUI Preflight Test Design

GUI preflight is the fast, local confidence suite for doXmind's desktop
shell. It protects the Markdown Page workflow, Attachment navigation, and
legacy PDF/Excel recovery until that compatibility bridge is retired.

Run it with:

```bash
npm run preflight:gui
```

## Goals

- Catch broken first-run, workspace, and document-routing flows before slower manual testing.
- Cover the primary Markdown Page workflow and safe handling of Attachments.
- Exercise behavior through accessible UI surfaces and store state, not through private implementation details.
- Keep the suite deterministic enough to run on every local branch and in CI.
- Protect the local sidecar edition from accidental cloud/auth/AI UI surfaces.

## Current Coverage

The first GUI preflight lives in `src/__tests__/preflight/gui-preflight.test.tsx` and covers the editor shell:

- First-run state renders the welcome surface without the file sidebar.
- Opened folder with no selected file keeps the file tree and workspace home visible.
- Selected document shows a loading placeholder until content hydration completes.
- Hydrated Markdown Pages route into the editor; PDF, spreadsheet, and HTML
  files route into the generic read-only Attachment surface.
- Markdown headings expose the collapsed outline rail and reserve editor gutter space.
- A Markdown preflight fixture contains every supported user-facing block:
  text, headings 1-6, quote, bullet/ordered/task lists, divider, table, image,
  code block, 2/3/4-column layouts, table of contents, web bookmark, PDF/Excel
  legacy external-reference blocks, mermaid, callout, inline math, block math,
  toggle, and page link.
- Attachment scenarios prove that PDF and spreadsheet files expose Open
  Externally and Reveal without editor or Page-export controls.
- Focus mode hides header/sidebar chrome and can be exited from the hover control.

This intentionally mocks the heavy TipTap engine and native Attachment actions
while preserving the real `DocumentWorkspace` routing boundary. Legacy
recovery keeps focused detection/export tests until that bridge is retired.

The all-block fixture is tied to `CustomBlockExtensions`: adding a registry block without adding a GUI preflight fixture should fail `npm run preflight:gui`.

## Expansion Matrix

Add scenarios to preflight when they cross multiple UI boundaries or represent a release-blocking happy path.

| Area            | Scenario                                                                                           | Assertion style                                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| First run       | New untitled Page, open folder unavailable in browser, recent file/workspace reopen                | User clicks visible controls; assert selected state and notification text                                                          |
| Workspace       | Create Page/folder/template, open settings, collapse folders                                       | Assert Page creation uses the Markdown path and no PDF/Excel creation action exists                                                |
| Markdown editor | Research note with every block type, then later type/slash/format/save                             | Assert all block fixtures load through the editor route; assert resulting document HTML/Markdown and save payload in focused tests |
| Custom blocks   | Callout, toggle, inline math, block math, Mermaid, Page link, plus legacy PDF/Excel fixtures       | Assert portable blocks round-trip; legacy placeholders remain recoverable                                                          |
| Core blocks     | Text, headings 1-6, quote, divider, bullet list, ordered list, task list, table, image, code block | Assert visible shell loading and minimal HTML fixture presence                                                                     |
| Legacy workbook | Detect existing edit state and export it without changing recovery evidence                        | Assert recovery output plus unchanged source, sidecar, `.bak`, `.lock`, and `.corrupt-*`                                           |
| Legacy PDF      | Detect existing annotation state and export it without changing recovery evidence                  | Assert recovery output plus unchanged source, sidecar, `.bak`, `.lock`, and `.corrupt-*`                                           |
| Collections     | Query Pages by frontmatter and switch views                                                        | Assert rows remain Markdown Pages and survive sidecar/index deletion                                                               |
| Layout blocks   | 2-column, 3-column, and 4-column layouts, table of contents, web bookmark                          | Assert fixture presence and later add focused interaction coverage                                                                 |
| Attachments     | Open PDF/spreadsheet/HTML, reveal, open externally                                                 | Assert no editable document toolbar and no new sidecar write                                                                       |
| Settings        | Theme, typography, workspace settings                                                              | Assert local settings state and immediately visible UI changes                                                                     |
| Safety rails    | No sign-in, provider, telemetry, billing, or sharing entry points                                  | Assert forbidden labels are absent from shell surfaces                                                                             |

## Test Rules

- Prefer role/name queries such as `getByRole("button", { name: /new/i })`.
- Use `data-testid` only for structural shell elements that do not have stable accessible names.
- Mock expensive editor engines at preflight level; test their internals in focused component/unit suites.
- Assert user-visible outcomes, persisted state, or command payloads. Avoid CSS class snapshots.
- Keep each scenario under one second. If it needs real browser rendering, move it to a future Playwright/Tauri smoke suite.

## Release Gate

Minimum automated release preflight:

```bash
npm run preflight:gui
npm run preflight:excel
npm run type-check
npm run test:ci
npm run lint
(cd server && .venv/bin/python -m pytest)
(cd server && .venv/bin/python -m ruff check .)
cargo test --workspace
```

The GUI preflight mocks TipTap and native Attachment actions, so it is not a
packaged-app release gate by itself. Before publishing a signed/notarized build,
install the exact candidate package on a macOS test account and record a manual
smoke run that proves:

1. Every New menu creates only a Page, Folder, or Page from Template; no blank
   PDF or workbook action is present.
2. A Markdown Page can be created, edited, saved, closed, and reopened from its
   real `.md` file.
3. PDF, XLSX/XLSM/CSV, and HTML open in the shared read-only Attachment surface.
   **Open Externally** and **Reveal** work, editor/save controls are absent, and
   opening an ordinary Attachment creates no sidecar.
4. Real legacy fixtures cover main-sidecar-only, backup-only, and differing
   main/backup recovery. Every successful attempt creates a new unverified copy.
5. Unsupported or `unknown` state refuses recovery and gives preservation
   guidance. Before and after each case, record hashes, mtimes, and directory
   membership for the source, main sidecar, every `.bak`, `.lock`, and
   `.corrupt-*` artifact.
6. The exact older fallback build, download URL, and checksum in the 1.8.0
   release notes have been validated against an isolated evidence copy. A
   **Pending release validation** entry blocks publication; it must never be
   presented to users as a verified fallback.

## Next Steps

1. Add workspace creation preflight coverage around `FilesSidebar` and `WorkspaceHome`.
2. Add a focused Markdown editor workflow test for typing, slash insertion, and save payload.
3. Add packaged GUI automation for legacy PDF/Excel recovery; focused tests
   already protect the zero-write exporter contract.
4. Add safety-rail assertions that removed cloud/auth/AI labels do not reappear in the desktop shell.
5. Consider a separate `preflight:browser` later if Playwright becomes a direct dev dependency.
