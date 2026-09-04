# doXmind User Guide

doXmind is a fully local, Markdown-native knowledge workspace. A Page is one ordinary `.md` or `.markdown` file, and every Page uses the native source-backed block editor. PDF, spreadsheet, and HTML files are read-only Attachments.

The packaged Electron app executes filesystem commands inside the desktop process. It does not start or bundle Python/FastAPI. Python is optional and limited to browser development, CLI/MCP, and import/conversion tooling.

For source installation and developer commands, see the [project README](../README.md).

For the historical 1.8.0 transition, upgrade precautions, and verified fallback
record, see the [1.8.0 release notes](releases/1.8.0.md). The current product
boundary and legacy-sidecar behavior in this guide supersede that
transition-state implementation where they differ.

## 1. Install and launch

The public release channel currently provides a macOS package for Apple silicon. There is no public Windows or Linux installer in the current release channel.

1. Open [doXmind Releases](https://github.com/doXmind/releases/releases/latest).
2. Download the `.dmg` file.
3. Drag doXmind to Applications, then open it.

The desktop app does not require an account, API key, Python runtime, cloud workspace, or hosted parser. Documents remain in folders you control. Replaceable preferences and recent-item state stay in the desktop WebView's local application profile; rebuildable indexes and optional Python-tooling metadata may use app-private data under `~/.doxmind`.

## 2. Open a folder, file, or new Page

### Open a folder

Use **File → Open Folder…** (`Cmd/Ctrl+Shift+O`) when related documents belong together.

- The selected folder becomes the workspace root.
- The sidebar reflects supported Pages, Attachments, and subfolders under that root.
- New Pages are written directly into the workspace.
- Documents open in tabs in the same window.

<p align="center">
  <img src="readme/doxmind-overview.png" width="1200" alt="A doXmind folder workspace with local documents in the sidebar" />
</p>

### Open one file

Use **File → Open File…** (`Cmd/Ctrl+Alt+O`), double-click a registered document, or choose **Open With → doXmind** to work with one standalone supported file.

- doXmind opens that file without scanning or displaying its siblings.
- Closing the standalone document returns to the welcome screen.
- A Markdown Page is editable. A supported non-Markdown file opens as a read-only Attachment.

### Start a new Page

Choose **Start writing** on the welcome screen to create an untitled Markdown buffer. It remains in memory until the first save asks for a destination.

When a folder is open, **File → New Page** (`Cmd/Ctrl+N`) creates a real Markdown file inside that workspace. The New menu also offers folders and Markdown templates; it does not create blank PDFs or workbooks.

### Recent items and drag-and-drop

- The welcome screen lists recent standalone files and workspace folders.
- Drag a folder onto the welcome screen to mount it as a workspace.
- Drag a supported standalone file onto the welcome screen to open it.
- Drag a supported external file into an open workspace to copy it there.

## 3. Import files into a workspace

External drag import accepts exactly `.md` and `.markdown`. Anything else is refused with "Only .md and .markdown are supported" and is never copied.

Import copies the file into the chosen workspace folder and leaves the external source unchanged. When the name already exists, choose **Replace**, **Keep both**, or **Skip**.

`.pdf`, `.xlsx`, `.xlsm`, `.csv`, `.html`, and `.htm` files that are already inside an opened folder show up as read-only Attachments, but none of them can be dragged in from outside.

DOCX and PPTX are not Pages, stable workspace imports, or supported inputs to the current conversion tools. Optional standalone Python tooling can parse explicitly selected PDF and spreadsheet sources read-only; that tooling is separate from the packaged desktop app and never changes the original source implicitly.

## 4. Manage a workspace

The sidebar is a direct view of the selected folder.

- Click a Page or Attachment to open it in a tab.
- Drag items within the sidebar to move them inside the workspace.
- Rename from the context menu; doXmind preserves the document extension.
- Use **File → Reveal in Finder** (`Cmd/Ctrl+Alt+R`) to locate the active source.
- Use `Cmd/Ctrl+Tab` for the quick file switcher.
- Use `Cmd/Ctrl+B` to show or hide the sidebar.
- Use `F11` for focus mode; press `Esc` or `F11` again to leave it.

Page and Folder relocation first scans the complete workspace Page snapshot and
shows the planned exact link repairs plus any warnings. Approval submits one
revision-checked transaction that moves the source and unchanged Legacy Sidecar
family together with the repairs. An external change or write failure aborts or
rolls back the transaction; ambiguous and unsafe targets are reported rather
than guessed.

Deleting through doXmind sends the source to the operating system Trash/Recycle Bin. Existing hidden legacy sidecar files move to Trash with it; doXmind has no separate in-app Trash.

To restore a deleted item, put the source and any legacy sidecar family back from the system Trash. On macOS, press `Cmd+Shift+.` in Finder or Trash to show hidden files.

## 5. Edit a Markdown Page

Every `.md` and `.markdown` Page opens in the same native source-backed editor. There is no TipTap compatibility editor or hidden HTML document model.

<p align="center">
  <img src="readme/doxmind-editor.png" width="1200" alt="The doXmind native Markdown block editor" />
</p>

### Source-backed blocks

The editor recognizes these Markdown structures as blocks:

- Paragraphs and ATX headings
- Bulleted, numbered, and task-list items
- Block quotes and callouts
- Thematic dividers
- Tables
- Fenced code and Mermaid diagrams
- Block math
- Portable `<details>` Toggles
- Read-only `doxmind-collection` Table, Board, and Calendar views
- Standalone relative local Markdown images
- Standalone Wiki embed paragraphs

Select a Block to edit its canonical Markdown. Safe whole-Block move, duplicate, and delete work for native and raw structures. Use `Alt+ArrowUp/ArrowDown` to move the active Block, `Cmd/Ctrl+Shift+D` to duplicate it, and `Cmd/Ctrl+Shift+Backspace` (or Delete) to remove it. At the beginning or end of an active Block, unmodified Up/Down moves into the neighboring Block. Supported text and list Blocks additionally allow split, merge, common kind changes, and task toggles; controls that could corrupt raw or complex grammar remain disabled. Multi-Block plain-text paste preserves the clipboard's exact line endings and is one undo step. Undo and redo operate on Markdown changes. Tables, code, math, Mermaid, callouts, and other source-only structures remain directly editable without a second document model.

If syntax is unfamiliar or too complex for a semantic control, doXmind keeps it as an editable raw Markdown block. It does not discard or normalize that source merely because the UI does not understand it.

Type `/` as the complete text of an active paragraph to open the native slash-command menu. It can replace that paragraph with portable Markdown for text, headings, lists, tasks, quotes, Toggles, callouts, dividers, code, tables, Collections, equations, Mermaid, Wiki Links, and Page embeds. Filter by typing after `/`, use the arrow keys to select, and press Enter. The command inserts source; it does not create a hidden Block record.

A Toggle is ordinary portable HTML-with-Markdown source:

```html
<details>
  <summary>Toggle title</summary>

  Markdown inside the Toggle.
</details>
```

Nested and fenced content is source-parsed without a private Toggle schema. Open/closed state is represented by the standard `open` attribute. Activate the Block to edit its original source.

### Properties

Open **Properties** in the Page context bar to edit aliases and custom fields. Custom property names start with a letter or underscore and may contain letters, digits, `_`, `.`, or `-`. Values are limited to portable YAML strings, finite numbers, checkboxes/booleans, and string lists. A **Relation** uses that same string-list grammar: selecting other workspace Pages writes exact extension-free Wiki Link targets into frontmatter, for example:

```yaml
---
status: active
owners:
  - "[[People/Ada]]"
  - "[[People/Grace]]"
---
```

Relation source accepts one exact `[[Page]]` string or an array of them. Labels and heading/block fragments are not relation values. Resolution uses the local Page path, title, or alias; missing or ambiguous targets remain explicit and are never guessed.

The editor saves the Page body first, then applies one revision-checked minimal frontmatter patch. It preserves unrelated keys, comments, BOM, line endings, and body bytes. Identity and other system fields are not editable custom properties; nested objects, mixed arrays, and other YAML shapes remain preserved source but are not projected into the v1 property UI.

### Daily Notes

Choose **Today's Daily Note** from the workspace home or command palette. doXmind uses the machine's local calendar date and opens or creates the ordinary Page `Daily Notes/YYYY-MM-DD.md`. It saves any dirty current Page before navigating. Daily Notes have no private record, journal database, or sidecar.

### Page Collections

A Collection is a strict fenced JSON definition inside any Page. Rows, cards, and events are ordinary Markdown Pages selected from the current workspace catalog. Version 1 Table definitions remain supported; version 2 adds Table, Board, and Calendar views plus optional computed properties. A definition is written by hand inside the fence — the slash menu no longer inserts a starter for one.

For example, a project may carry only portable source properties:

```yaml
---
type: project
status: active
tasks:
  - "[[Tasks/A]]"
  - "[[Tasks/B]]"
---
```

If `Tasks/A.md` and `Tasks/B.md` each have a numeric `points` field, this version 2 Table resolves `tasks`, sums those target values, and derives a label without writing any result back to a Page:

````markdown
```doxmind-collection
{
  "version": 2,
  "view": "table",
  "computed": {
    "version": 1,
    "properties": {
      "tasks": { "type": "relation" },
      "total": {
        "type": "rollup",
        "relation": "tasks",
        "property": "points",
        "calculate": "sum"
      },
      "label": {
        "type": "formula",
        "expression": {
          "type": "concat",
          "values": [
            { "type": "literal", "value": "Points: " },
            { "type": "property", "name": "total" }
          ]
        }
      }
    }
  },
  "filters": [
    { "property": "type", "operator": "equals", "value": "project" }
  ],
  "columns": ["status", "tasks", "total", "label"],
  "sort": [{ "property": "total", "direction": "desc" }]
}
```
````

Every definition has `filters`, `columns`, and `sort`. Filters use AND semantics and support `equals`, `contains`, and `exists`; sorting is deterministic and keeps missing values last. A version 2 Board additionally requires `"groupBy": "status"`; a Calendar requires `"dateBy": "due"`. Board values become deterministic columns with a final **Missing** column. Calendar accepts real `YYYY-MM-DD` strings and puts missing or invalid dates in **Unscheduled**.

The optional `computed` object has its own strict version 1 grammar:

- `relation` resolves the same-named source frontmatter field, which must contain exact Wiki Link string(s).
- `formula` is data, not code. Its JSON AST supports `literal`, `property`, arithmetic (`+ - * / %`), comparisons, boolean `and`/`or`/`not`, `concat`, and lazy `if` expressions. No string is evaluated as JavaScript; a definition is capped at 64 levels and 1,000 AST nodes.
- `rollup` names a declared relation and a target property, then applies `count`, numeric `sum`/`min`/`max`, or string `join`/`unique`.

Derived values can be used by filters, sort, displayed columns, Board `groupBy`, and Calendar `dateBy`. Resolved relation targets are navigable. Unknown schema keys, dependency cycles, type mismatches, unresolved/ambiguous relations, and unsafe operations produce deterministic diagnostics instead of guessed or partially persisted values. The source fence remains directly editable and no Collection result is stored in a sidecar, cache, or Page frontmatter.

### Local images

A standalone image such as `![Diagram](../assets/diagram.png)` previews an existing local image relative to the containing Page. doXmind does not fetch remote, `data:`, `file:`, absolute, query/fragment, workspace-escaping, or symlinked destinations. The desktop/browser-dev read command confines the asset to the workspace, limits it to 20 MiB, checks the raster signature, and returns bytes that the UI displays through a temporary in-memory Blob URL.

In the packaged Electron editor, paste image files from the clipboard or drop them onto an editable text/list Block. doXmind accepts APNG, AVIF, BMP, GIF, ICO, JPEG, PNG, and WebP files between 1 byte and 20 MiB, verifies their bytes, and copies them into the workspace `assets/` folder. It never overwrites an existing asset: a collision becomes `name (2).ext`, then the next available suffix. The editor inserts the shortest URI-encoded relative `![name](path)` reference into the Page, preserving its line-ending style. An unsaved Page must first be saved inside a workspace. Browser development exposes read-only preview but not this Electron asset-import writer.

Resize, crop, deletion, remote-image fetching, and binary image editing are not implemented. An unsupported or unsafe image reference remains editable source rather than triggering a network request.

### Find, outline, and Wiki Links

- `Cmd/Ctrl+F` searches inside the active Page.
- The outline rail lists headings and jumps to the selected section.
- `Cmd/Ctrl+P` opens the command palette, and `Cmd/Ctrl+O` the quick switcher.
- `Cmd/Ctrl+Shift+?` opens the shortcut reference.
- Clicking an unambiguous `[[Wiki Link]]` opens the corresponding local Markdown Page.
- A standalone `![[Page]]` or `![[Page#Heading]]` paragraph previews that Page or its unique ATX heading section recursively and read-only. Path, title, and alias can resolve a target; `|label` changes only the displayed label.
- A source Block can end with an Obsidian-compatible anchor such as `Requirements text. ^requirements`. A standalone `![[Spec#^requirements]]` embeds the unique matching Block without rewriting the target Page. Portable ids start with an ASCII letter or digit and continue with letters, digits, `_`, or `-`; anchors inside fenced code, Mermaid, or block math are not candidates. Missing or duplicate ids fail closed.
- Activate any embed Block to edit its original expression. Ambiguous or missing targets/fragments, cycles, and depth limits stay explicit instead of guessing.

### Save and external edits

Autosave writes after a short pause. `Cmd/Ctrl+S` saves immediately.

Save atomically writes only the Page's `.md`/`.markdown` file. It does not create or update a `.doxmind` sidecar. Authored `^block-id` anchors remain ordinary Markdown source; session block ids, selections, undo history, previews, and rendered HTML are temporary or derived state.

The storage layer reads the complete raw file, separates frontmatter from the Markdown body, and gives the body to the native Block editor. Opening a file does not modify it merely because it lacks a frontmatter id. Unknown frontmatter and untouched body source remain preserved when a supported edit patches another span.

You can edit the same file in another application. If the on-disk revision changes while doXmind holds an older revision, the app stops the stale write instead of silently overwriting the external change. Reload/reopen the Page, review the external edit, and then continue.

## 6. Copy the complete Markdown source or export a Page to PDF

Open **More actions (⋯)** in a Page's top bar:

- **Copy Markdown Source** saves live edits, asks for a new `.md`/`.markdown` destination, and copies the complete Page bytes—including BOM, frontmatter, comments, original line endings, and trailing newlines. It refuses to overwrite an existing destination.
- **Export as PDF** asks for a local destination and generates a `.pdf` file directly inside Electron.

PDF export waits for recursive embeds, local images, fonts, math, and Mermaid previews to leave their loading state, then uses the native Block view already derived from canonical Markdown. Electron generates the PDF bytes without a printer or driver and atomically writes the destination chosen in the Save dialog. No Markdown, HTML, or PDF bytes are sent to FastAPI or another service, and there is no separate local PDF-export server.

Cancelling the Save dialog writes nothing. A successful export has a definite destination and does not modify the Markdown Page or create a sidecar.

The Page file itself remains the portable source. Word export is not available.

## 7. Work with read-only Attachments

PDF, Excel-family, CSV, and HTML files are Attachments. Opening one shows a read-only attachment card with:

- **Open externally** — launches the file in its normal desktop application.
- **Reveal** — locates the source in Finder or the platform file manager.

doXmind does not expose its former PDF annotation editor or spreadsheet grid. It does not save PDF annotations, workbook cells, formulas, or formatting, and it never creates new attachment sidecars.

Those editor bundles and their attachment create/write/cache and migration paths have been removed, not merely hidden. Optional CLI/MCP tools may parse a PDF or workbook read-only for conversion, but they cannot reopen the retired editor or write its state.

Use Preview/Acrobat for PDFs, Excel/Numbers/LibreOffice for workbooks and CSV files, and a browser or text editor for HTML.

## 8. Understand legacy sidecar files

Current Pages and new Attachments do not need or receive sidecars. Older builds may have left files such as:

| Source document       | Legacy sidecar                 |
| --------------------- | ------------------------------ |
| `Project Plan.md`     | `.Project Plan.doxmind`        |
| `Research Report.pdf` | `.Research Report.pdf.doxmind` |
| `Quarterly Plan.xlsx` | `.Quarterly Plan.xlsx.doxmind` |

A sidecar family may also contain:

- `<sidecar>.bak` — an earlier backup
- `<sidecar>.lock` — a tiny coordination file that may persist
- `<sidecar>.corrupt-*` — preserved evidence from a failed/corrupt migration

doXmind never opens these files. If one holds old edits you still need, read its JSON outside doXmind. Do not manually delete any of them while those edits may matter: within a workspace, rename and move operations carry the existing family with the source, and deletion sends both to system Trash. Normal Page and Attachment operations preserve these bytes and do not create replacements.

## 9. Settings

Open **doXmind → Settings…** (`Cmd/Ctrl+,`) or select **Settings** at the bottom of the sidebar.

<p align="center">
  <img src="readme/doxmind-settings.png" width="1200" alt="doXmind Settings with Appearance, Typography, and About sections" />
</p>

The current settings surface contains:

- **Appearance** — Light, Dark, or System mode, preferred themes, and the
  interface language
- **Typography** — editor font and reading-rhythm preferences
- **Hotkeys** — every command in the app, each one rebindable
- **Workspace** — folders to leave out of the sidebar and out of search
- **About** — app version, build/channel information, privacy notes, acknowledgements, and project information

Settings stay local on the device.

## 10. Keyboard shortcuts

The current public desktop release is for macOS, where shortcuts use `Cmd`. Browser development and compatibility builds on other platforms use `Ctrl` unless shown otherwise.

| Action                        | Shortcut                          |
| ----------------------------- | --------------------------------- |
| New Page in an open workspace | `Cmd/Ctrl+N`                      |
| New window                    | `Cmd/Ctrl+Shift+N`                |
| Open file                     | `Cmd/Ctrl+Alt+O`                  |
| Open folder                   | `Cmd/Ctrl+Shift+O`                |
| Save                          | `Cmd/Ctrl+S`                      |
| Find in Page                  | `Cmd/Ctrl+F`                      |
| Command palette               | `Cmd/Ctrl+P`                      |
| Quick switcher                | `Cmd/Ctrl+O` or `Cmd/Ctrl+Tab`    |
| Toggle sidebar                | `Cmd/Ctrl+B`                      |
| Focus mode                    | `F11`                             |
| Exit focus mode               | `Esc`                             |
| Shortcut reference            | `Cmd/Ctrl+Shift+?`                |
| Reveal active source file     | `Cmd/Ctrl+Alt+R`                  |
| Move active Block             | `Alt+ArrowUp/Down`                |
| Duplicate active Block        | `Cmd/Ctrl+Shift+D`                |
| Delete active Block           | `Cmd/Ctrl+Shift+Backspace/Delete` |

Standard undo, redo, cut, copy, paste, and select-all shortcuts work in the active Markdown block.

## 11. Limits and troubleshooting

### A file does not appear in a workspace

- Confirm it is a Markdown Page or a supported local Attachment.
- Refresh or reopen the folder after changing files outside doXmind.
- External drag import accepts only `.md`, `.markdown`, `.pdf`, `.xlsx`, and `.csv`.
- HTML must already be present in the opened folder; DOCX and PPTX are not stable workspace documents.

### I cannot edit a PDF, workbook, CSV, or HTML file

That is intentional. These formats are read-only Attachments. Use **Open externally** to edit the source in its normal application. doXmind will not write a new sidecar.

### The old PDF/Excel editor is missing

It has been physically removed. A legacy sidecar holding old edit state is left untouched on disk; read its JSON outside doXmind if you still need it.

### Export as PDF did not create a file

Choose **Export as PDF**, select a writable destination, and complete the Save dialog. Cancelling creates no file. If generation fails, the app leaves any existing destination intact and reports the failure; no printer configuration is required.

### A Page changed in another editor

doXmind rejects a save based on a stale source revision. Reload/reopen the Page, review the external change, and then continue editing. The app does not use a sidecar hash as a conflict authority.

### I want the contents of an old hidden sidecar

doXmind does not read or export them. A sidecar is a JSON file: open it in a text editor. Keep the source and all hidden `.doxmind`, `.bak`, `.lock`, and `.corrupt-*` files unchanged until you are certain you no longer need them.

## 12. Privacy and optional tooling

Normal Page editing, local search, PDF generation, and Attachment handling remain on the machine. The packaged Electron build uses in-process filesystem commands and does not launch Python/FastAPI.

The app has no built-in cloud account, telemetry, AI runtime, or remote content-unfurl service. Packaged builds may contact the release service for update checks.

Advanced users can separately run the browser-development FastAPI mirror, the local `doxmind` CLI, import/conversion tools, or `doxmind-mcp`. Those optional Python surfaces operate independently of the desktop app. See [CLI & MCP](cli-and-mcp.md). Avoid editing the same Page concurrently from multiple processes.
