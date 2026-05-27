# GUI Preflight Test Design

GUI preflight is the fast, local confidence suite for doXmind Mini's desktop editor shell. It models user-visible workflows across Markdown, Excel, and PDF documents that must never regress before a release or before touching shared UI state.

Run it with:

```bash
npm run preflight:gui
```

## Goals

- Catch broken first-run, workspace, and document-routing flows before slower manual testing.
- Cover realistic user scenarios for every supported document type: Markdown, Excel, and PDF.
- Exercise behavior through accessible UI surfaces and store state, not through private implementation details.
- Keep the suite deterministic enough to run on every local branch and in CI.
- Protect the local sidecar edition from accidental cloud/auth/AI UI surfaces.

## Current Coverage

The first GUI preflight lives in `src/__tests__/preflight/gui-preflight.test.tsx` and covers the editor shell:

- First-run state renders the welcome surface without the file sidebar.
- Opened folder with no selected file keeps the file tree and workspace home visible.
- Selected document shows a loading placeholder until content hydration completes.
- Hydrated Markdown, PDF, and Excel files route into the document workspace.
- Markdown headings expose the collapsed outline rail and reserve editor gutter space.
- A Markdown preflight fixture contains every supported user-facing block:
  text, headings 1-6, quote, bullet/ordered/task lists, divider, table, image,
  code block, 2/3/4-column layouts, table of contents, web bookmark, database
  table/board/gallery/list placeholders, PDF/Excel external-reference blocks,
  mermaid, callout, inline math, block math, toggle, and page link.
- An Excel finance-review scenario opens a budget workbook, verifies workbook
  grid context, formats currency, enables filters, adds a finance comment,
  freezes the top row, and keeps export available.
- A PDF contract-review scenario opens a multi-page contract, navigates pages,
  adds approval text, highlights a clause, and keeps edited PDF export available.
- Focus mode hides header/sidebar chrome and can be exited from the hover control.

This intentionally mocks the heavy TipTap/PDF/Excel rendering engines while preserving the real `DocumentWorkspace` routing boundary. The preflight target here is GUI routing plus realistic workflow affordances; domain-specific editors keep their own focused rendering/export tests.

The all-block fixture is tied to `CustomBlockExtensions`: adding a registry block without adding a GUI preflight fixture should fail `npm run preflight:gui`.

## Expansion Matrix

Add scenarios to preflight when they cross multiple UI boundaries or represent a release-blocking happy path.

| Area            | Scenario                                                                                           | Assertion style                                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| First run       | Start writing, open folder unavailable in browser, recent file/workspace reopen                    | User clicks visible controls; assert selected state and notification text                                                          |
| Workspace       | Create Markdown/PDF/Excel, create folder, open settings, collapse folders                          | Assert commands/stores receive the expected local paths and document types                                                         |
| Markdown editor | Research note with every block type, then later type/slash/format/save                             | Assert all block fixtures load through the editor route; assert resulting document HTML/Markdown and save payload in focused tests |
| Custom blocks   | PDF block, Excel block, callout, toggle, inline math, block math, mermaid, page link               | Assert rendered block affordances and serialized HTML attributes                                                                   |
| Core blocks     | Text, headings 1-6, quote, divider, bullet list, ordered list, task list, table, image, code block | Assert visible shell loading and minimal HTML fixture presence                                                                     |
| Excel workbook  | Finance review, analyst cleanup, heavy edit/export                                                 | Assert grid context, toolbar affordances, filter/comment/freeze/format state, and backend `preflight:excel` exported XLSX truth    |
| PDF editor      | Contract review, page navigation, free text, highlight, export                                     | Assert page status, annotation affordances, review state, and export action availability                                           |
| Database block  | Create table, edit cell, filter/sort, switch view                                                  | Assert visible rows/cells and `extras.databases`-ready state shape                                                                 |
| Layout blocks   | 2-column, 3-column, and 4-column layouts, table of contents, web bookmark                          | Assert fixture presence and later add focused interaction coverage                                                                 |
| PDF editor      | Open PDF, annotate or edit, export                                                                 | Assert page workspace state and export payload, not canvas pixels in jsdom                                                         |
| Excel editor    | Open workbook, edit cell, format, filter/sort, export                                              | Prefer backend `preflight:excel` for exported XLSX truth; add GUI tests for toolbar flow                                           |
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
3. Add direct Excel GUI preflight coverage for find/replace, validation lists, sheet rename/duplicate/delete, and workbook export events.
4. Add direct PDF GUI preflight coverage for paragraph edits, deletion/redaction, style toolbar changes, and export payload shape.
5. Add safety-rail assertions that removed cloud/auth/AI labels do not reappear in the desktop shell.
6. Consider a separate `preflight:browser` later if Playwright becomes a direct dev dependency.
