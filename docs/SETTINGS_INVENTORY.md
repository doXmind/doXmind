# Settings Inventory

Source of truth for the new Settings page redesign.

Status legend:

- `[done]` — UI exists today
- `[partial]` — store/hook exists, UI missing
- `[new]` — needs to be built from scratch
- `[mac]` — macOS-only
- `[tauri]` — desktop shell only

Design principles:

1. Settings are _preferences and configuration_. Data views (Trash, Recents) belong elsewhere.
2. If there is a sensible default and no real disagreement, ship the default — don't add a toggle.
3. If the choice is per-document or per-cell, it doesn't belong in app settings.
4. Don't expose paths, watchers, or internals just because they exist.
5. local-first is a stance, not a configuration surface — express it in About, don't add a "block network" toggle for an app that makes no requests.

---

## Tab structure

```
General  ·  Appearance  ·  Editor  ·  Workspace  ·  Backup & Privacy  ·  About
```

---

## 1. General

### Language

| Item             | Control                     | Default       | Status      |
| ---------------- | --------------------------- | ------------- | ----------- |
| Display language | Select (English / 简体中文) | follow system | `[partial]` |

### Startup

| Item                          | Control                                               | Default     | Status  |
| ----------------------------- | ----------------------------------------------------- | ----------- | ------- |
| On launch                     | Radio: Last opened workspace / Welcome screen / Empty | Last opened | `[new]` |
| Restore previously open files | Toggle                                                | on          | `[new]` |

### Windows `[tauri]`

| Item                         | Control                         | Default     | Status  |
| ---------------------------- | ------------------------------- | ----------- | ------- |
| Open recent in               | Radio: Same window / New window | Same window | `[new]` |
| Quit when last window closes | Toggle `[mac]`                  | off         | `[new]` |

---

## 2. Appearance

### Theme

| Item        | Control                                                                              | Default | Status   |
| ----------- | ------------------------------------------------------------------------------------ | ------- | -------- |
| Mode        | Segmented: Light / Dark / System                                                     | System  | `[done]` |
| Light theme | Theme grid (notion …)                                                                | notion  | `[done]` |
| Dark theme  | Theme grid (dark / nord / forest / ocean / obsidian / cyberpunk / amethyst / carbon) | dark    | `[done]` |

### Typography

| Item                | Control                               | Default   | Status   |
| ------------------- | ------------------------------------- | --------- | -------- |
| UI font size        | Number (px, 12–18)                    | 14        | `[done]` |
| Editor font size    | Number (px)                           | 16        | `[done]` |
| Code font size      | Number (px)                           | 14        | `[done]` |
| Editor font family  | Dropdown grouped Sans / Serif / Mono  | system-ui | `[done]` |
| Editor line spacing | Segmented: Compact / Normal / Relaxed | Normal    | `[done]` |

### Behavior

| Item                           | Control | Default | Status   |
| ------------------------------ | ------- | ------- | -------- |
| Use pointer cursors on buttons | Toggle  | off     | `[done]` |
| Reset appearance to defaults   | Button  | —       | `[done]` |

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

### 3e. PDF

| Item           | Control                                | Default   | Status  |
| -------------- | -------------------------------------- | --------- | ------- |
| Render quality | Segmented: Low / Medium / High         | Medium    | `[new]` |
| Default zoom   | Segmented: Fit width / Fit page / 100% | Fit width | `[new]` |

### 3f. Excel

| Item                | Control  | Default    | Status  |
| ------------------- | -------- | ---------- | ------- |
| Show gridlines      | Toggle   | on         | `[new]` |
| Default date format | Dropdown | YYYY-MM-DD | `[new]` |

---

## 4. Workspace

### Current workspace

| Item              | Control                         | Default | Status                      |
| ----------------- | ------------------------------- | ------- | --------------------------- |
| Current folder    | Path display + "Open in Finder" | —       | `[done]` (display only)     |
| Open workspace    | Button                          | —       | `[done]`                    |
| Recent workspaces | List (≤5, removable per-item)   | —       | `[done]` (removable is new) |

### File tree

| Item                          | Control                              | Default  | Status  |
| ----------------------------- | ------------------------------------ | -------- | ------- |
| Sort by                       | Segmented: Name / Modified / Created | Name     | `[new]` |
| Folders first                 | Toggle                               | on       | `[new]` |
| Show hidden files (dot-files) | Toggle                               | off      | `[new]` |
| Show `.doxmind` sidecars      | Toggle                               | off      | `[new]` |
| New file default type         | Segmented: Markdown / PDF / Excel    | Markdown | `[new]` |

### External edits

| Item                      | Control                     | Default     | Status  |
| ------------------------- | --------------------------- | ----------- | ------- |
| When file changes on disk | Radio: Auto-reload / Prompt | Auto-reload | `[new]` |

### Sidecar maintenance

| Item                     | Control                                  | Default | Status  |
| ------------------------ | ---------------------------------------- | ------- | ------- |
| Clean up orphan sidecars | Button (scan + report + one-click clean) | —       | `[new]` |

### Search

| Item             | Control   | Default                            | Status  |
| ---------------- | --------- | ---------------------------------- | ------- |
| Excluded folders | Tag input | `.git`, `node_modules`, `.doxmind` | `[new]` |

---

## 5. Backup & Privacy

### Snapshots

| Item                       | Control                                  | Default | Status  |
| -------------------------- | ---------------------------------------- | ------- | ------- |
| Auto-snapshot on save      | Toggle                                   | off     | `[new]` |
| Snapshots to keep per file | Number (1–50)                            | 10      | `[new]` |
| Browse snapshots           | Button — opens snapshot folder in Finder | —       | `[new]` |

### Trash

| Item                        | Control                           | Default | Status                               |
| --------------------------- | --------------------------------- | ------- | ------------------------------------ |
| Auto-empty trash older than | Segmented: Never / 7d / 30d / 90d | Never   | `[new]`                              |
| Manage trash                | Link — opens sidebar trash panel  | —       | `[new]` (replaces current Trash tab) |

### Privacy statement

| Item         | Content                                        | Status  |
| ------------ | ---------------------------------------------- | ------- |
| Status badge | "100% local · No telemetry · No cloud · No AI" | `[new]` |

---

## 6. About

| Item                 | Content                                   | Status  |
| -------------------- | ----------------------------------------- | ------- |
| Logo + product name  | doXmind                                   | `[new]` |
| Version              | `x.y.z`                                   | `[new]` |
| Platform             | macOS x.y / Windows / Linux               | `[new]` |
| Data directory       | `~/.doxmind` + Open in Finder + Copy path | `[new]` |
| Log directory        | + Open in Finder                          | `[new]` |
| GitHub               | Link                                      | `[new]` |
| Report an issue      | Link                                      | `[new]` |
| Third-party licenses | Modal / link                              | `[new]` |
| Reset all settings   | Button (with strong confirmation)         | `[new]` |

---

## Considered and dropped (over-engineering audit)

These looked plausible but fail one of the design principles above. Dropped, with the reason — kept here so future contributors don't re-litigate.

### From General

| Dropped                                                    | Why                                                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Confirm before deleting > N items (configurable threshold) | Always confirm destructive actions. A configurable threshold is theater.                                      |
| Confirm before emptying trash (toggle)                     | Emptying trash should always confirm. Not a setting.                                                          |
| Remember window size & position per workspace              | Tauri already restores last window geometry. Per-workspace memory is a feature without a complaint behind it. |

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

### From Editor — PDF

| Dropped                 | Why                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------- |
| Default annotation tool | Tools should be sticky in the editor toolbar (last-used wins). Not an app preference. |
| Default highlight color | Belongs to the in-editor color picker, not Settings.                                  |

### From Editor — Excel

| Dropped                   | Why                                                   |
| ------------------------- | ----------------------------------------------------- |
| Show row & column headers | Per-sheet view setting, not an app preference.        |
| Decimal display precision | Per-cell formatting. Excel itself models it that way. |
| Default font              | Per-cell formatting.                                  |

### From Workspace

| Dropped                                                   | Why                                                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Default workspace path for new files                      | Muddles the model. New files go in the currently selected folder.                       |
| Default expand depth on workspace open                    | Premature. Users open folders themselves and the tree state persists.                   |
| File watcher (toggle)                                     | Either we trust the watcher or we remove the feature. No middle ground worth surfacing. |
| Recreate sidecar when markdown edited externally (toggle) | Already documented as the design (markdown wins). Not a user-facing choice.             |

### From Backup & Privacy

| Dropped                                             | Why                                                                                                                                     |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Snapshot location (custom path picker)              | Hardcode `~/.doxmind/snapshots`. Exposing the path adds support burden and migration risk for a feature most users will never relocate. |
| Block all outbound network requests (master toggle) | The app makes no network requests. A toggle for a non-event is theater. The privacy badge in About expresses the stance.                |

---

## Implementation cost (for sequencing)

| Bucket                               | Items                                                                                                                                                  | Effort |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Already done — only needs new layout | All of Appearance                                                                                                                                      | 0      |
| Small (< half day each)              | Language, Startup, file tree sort/hidden/sidecar visibility, smart typography, tab size, code block options, recent workspace removable                | small  |
| Medium (1–2 days each)               | Image paste strategy, external edits behavior, orphan sidecar cleanup, snapshot foundation, line endings, line wrap                                    | medium |
| Large (≥ 3 days)                     | PDF / Excel editor preferences (need each store wired up), search excluded folders (touches indexer), sidebar trash panel migration, About scaffolding | large  |

Recommended order:

1. **Layout shell + Appearance** — highest visible win, zero new logic
2. **Workspace tab** (file tree + sidecar visibility + recent management) — daily-touched surface
3. **Markdown editor preferences** — typography, save, image paste
4. **Trash migration to sidebar panel** — required before settings can drop the Trash tab
5. **Backup & Privacy + About** — completes the IA
6. **PDF / Excel preferences** — last, lowest engagement
