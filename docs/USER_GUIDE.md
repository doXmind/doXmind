# doXmind User Guide

This guide covers doXmind's Markdown Page workflow and the transition of
supported PDF, spreadsheet, and HTML files into ordinary Attachments. doXmind is
local-first: Pages and attachments stay in folders you control, and replaceable
editor state is stored beside Pages in hidden `.doxmind` sidecars.

For source installation and developer commands, see the [project README](../README.md).
For the 1.8.0 behavior change, upgrade precautions, and fallback-validation
status, see the [1.8.0 release notes](releases/1.8.0.md).

## 1. Install and launch

The public release channel currently provides a macOS package for Apple silicon. There is no public Windows or Linux installer in the current release channel.

1. Open [doXmind Releases](https://github.com/doXmind/releases/releases/latest).
2. Download the `.dmg` file.
3. Drag doXmind to Applications, then open it.

Document content, parsing, exports, and sidecars stay local. doXmind also stores application metadata under `~/.doxmind`. It does not require an account, API key, cloud workspace, or hosted parser; update checks and user-requested web bookmark previews can use the internet.

## 2. Choose how to work

doXmind supports two opening modes. Pick the one that matches the task.

### Open a folder

Use **File → Open Folder…** (`Cmd/Ctrl+Shift+O`) when several related documents belong together.

- The folder becomes the workspace root.
- The sidebar shows supported documents and subfolders under that root.
- New Pages are written directly into that folder.
- Files opened inside the workspace use tabs in the same window.

<p align="center">
  <img src="readme/doxmind-overview.png" width="1200" alt="A doXmind folder workspace with local documents in the sidebar" />
</p>

### Open one file

Use **File → Open File…** (`Cmd/Ctrl+O`), double-click a registered document, or choose **Open With → doXmind** when you want one standalone file.

- doXmind opens that file without scanning or displaying its siblings.
- Its parent folder is used only for source-file and sidecar access.
- Closing the standalone document returns to the welcome screen.

### Start a new Page

Choose **Start writing** on the welcome screen to create an untitled Markdown buffer. The Page stays in memory until its first save, when doXmind asks where to put it.

When a folder is already open, **File → New Page** (`Cmd/Ctrl+N`) creates a real Markdown file inside that workspace instead.

### Recent items and drag-and-drop

- The welcome screen lists recent standalone files and workspace folders.
- Drag a folder onto the welcome screen to mount it as a workspace.
- Drag a supported document (`.md`, `.markdown`, `.pdf`, `.xlsx`, `.xlsm`, `.csv`, `.html`, or `.htm`) onto the welcome screen to open it.
- Drag an external `.md`, `.pdf`, or `.xlsx` file into an open workspace to copy it there; the original stays where it was.
- If a copied Markdown Page has the same name as an existing Page, choose whether to replace it, keep both, or skip it. For an Attachment collision, use **Keep both** or **Skip**; replace is disabled so legacy recovery evidence cannot be stranded.

## 3. Manage a workspace

The sidebar shows supported documents in the selected folder's real hierarchy;
it is not a general-purpose file browser.

### Create items

Use the **+** menu in the workspace header, or right-click a folder/empty area, to create:

- A blank Markdown Page
- A folder
- A Page from a built-in template such as Meeting Notes, Blog Post, Study Notes, or Journal

Supported PDF, spreadsheet, and HTML files already present in the folder appear
as Attachments. The current in-workspace external drop/import accepts `.pdf` and
`.xlsx`; doXmind does not create blank PDF or spreadsheet files.

### Work with files

- Click a supported document to open it in a tab.
- Use `Cmd/Ctrl+Tab` for the quick file switcher.
- Drag Pages and folders within the sidebar to move them inside the workspace.
- Rename Pages and folders from the sidebar context menu; a Page keeps its Markdown extension.
- Attachments expose **Open Externally** and **Reveal** rather than direct move,
  rename, or delete. Moving or renaming their parent folder keeps the complete
  subtree together, including sidecar, `.bak`, `.lock`, and `.corrupt-*`
  recovery evidence; deleting a folder that contains an Attachment or recovery
  evidence is blocked. Manage that set outside doXmind only after preserving a
  complete copy.
- Use **File → Reveal in Finder** (`Cmd/Ctrl+Alt+R`) to locate the active source file.
- Use `Cmd/Ctrl+B` to show or hide the sidebar.
- Use `F11` for focus mode; press `Esc` or `F11` again to leave it.

### Delete and recover

Deleting a Page sends both its Markdown source and sidecar to the operating
system Trash/Recycle Bin. They appear as separate entries. Attachment deletion
is not offered in doXmind while legacy recovery evidence may still exist.

To recover the complete Page state:

1. Open the system Trash/Recycle Bin.
2. Restore the source file.
3. Restore its hidden `.doxmind` companion to the same original folder.

On macOS, press `Cmd+Shift+.` in Finder or Trash if hidden files are not visible.
Restore legacy PDF/XLSX sidecars and every recovery artifact together with their
source. A successful recovery attempt is not a deletion signal: keep the
evidence until you have independently verified and archived what you need. A
Markdown Page can be rebuilt from its text if its sidecar is missing, although
editor-only presentation state may be lost. doXmind does not maintain a separate
in-app Trash.

## 4. Edit Markdown

Markdown files open in a rich reading surface. Click the document body or start typing to enter editing mode.

<p align="center">
  <img src="readme/doxmind-editor.png" width="1200" alt="The doXmind Markdown editor with tabs, file tree, tasks, a table, and formatted code" />
</p>

### Add content

Type `/` on an empty line to open the block menu. Available blocks include:

- Paragraphs and headings 1–6
- Bulleted, numbered, and task lists
- Quotes, callouts, dividers, and toggles
- Tables and two-to-five-column layouts
- Images, web bookmarks, page links, and page mentions
- Code blocks with syntax highlighting
- KaTeX math and Mermaid diagrams
- A table of contents

The retired DatabaseBlock is not rendered or offered for insertion. Older
`extras.databases` payloads are preserved unchanged in sidecars for manual
recovery; they are not an active collection format.

### Navigate and inspect

- `Cmd/Ctrl+F` searches inside the active document.
- The outline rail appears when a document has multiple headings; select a heading to jump to it.
- The status bar reports words, characters, and estimated reading time.
- `Cmd/Ctrl+K` opens the command palette.
- `Cmd/Ctrl+Shift+?` opens the shortcut reference.

### Save and export

Autosave is enabled by default and writes after a short pause. `Cmd/Ctrl+S` saves immediately.

Saving Markdown writes two files:

1. The portable `.md` text.
2. A hidden `.doxmind` sidecar containing lossless editor HTML and doXmind-only extras.

Open **More actions (⋯)** in the document's top bar, then choose an Export format:

- **Markdown** — creates a portable `.md` copy.
- **PDF** — renders the current Markdown through the local PDF exporter.

Depending on the format and desktop shell, the system either asks for a destination or puts the exported file in the configured Downloads folder.

Word export is not available in the current desktop edition.

### External Markdown edits

You can edit the same `.md` file in another application. When the Markdown hash no longer matches the sidecar, doXmind treats the `.md` file as newer, imports it, and regenerates rich editor state on the next save.

Avoid editing the same document simultaneously in doXmind and another writer: the last save can overwrite the other process's changes.

## 5. Recover legacy PDF edits

> PDF editing is no longer a product surface. This recovery flow only exports
> edits already stored by an older doXmind build.

Open the PDF from the sidebar or as a standalone file. It opens as a read-only
Attachment; the old PDF editor is not mounted. doXmind inspects the main legacy
sidecar and its `.bak` independently without migrating or rewriting either one.

Historical recovery is always manual and unverified. Older doXmind versions
could refresh a parsed-cache hash while preserving editor state from an earlier
file version. Immediately before an attempt, doXmind still hashes the exact PDF
bytes it will use and refuses a missing or mismatched cache hash, but a match is
not proof that the edits belong to that exact version.

If supported recovery evidence is found:

- When one recovery source is available, select **Attempt PDF recovery**.
- When the main sidecar and backup both contain different saved states,
  choose **Attempt main sidecar** or **Attempt backup**. If their recovery state is
  the same, doXmind recommends the main sidecar automatically.
- doXmind checks the cache hash, strictly applies the selected editor state to
  captured source bytes, then downloads `<name> recovered.pdf` as a new,
  unverified copy. Compare it with the original before using it.

Recovery is all-or-nothing. If the selected state cannot be matched safely to
the source PDF, no partial file is downloaded. The source PDF, main sidecar,
`.bak`, `.lock`, every `.corrupt-*` artifact, mtimes, and surrounding directory
contents remain unchanged. Keep all of those files when the recovery status
says it needs attention; that state still requires a manual recovery path.

## 6. Recover legacy workbook edits

> Spreadsheet editing is no longer a product surface. This recovery flow only
> exports edits already stored by an older doXmind build.

Open an `.xlsx`, `.xlsm`, or `.csv` workbook from a workspace or as a standalone file.
It opens as a read-only Attachment; the old workbook editor is not mounted.
Source selection follows the same main-sidecar/backup rules as PDF recovery.

Select **Attempt spreadsheet recovery** to create `<name> recovered.xlsx`.
This is also an unverified, manual attempt: the cache hash catches an obvious
mismatch but cannot prove historical editor provenance. The isolated exporter
does not invoke the legacy workbook reader, writer, migration, or cache path.

Recovery stops rather than silently dropping unsupported or unapplied state.
Missing sheets, malformed targets, a missing or mismatched cache hash, and any
mutation the exporter cannot account for fail the whole operation. In
particular, saved `filters`, `filterMode`, structural row/column/merge operations,
lossy sheet operations, or UI-only metadata may require a compatible older build
instead. Keep the source, sidecar, `.bak`, `.lock`, and every `.corrupt-*`
artifact for manual recovery.
CSV recovery also produces `.xlsx`. For an `.xlsm` source, the recovered output
is `.xlsx` and does not include macros; doXmind shows this warning before export.

If an attempt is unavailable or fails, preserve the original folder unchanged.
Do not guess which older release is compatible. The exact fallback version,
download, and checksum must first be published as **verified** in the
[1.8.0 release notes](releases/1.8.0.md). Until that entry exists, stop and keep
the evidence unchanged.

After a fallback build is verified and published:

1. Quit every running doXmind process.
2. Duplicate the attachment's containing folder into an isolated recovery
   location. Confirm the copy contains the source, main sidecar, every `.bak`,
   `.lock`, and `.corrupt-*` file before proceeding.
3. Install only the exact build and artifact whose checksum appears in the
   release notes. Do not point it at the original workspace.
4. Open the isolated copy and export recovery output to a new file. Do not allow
   the older build to migrate or repair the only copy of any evidence.
5. Compare the exported copy with the original attachment. Keep the untouched
   evidence set until the result has been independently verified and archived.

## 7. Settings

Open **doXmind → Settings…** (`Cmd/Ctrl+,`) or select **Settings** at the bottom of the sidebar.

<p align="center">
  <img src="readme/doxmind-settings.png" width="1200" alt="doXmind Settings with Appearance, Typography, and About sections" />
</p>

The current settings surface contains:

- **Appearance** — Light, Dark, or System mode and the preferred light/dark theme.
- **Typography** — editor font and reading rhythm preferences.
- **About** — app version, build/channel information, privacy notes, acknowledgements, and project information.

Settings are stored locally on the device.

## 8. Understand Pages, Attachments, and sidecars

New Markdown Pages use a companion sidecar. Older builds may also have created
legacy sidecars for PDF and spreadsheet attachments:

| Source document       | Sidecar                        |
| --------------------- | ------------------------------ |
| `Project Plan.md`     | `.Project Plan.doxmind`        |
| `Research Report.pdf` | `.Research Report.pdf.doxmind` |
| `Quarterly Plan.xlsx` | `.Quarterly Plan.xlsx.doxmind` |

Keep a source and any existing sidecar together when moving, backing up, or
restoring it. New Attachments do not need editor sidecars; the PDF/XLSX rows
above document legacy recovery data only.

### What each file means

- **Markdown Page:** the `.md` text and frontmatter are the portable source. The sidecar preserves lossless editor HTML and replaceable state.
- **Attachment:** the original file is the source. Normal attachments do not receive new editor state.
- **Legacy PDF/Excel sidecar:** preserves historical editor state and remains recovery evidence even after an export attempt.

Do not manually delete a legacy sidecar if you still need its PDF annotations or
spreadsheet edits. Never delete `.bak`, `.lock`, or `.corrupt-*` files as part of
cleanup.

### Advanced: legacy recovery files

An older doXmind build may have left several recovery artifacts:

- `<sidecar>.bak` is the backup of the original sidecar.
- `<sidecar>.lock` coordinates the migration and can remain afterward.
- `<sidecar>.corrupt-*` is a recovery copy created when corrupt data could not be migrated safely.

The current Attachment recovery flow inspects only the main sidecar and `.bak`.
It does not read `.lock` or `.corrupt-*`, and it does not create, rename,
overwrite, or delete any recovery evidence. Do not delete these files merely
because they are small or hidden, and do not move a backup over the main sidecar
before exporting: the UI can inspect both candidates and asks you to choose when
their saved states differ.

## 9. Keyboard shortcuts

The current public desktop release is for macOS, where shortcuts use `Cmd`. Browser development and compatibility builds on other platforms use `Ctrl` unless shown otherwise.

| Action                                   | Shortcut           |
| ---------------------------------------- | ------------------ |
| New Page in an open workspace            | `Cmd/Ctrl+N`       |
| New window                               | `Cmd/Ctrl+Shift+N` |
| Open file                                | `Cmd/Ctrl+O`       |
| Open folder                              | `Cmd/Ctrl+Shift+O` |
| Save                                     | `Cmd/Ctrl+S`       |
| Find in Page                             | `Cmd/Ctrl+F`       |
| Command palette                          | `Cmd/Ctrl+K`       |
| Quick switcher                           | `Cmd/Ctrl+Tab`     |
| Quick switcher from the native Edit menu | `Cmd/Ctrl+P`       |
| Toggle sidebar                           | `Cmd/Ctrl+B`       |
| Focus mode                               | `F11`              |
| Exit focus mode                          | `Esc`              |
| Shortcut reference                       | `Cmd/Ctrl+Shift+?` |
| Reveal active source file                | `Cmd/Ctrl+Alt+R`   |

Standard editing shortcuts for undo, redo, cut, copy, paste, and select all also work in the active editor.

## 10. Limits and troubleshooting

### A file does not appear in a workspace

- Confirm it is a Markdown Page or a supported local Attachment.
- Refresh or reopen the folder after changing files outside doXmind.
- DOCX and PPTX are not supported workspace documents.

PDF, Excel, CSV, and HTML files intentionally open as read-only Attachments.
Use **Open Externally** for ordinary editing in the file's system application.
Standalone images, DOCX, PPTX, and arbitrary other extensions are not promised
to appear as workspace documents. Add images through a Markdown Page so they
remain local assets referenced by that Page. The internal `other` Attachment
type is only a safe read-only fallback if an unknown format reaches the shared
surface; it does not expand workspace scanning or native opening.

### Recovery status needs attention

Corrupt JSON, future or invalid versions, mixed legacy/current shapes, and
unsupported recovery state are reported conservatively instead of being treated
as empty. doXmind does not rewrite or migrate the evidence. Keep the source,
main sidecar, every `.bak`, `.lock`, and `.corrupt-*` file together for manual
recovery. If the app cannot offer a recovery attempt, follow the verified
fallback status and isolated-copy procedure in the
[1.8.0 release notes](releases/1.8.0.md); do not try an arbitrary older build.

### Changes are missing from a recovered workbook

- If both the main sidecar and `.bak` are offered, export the other candidate
  and compare the recovered copies.
- Recovery refuses saved `filters` or `filterMode` rather than silently losing
  them.
- `.xlsm` recovery produces `.xlsx`; macros are not included.

### Changes are missing from a recovered PDF

- If both the main sidecar and `.bak` are offered, export the other candidate
  and compare the recovered copies.
- Recovery refuses source-text mismatches, unsupported page rotations, or text
  that would need silent resizing. Keep every recovery file and use the manual
  compatibility path instead of accepting a partial copy.

## 11. Privacy and optional automation

The desktop editor keeps document content, parsing, exports, sidecars, and application metadata on the machine. doXmind has no built-in cloud account, telemetry, or AI runtime. Packaged builds can check the release service for updates, and inserting a web bookmark can request that page and its preview image.

Advanced users can separately install the local `doxmind` CLI or `doxmind-mcp` server. Those tools operate directly on a selected local workspace and do not require the desktop app to be running. See [CLI & MCP](cli-and-mcp.md). Avoid editing the same document concurrently in the app and another process.
