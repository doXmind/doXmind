# GUI Preflight Test Design

GUI preflight is the fast, local confidence suite for doXmind Mini's desktop
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
  code block, 2/3/4-column layouts, table of contents, web bookmark, database
  table/board/gallery/list placeholders, PDF/Excel external-reference blocks,
  mermaid, callout, inline math, block math, toggle, and page link.
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
| First run       | Start writing, open folder unavailable in browser, recent file/workspace reopen                    | User clicks visible controls; assert selected state and notification text                                                          |
| Workspace       | Create Page/folder/template, open settings, collapse folders                                       | Assert Page creation uses the Markdown path and no PDF/Excel creation action exists                                                |
| Markdown editor | Research note with every block type, then later type/slash/format/save                             | Assert all block fixtures load through the editor route; assert resulting document HTML/Markdown and save payload in focused tests |
| Custom blocks   | Callout, toggle, inline math, block math, Mermaid, Page link, plus legacy PDF/Excel fixtures       | Assert portable blocks round-trip; legacy placeholders remain recoverable                                                          |
| Core blocks     | Text, headings 1-6, quote, divider, bullet list, ordered list, task list, table, image, code block | Assert visible shell loading and minimal HTML fixture presence                                                                     |
| Legacy workbook | Detect existing edit state and export it without changing source/sidecar                           | Assert recovery output plus byte-identical source and sidecar                                                                      |
| Legacy PDF      | Detect existing annotation state and export it without changing source/sidecar                     | Assert recovery output plus byte-identical source and sidecar                                                                      |
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
```

## Next Steps

1. Add workspace creation preflight coverage around `FilesSidebar` and `WorkspaceHome`.
2. Add a focused Markdown editor workflow test for typing, slash insertion, and save payload.
3. Add legacy PDF/Excel recovery coverage that proves export leaves sources and sidecars unchanged.
4. Add safety-rail assertions that removed cloud/auth/AI labels do not reappear in the desktop shell.
5. Consider a separate `preflight:browser` later if Playwright becomes a direct dev dependency.
