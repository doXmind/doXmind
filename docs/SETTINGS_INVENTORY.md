# Settings Inventory

Source of truth for the new Settings page redesign.

Product scope follows [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md): Markdown
Page is the only editable content type, so PDF/Excel editor settings and a
default document-type selector are intentionally excluded. Page storage follows
[ADR-0012](adr/0012-markdown-source-block-editor.md): active Pages have no
sidecar settings; existing `.doxmind` files are byte-preserved legacy
artifacts that nothing reads.

Status legend:

- `[done]` — UI exists today
- `[partial]` — store/hook exists, UI missing
- `[new]` — needs to be built from scratch
- `[mac]` — macOS-only
- `[desktop]` — Electron desktop shell only

Design principles:

1. Settings are _preferences and configuration_. Data views (Trash, Recents) belong elsewhere.
2. If there is a sensible default and no real disagreement, ship the default — don't add a toggle.
3. If the choice is per-document or per-cell, it doesn't belong in app settings.
4. Don't expose paths, watchers, or internals just because they exist.
5. local-first is a stance, not a configuration surface — express it in About, don't add a "block network" toggle for an app whose only outbound request is the update check the user starts.

---

## Tab structure

```
General  ·  Appearance  ·  Editor  ·  Workspace  ·  Backup & Privacy  ·  About
```

---

## 1. General

### Language

| Item             | Control                   | Default | Status                                      |
| ---------------- | ------------------------- | ------- | ------------------------------------------- |
| Display language | Segmented: English / 中文 | English | `[done]` (in Appearance, not a General tab) |

### Startup

| Item                          | Control                                               | Default     | Status  |
| ----------------------------- | ----------------------------------------------------- | ----------- | ------- |
| On launch                     | Radio: Last opened workspace / Welcome screen / Empty | Last opened | `[new]` |
| Restore previously open files | Toggle                                                | on          | `[new]` |

### Windows `[desktop]`

| Item                         | Control                         | Default     | Status  |
| ---------------------------- | ------------------------------- | ----------- | ------- |
| Open recent in               | Radio: Same window / New window | Same window | `[new]` |
| Quit when last window closes | Toggle `[mac]`                  | off         | `[new]` |

---

## 2. Appearance

### Theme

| Item        | Control                                                                                              | Default | Status   |
| ----------- | ---------------------------------------------------------------------------------------------------- | ------- | -------- |
| Mode        | Segmented: Light / Dark / System                                                                     | System  | `[done]` |
| Light theme | Dropdown (doXmind / Notion / GitHub / VS Code / Atom One / Solarized / Tokyo / Catppuccin / Gruvbox) | doXmind | `[done]` |
| Dark theme  | Dropdown (doXmind / Notion / GitHub / VS Code / Atom One / Solarized / Tokyo / Catppuccin / Gruvbox) | doXmind | `[done]` |

### Typography

| Item         | Control            | Default | Status   |
| ------------ | ------------------ | ------- | -------- |
| UI font size | Number (px, 10–22) | 13      | `[done]` |

| Code font size | Number (px, 10–22) | 12 | `[done]` |
| Editor font family | Dropdown grouped Sans / Serif / Mono | system-ui | `[done]` |
| Editor line spacing | Segmented: Compact / Normal / Relaxed | Normal | `[done]` |

### Behavior

| Item | Control | Default | Status |
| ---- | ------- | ------- | ------ |

| Reset appearance to defaults | Button | — | `[partial]` (store action exists, no UI calls it) |

---

## 3. Editor

### 3a. Markdown — Editing

| Item                                | Control                     | Default | Status  |
| ----------------------------------- | --------------------------- | ------- | ------- |
| Spell check                         | Toggle                      | on      | `[new]` |
| Smart typography ("" → "" · -- → —) | Toggle                      | on      | `[new]` |
| Tab size                            | Segmented: 2 / 4 / Tab char | 2       | `[new]` |
| Paste as plain text by default      | Toggle                      | off     | `[new]` |

### 3b. Markdown — Save

| Item                       | Control                           | Default    | Status  |
| -------------------------- | --------------------------------- | ---------- | ------- |
| Auto-save                  | Toggle                            | on         | `[new]` |
| Markdown line wrap on save | Segmented: Soft / Hard at N chars | Soft       | `[new]` |
| Hard-wrap column           | Number (only when Hard)           | 80         | `[new]` |
| Line endings               | Segmented: LF / CRLF / Match file | Match file | `[new]` |

### 3c. Markdown — Images

| Item                  | Control                                                     | Default             | Status  |
| --------------------- | ----------------------------------------------------------- | ------------------- | ------- |
| Pasted image location | Radio: Same folder / `assets/` subfolder / Prompt each time | `assets/` subfolder | `[new]` |
| Image link style      | Radio: Relative / Absolute                                  | Relative            | `[new]` |

### 3d. Markdown — Custom blocks

| Item                             | Control  | Default | Status  |
| -------------------------------- | -------- | ------- | ------- |
| Default code block language      | Dropdown | plain   | `[new]` |
| Show line numbers in code blocks | Toggle   | off     | `[new]` |

---

## 4. Workspace

### Current workspace

| Item              | Control                         | Default | Status                      |
| ----------------- | ------------------------------- | ------- | --------------------------- |
| Current folder    | Path display + "Open in Finder" | —       | `[done]` (display only)     |
| Open workspace    | Button                          | —       | `[done]`                    |
| Recent workspaces | List (≤5, removable per-item)   | —       | `[done]` (removable is new) |

### File tree

| Item                          | Control                              | Default | Status  |
| ----------------------------- | ------------------------------------ | ------- | ------- |
| Sort by                       | Segmented: Name / Modified / Created | Name    | `[new]` |
| Folders first                 | Toggle                               | on      | `[new]` |
| Show hidden files (dot-files) | Toggle                               | off     | `[new]` |

### External edits

| Item                      | Control                     | Default     | Status  |
| ------------------------- | --------------------------- | ----------- | ------- |
| When file changes on disk | Radio: Auto-reload / Prompt | Auto-reload | `[new]` |

### Legacy sidecar artifacts

Legacy `.doxmind` files are inert leftovers, not active Page state. Settings must
not offer automatic recreation or cleanup; generic “Show hidden files” is
sufficient for inspection.

### Search

| Item             | Control                                                          | Default                                                                                                                       | Status   |
| ---------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------- |
| Excluded folders | Textarea, one folder name per line (path-shaped entries dropped) | empty — `.doxmind`, `.git`, `node_modules`, `target`, `.next`, `out`, `dist`, `build` are always skipped and are not editable | `[done]` |

---

## 5. Backup & Privacy

### Snapshots

| Item                       | Control                                  | Default | Status  |
| -------------------------- | ---------------------------------------- | ------- | ------- |
| Auto-snapshot on save      | Toggle                                   | off     | `[new]` |
| Snapshots to keep per file | Number (1–50)                            | 10      | `[new]` |
| Browse snapshots           | Button — opens snapshot folder in Finder | —       | `[new]` |

### Trash

| Item                        | Control                           | Default | Status                                                                                                               |
| --------------------------- | --------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------- |
| Auto-empty trash older than | Segmented: Never / 7d / 30d / 90d | Never   | `[new]`                                                                                                              |
| Manage trash                | —                                 | —       | Dropped. There is no in-app Trash: deletes go to the OS Trash via `shell.trashItem`, and recovery happens in Finder. |

### Privacy statement

| Item         | Content                                        | Status  |
| ------------ | ---------------------------------------------- | ------- |
| Status badge | "100% local · No telemetry · No cloud · No AI" | `[new]` |

---

## 6. About

| Item               | Content                                                       | Status               |
| ------------------ | ------------------------------------------------------------- | -------------------- |
| Version            | `x.y.z`                                                       | `[done]`             |
| Channel            | release channel                                               | `[done]`             |
| Build              | build identifier                                              | `[done]`             |
| Provided by        | publisher                                                     | `[done]`             |
| Check for updates  | Button + status line; becomes "Restart to update" once staged | `[done]` `[desktop]` |
| Privacy            | Modal — local-first, no sign-in/sync/telemetry/AI             | `[done]`             |
| Acknowledgements   | Modal — third-party components                                | `[done]`             |
| Platform           | macOS x.y / Windows / Linux                                   | `[new]`              |
| Data directory     | `~/.doxmind` + Open in Finder + Copy path                     | `[new]`              |
| Log directory      | + Open in Finder                                              | `[new]`              |
| GitHub             | Link                                                          | `[new]`              |
| Report an issue    | Link                                                          | `[new]`              |
| Reset all settings | Button (with strong confirmation)                             | `[new]`              |

---

## Considered and dropped (over-engineering audit)

These looked plausible but fail one of the design principles above. Dropped, with the reason — kept here so future contributors don't re-litigate.

### From General

| Dropped                                                    | Why                                                                                                                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Confirm before deleting > N items (configurable threshold) | Always confirm destructive actions. A configurable threshold is theater.                                                                                   |
| Confirm before emptying trash (toggle)                     | Emptying trash should always confirm. Not a setting.                                                                                                       |
| Remember window size & position per workspace              | Every window opens at a fixed 1400×900; nothing persists geometry today. Restoring the last size and position at all comes before making it per-workspace. |

### From Appearance

| Dropped                                          | Why                                                                                          |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| High-contrast mode toggle                        | Ship a high-contrast theme variant instead. The theme system is the right surface.           |
| Reduce motion override (System / Always / Never) | `MotionConfig reducedMotion="user"` already follows the OS. App-level override is redundant. |

### From Editor — Markdown

| Dropped                                            | Why                                                                                                               |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Auto-pair brackets & quotes (toggle)               | Default on. There is no real camp that wants this off; if one appears, add it then.                               |
| Spell check language picker                        | Comes from OS dictionaries automatically.                                                                         |
| Frontmatter on new files (None / Minimal / Custom) | Belongs to the file-template feature, not a global preference. Templates already exist (`TemplatePicker`).        |
| Default image format (PNG / WebP)                  | No demand; default to PNG. Adding format conversion to a paste path increases bug surface for zero clear benefit. |
| Math renderer (Inline only / Block only / Both)    | Never disable a renderer that already works. Just support both.                                                   |
| Mermaid theme follows app theme (toggle)           | Default on, no setting.                                                                                           |
| Auto-save interval (1s / 5s / 30s segmented)       | Simplified to a single on/off. Picking an interval is decision fatigue; 5s is the right default.                  |

### From Editor — PDF and Excel

| Dropped                                                                                                                   | Why                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every PDF and spreadsheet preference (annotation tool, highlight color, row/column headers, decimal precision, cell font) | doXmind is a pure Markdown editor. PDF, Excel, CSV and HTML are files it leaves alone: they open read-only with Reveal and Open externally, and there is no PDF or spreadsheet editor to configure. |

### From Workspace

| Dropped                                                   | Why                                                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Default workspace path for new files                      | Muddles the model. New files go in the currently selected folder.                       |
| Default expand depth on workspace open                    | Premature. Users open folders themselves and the tree state persists.                   |
| File watcher (toggle)                                     | Either we trust the watcher or we remove the feature. No middle ground worth surfacing. |
| Recreate sidecar when markdown edited externally (toggle) | Superseded by ADR-0012: active Pages have no sidecar; preserve any legacy artifact.     |
| Clean up orphan sidecars                                  | Legacy sidecars may contain recoverable data and must not be deleted automatically.     |

### From Backup & Privacy

| Dropped                                             | Why                                                                                                                                                                                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Snapshot location (custom path picker)              | Hardcode `~/.doxmind/snapshots`. Exposing the path adds support burden and migration risk for a feature most users will never relocate.                                                                                                                 |
| Block all outbound network requests (master toggle) | The app makes exactly one outbound request, and only when the user asks for it: the update-feed check behind About → Check for updates. A master toggle for one explicitly-invoked request is theater. The Privacy panel in About expresses the stance. |

---

## Implementation cost (for sequencing)

| Bucket                               | Items                                                                                                                           | Effort |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Already done — only needs new layout | All of Appearance                                                                                                               | 0      |
| Small (< half day each)              | Language, Startup, file tree sort/hidden visibility, smart typography, tab size, code block options, recent workspace removable | small  |
| Medium (1–2 days each)               | Image paste strategy, external edits behavior, snapshot foundation, line endings, line wrap                                     | medium |
| Large (≥ 3 days)                     | Search excluded folders (touches indexer), sidebar trash panel migration, About scaffolding                                     | large  |

Recommended order:

1. **Layout shell + Appearance** — highest visible win, zero new logic
2. **Workspace tab** (file tree + recent management) — daily-touched surface
3. **Markdown editor preferences** — typography, save, image paste

4. **Backup & Privacy + About** — completes the IA
