//! doXmind desktop shell.
//!
//! Lifecycle:
//!   1. On startup, pick a free TCP port on 127.0.0.1.
//!   2. Spawn the FastAPI sidecar with PORT=<that port>.
//!      - Release: tauri-plugin-shell sidecar (bundled `doxmind-server` binary).
//!      - Debug: `python -m uvicorn run_sidecar:main` from `server/` using the
//!        venv interpreter when present.
//!   3. Inject `window.__TAURI_BACKEND_URL__` into every WebView before any
//!      page script runs (see `init_script` on the WindowBuilder).
//!   4. On exit, kill the sidecar so we don't leave an orphaned uvicorn.

use std::fs;
use std::io;
use std::net::TcpListener;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use std::{cmp, collections::BTreeMap, collections::HashMap};

use doxmind_sidecar::{DocMeta, DocPayload, DocumentOutlineItem, ReadResult, Source, SourceState};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, EventTarget, LogicalPosition, Manager, RunEvent, Url, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_dialog::{DialogExt, FilePath};

const PDF_BLOCK_TYPE: &str = "pdf-block";
const PDF_LEGACY_EDITOR_KEY: &str = "pdf_editor";
const PDF_LEGACY_PARSED_CACHE_KEY: &str = "pdf_parsed_cache";

/// Environment-variable gate that decides whether legacy PDF/Excel
/// sidecars (`pdf_editor` / `excel_editor` top-level keys) get migrated
/// on first open. Matches the Python constant of the same name in
/// `server/services/synthetic_document.py`.
const MIGRATE_ENV_VAR: &str = "DOXMIND_SIDECAR_MIGRATE";
/// Values that disable migration. Case-insensitive, trimmed. Mirrors
/// `_MIGRATE_DISABLED_VALUES` in Python.
const MIGRATE_DISABLED_VALUES: &[&str] = &["0", "false", "no", "off"];
/// Values that explicitly enable migration. Anything else (including
/// the env var being unset) also enables it. Mirrors
/// `_MIGRATE_ENABLED_VALUES` in Python.
const MIGRATE_ENABLED_VALUES: &[&str] = &["1", "true", "yes", "on"];

#[cfg(target_os = "macos")]
mod dock_menu;
#[cfg(target_os = "macos")]
mod menu_bar;
mod pdf_export;

#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

#[cfg(target_os = "macos")]
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::TrayIconBuilder,
};

#[cfg(target_os = "macos")]
use objc2::rc::Retained;
#[cfg(target_os = "macos")]
use objc2::AnyThread;
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSApplication, NSImage, NSWorkspace};
#[cfg(target_os = "macos")]
use objc2_foundation::{MainThreadMarker, NSData, NSString};

#[cfg(not(debug_assertions))]
use tauri_plugin_shell::process::CommandChild;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;

#[cfg(debug_assertions)]
use std::process::{Child, Command};

/// Holds the running backend process so we can kill it cleanly on exit.
struct Backend {
    #[cfg(not(debug_assertions))]
    child: Mutex<Option<CommandChild>>,
    #[cfg(debug_assertions)]
    child: Mutex<Option<Child>>,
}

impl Backend {
    fn new() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }
}

/// What a window currently has open. The `kind` is "file" or "folder";
/// `path` is the absolute on-disk path. The frontend stays the source of
/// truth for "what's actually rendered", but Rust mirrors this so the dock
/// menu (and future "focus existing" routing) can reason about windows
/// without round-tripping to JS.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct OpenTarget {
    kind: String,
    path: String,
}

/// Per-window open-target registry. Keyed by Tauri window label.
struct WindowRegistry {
    open_targets: Mutex<HashMap<String, OpenTarget>>,
    counter: AtomicU64,
}

impl WindowRegistry {
    fn new() -> Self {
        Self {
            open_targets: Mutex::new(HashMap::new()),
            counter: AtomicU64::new(0),
        }
    }

    fn next_label(&self) -> String {
        let n = self.counter.fetch_add(1, Ordering::Relaxed);
        format!("doc-{n}")
    }

    fn set(&self, label: &str, target: OpenTarget) {
        if let Ok(mut map) = self.open_targets.lock() {
            map.insert(label.to_string(), target);
        }
    }

    fn clear(&self, label: &str) {
        if let Ok(mut map) = self.open_targets.lock() {
            map.remove(label);
        }
    }

    fn find_label(&self, target: &OpenTarget) -> Option<String> {
        let map = self.open_targets.lock().ok()?;
        map.iter().find_map(|(label, t)| {
            if t == target {
                Some(label.clone())
            } else {
                None
            }
        })
    }
}

/// Debounce window for collapsing a burst of filesystem events into a single
/// `workspace://changed` emit. The watcher event = "workspace may be dirty";
/// the frontend's `workspace_scan` re-scan is the source of truth, so a coarse
/// debounce is all we need. ~400 ms matches the issue's target.
const WORKSPACE_WATCH_DEBOUNCE: Duration = Duration::from_millis(400);

/// Hard ceiling on how long a single coalesce window may grow under a
/// continuous event stream. Without it, events arriving faster than the
/// debounce gap would reset the timer forever and starve the emit. Bounds
/// worst-case latency so the sidebar still refreshes within the ~1 s target.
const WORKSPACE_WATCH_MAX_COALESCE: Duration = Duration::from_millis(800);

/// One live watcher per window. The `RecommendedWatcher` is held to keep the
/// OS watch alive; dropping it stops watching. The drain thread that owns the
/// event receiver exits on its own when the watcher (and thus the sender) is
/// dropped, so removing the entry from the map is the whole teardown.
struct WorkspaceWatch {
    _watcher: RecommendedWatcher,
    /// The exact (raw) root string the frontend passed to `workspace_watch`.
    /// Used as the swap-safe teardown identity: the frontend passes the same
    /// raw string to `workspace_unwatch`, so we match on it directly and never
    /// have to re-canonicalize (which would fail if the folder was deleted).
    key: String,
}

/// Per-window filesystem watchers, keyed by Tauri window label. Each window
/// watches only its own workspace root, so a window showing folder A never
/// refreshes because folder B changed.
struct WorkspaceWatchers {
    by_label: Mutex<HashMap<String, WorkspaceWatch>>,
}

impl WorkspaceWatchers {
    fn new() -> Self {
        Self {
            by_label: Mutex::new(HashMap::new()),
        }
    }

    fn remove(&self, label: &str) {
        if let Ok(mut map) = self.by_label.lock() {
            map.remove(label);
        }
    }

    /// Remove the watcher for `label` only if its key still matches `key`. No-op
    /// if the entry was already replaced by a watcher for a different folder —
    /// this is what keeps a late folder-A teardown from killing a live folder-B
    /// watcher during a swap. Matching on the raw caller key (not a re-derived
    /// canonical path) means a deleted/renamed folder can never escalate this
    /// into an unconditional remove.
    fn remove_if_key(&self, label: &str, key: &str) {
        if let Ok(mut map) = self.by_label.lock() {
            if map.get(label).map(|w| w.key.as_str()) == Some(key) {
                map.remove(label);
            }
        }
    }
}

/// Whether a single path segment is one the scan ignores or that the watcher
/// should treat as noise. Mirrors the scan's ignore model (`is_ignored_scan_dir`
/// / `is_hidden_sidecar_name`) and extends it for the full hidden-sidecar family
/// so a sidecar `.lock` / `.bak` / `.corrupt-*` write — or any write inside the
/// `.doxmind/` index dir — never bounces back as a refresh.
fn is_ignored_watch_segment(name: &str) -> bool {
    // The `.doxmind/` index directory and any ignored/generated dir.
    if name == ".doxmind" || is_ignored_scan_dir(name) {
        return true;
    }
    // Hidden sidecar family: `.foo.doxmind`, plus the `.lock` / `.bak` /
    // `.corrupt-*` siblings that hang off it. `is_hidden_sidecar_name` only
    // catches the exact `.doxmind` suffix, so widen it here.
    name.starts_with('.') && name.contains(".doxmind")
}

/// Whether an event path under the workspace root is "interesting" enough to
/// trigger a re-scan. notify delivers absolute paths, so we test only the
/// segments *below* the watch root — the scan likewise only inspects the leaf
/// name of each child entry, never the ancestor path. Without this the root's
/// own path segments (e.g. a workspace living under `~/build/` or `~/.git-bare/`)
/// would spuriously match the ignore list and silence every event.
///
/// If the path can't be placed under the root (no shared prefix — shouldn't
/// happen for a recursive watch on the canonical `root`, but possible if a
/// backend reports a path via a different symlink/mount alias), we treat it as
/// relevant rather than scanning its absolute ancestors: the worst case is one
/// extra re-scan, whereas the alternative would silently drop real events for
/// any workspace nested under an ignore-listed directory name.
///
/// Main `.md` saves are not filtered here; they produce one debounced re-scan,
/// which is fine.
fn watch_path_is_relevant(root: &Path, path: &Path) -> bool {
    let Ok(segments) = path.strip_prefix(root) else {
        return true;
    };
    for component in segments.components() {
        if let Component::Normal(part) = component {
            if is_ignored_watch_segment(&part.to_string_lossy()) {
                return false;
            }
        }
    }
    true
}

/// Returns true if any path in the event batch is relevant. notify reports the
/// affected paths per event; a rename/move carries both endpoints. We keep the
/// event if *any* endpoint is interesting.
fn watch_event_is_relevant(root: &Path, event: &notify::Event) -> bool {
    // Access/metadata-only churn is noise (e.g. mtime bumps from reads). Keep
    // structural changes: create / modify-content / remove / rename.
    match event.kind {
        EventKind::Access(_) => false,
        EventKind::Any
        | EventKind::Other
        | EventKind::Create(_)
        | EventKind::Modify(_)
        | EventKind::Remove(_) => event.paths.iter().any(|p| watch_path_is_relevant(root, p)),
    }
}

/// Spawn a recursive watcher on `root` (canonical) and a drain thread that
/// debounces event bursts and emits `workspace://changed` (with `{ root }`) to
/// the owning window only. `key` is the raw caller-supplied root string, stored
/// as the teardown identity. Returns the `WorkspaceWatch` whose lifetime keeps
/// both alive.
fn spawn_workspace_watch(
    app: &AppHandle,
    label: String,
    root: PathBuf,
    key: String,
) -> Result<WorkspaceWatch, String> {
    let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
    let mut watcher = notify::recommended_watcher(move |res| {
        // The receiver lives in the drain thread; once that thread (and the
        // watcher) is gone the send fails and we simply stop forwarding.
        let _ = tx.send(res);
    })
    .map_err(|err| format!("failed to create watcher: {err}"))?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|err| format!("failed to watch {}: {err}", root.display()))?;

    let app = app.clone();
    let emit_root = root.to_string_lossy().into_owned();
    let coalesce_root = root.clone();
    thread::spawn(move || {
        // Block for the first relevant event, then coalesce everything that
        // arrives within the debounce window into one emit.
        while let Ok(first) = rx.recv() {
            if !first
                .map(|e| watch_event_is_relevant(&coalesce_root, &e))
                .unwrap_or(false)
            {
                continue;
            }
            // Coalesce: keep draining while events keep arriving within the
            // debounce gap, but cap the total coalesce window so a continuous
            // stream (relevant or not) can never starve the emit past the
            // ~1 s budget. We don't inspect drained events — any further change
            // is already covered by the single re-scan this emit triggers.
            let deadline = Instant::now() + WORKSPACE_WATCH_MAX_COALESCE;
            loop {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    break;
                }
                let gap = cmp::min(WORKSPACE_WATCH_DEBOUNCE, remaining);
                if rx.recv_timeout(gap).is_err() {
                    break;
                }
            }

            // Per-window delivery: in Tauri v2 a bare `emit` broadcasts to every
            // window, so we target this window's webview explicitly. Combined
            // with the frontend re-registering on root change, a window showing
            // folder A never refreshes because folder B changed (AC #3).
            let _ = app.emit_to(
                EventTarget::webview_window(&label),
                "workspace://changed",
                WorkspaceChangedPayload { root: &emit_root },
            );
        }
    });

    Ok(WorkspaceWatch {
        _watcher: watcher,
        key,
    })
}

#[derive(Serialize, Clone)]
struct WorkspaceChangedPayload<'a> {
    root: &'a str,
}

/// Queue of file paths the OS asked us to open — populated from CLI args at
/// startup (Windows/Linux file associations pass paths as argv) and from
/// `RunEvent::Opened` (macOS Finder "Open With" / drag-to-dock). Drained by
/// the frontend on mount via `take_pending_open_paths`.
struct PendingOpenPaths(Mutex<Vec<String>>);

impl PendingOpenPaths {
    fn new() -> Self {
        Self(Mutex::new(Vec::new()))
    }

    fn push(&self, path: String) {
        if let Ok(mut q) = self.0.lock() {
            q.push(path);
        }
    }

    fn drain(&self) -> Vec<String> {
        self.0
            .lock()
            .map(|mut q| std::mem::take(&mut *q))
            .unwrap_or_default()
    }

    /// Pop the first pending path, leaving the rest in the queue. Used at
    /// setup time so the very first window can target a file directly
    /// instead of flashing the welcome screen first.
    fn pop_first(&self) -> Option<String> {
        let mut q = self.0.lock().ok()?;
        if q.is_empty() {
            None
        } else {
            Some(q.remove(0))
        }
    }
}

/// Resolve a path string from argv or a file:// URL into a canonical absolute
/// path that points at one of the document types doXmind can actually open.
/// Returns None when the extension isn't supported or the file doesn't exist
/// (e.g. an argv flag like `--debug` that happens to slip past the leading
/// `-` filter).
fn normalize_open_path(path: &str) -> Option<String> {
    let p = std::path::Path::new(path);
    let abs = if p.is_absolute() {
        p.to_path_buf()
    } else {
        std::fs::canonicalize(p).ok()?
    };
    if !abs.exists() {
        return None;
    }
    let lower = abs.to_string_lossy().to_ascii_lowercase();
    let supported = [".md", ".markdown", ".html", ".htm", ".pdf", ".xlsx", ".xlsm"]
        .iter()
        .any(|ext| lower.ends_with(ext));
    if !supported {
        return None;
    }
    Some(abs.to_string_lossy().into_owned())
}

#[tauri::command]
fn take_pending_open_paths(state: tauri::State<'_, PendingOpenPaths>) -> Vec<String> {
    state.drain()
}

/// Ask the kernel for a free port by binding to :0 and reading it back.
fn pick_free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("failed to bind probe socket")
        .local_addr()
        .expect("failed to read probe socket addr")
        .port()
}

/// In dev mode, find a usable Python interpreter — preferring the project
/// venv so editable installs are picked up. The venv layout differs between
/// platforms (POSIX: `bin/python`, Windows: `Scripts/python.exe`), and the
/// system launcher is `python3` on POSIX vs `python` on Windows, so both
/// the venv path and the fallback are platform-aware.
#[cfg(debug_assertions)]
fn resolve_python(server_dir: &std::path::Path) -> PathBuf {
    if let Ok(explicit) = std::env::var("DOXMIND_PYTHON") {
        return PathBuf::from(explicit);
    }

    let venv_dir = server_dir.join(".venv");
    #[cfg(target_os = "windows")]
    let venv = venv_dir.join("Scripts").join("python.exe");
    #[cfg(not(target_os = "windows"))]
    let venv = venv_dir.join("bin").join("python");

    if venv.exists() {
        return venv;
    }

    #[cfg(target_os = "windows")]
    {
        PathBuf::from("python")
    }
    #[cfg(not(target_os = "windows"))]
    {
        PathBuf::from("python3")
    }
}

#[cfg(debug_assertions)]
fn spawn_backend_dev(port: u16) -> Child {
    // The server lives at <repo-root>/server. In `tauri dev` the binary's
    // CWD is the repo root, so resolve relative to CARGO_MANIFEST_DIR (which
    // points at src-tauri/) and step up one level.
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let server_dir = manifest_dir
        .parent()
        .expect("src-tauri must have a parent directory")
        .join("server");
    let python = resolve_python(&server_dir);

    log::info!(
        "[backend/dev] starting {} run_sidecar.py on port {} (cwd={})",
        python.display(),
        port,
        server_dir.display()
    );

    Command::new(python)
        .arg("run_sidecar.py")
        .current_dir(&server_dir)
        .env("HOST", "127.0.0.1")
        .env("PORT", port.to_string())
        .spawn()
        .expect("failed to spawn dev backend (python run_sidecar.py)")
}

#[cfg(not(debug_assertions))]
fn spawn_backend_sidecar(app: &AppHandle, port: u16) -> CommandChild {
    let sidecar = app
        .shell()
        .sidecar("doxmind-server")
        .expect("doxmind-server sidecar binary not found in resources");

    log::info!("[backend] starting bundled sidecar on port {port}");

    let (_rx, child) = sidecar
        .env("HOST", "127.0.0.1")
        .env("PORT", port.to_string())
        .spawn()
        .expect("failed to spawn doxmind-server sidecar");
    child
}

struct BackendUrl(String);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadResultDto {
    /// Backward-compatible editor HTML field for existing callers.
    html: String,
    editor_html: String,
    browsing_html: String,
    markdown: String,
    meta: DocMeta,
    extras: Option<serde_json::Value>,
    correlation: Option<serde_json::Value>,
    source: String,
    source_state: String,
    outline: Vec<DocumentOutlineItem>,
    browsing_renderer_version: String,
}

impl From<ReadResult> for ReadResultDto {
    fn from(result: ReadResult) -> Self {
        Self {
            html: result.html,
            editor_html: result.editor_html,
            browsing_html: result.browsing_html,
            markdown: result.markdown,
            meta: result.meta,
            extras: result.extras,
            correlation: result.correlation,
            source: legacy_source_name(result.source).to_string(),
            source_state: source_state_name(result.source_state).to_string(),
            outline: result.outline,
            browsing_renderer_version: result.browsing_renderer_version,
        }
    }
}

fn legacy_source_name(source: Source) -> &'static str {
    match source {
        Source::Sidecar => "sidecar",
        Source::Markdown => "markdown",
        Source::Empty => "empty",
    }
}

fn source_state_name(source_state: SourceState) -> &'static str {
    match source_state {
        SourceState::SidecarFresh => "sidecar_fresh",
        SourceState::SidecarStale => "sidecar_stale",
        SourceState::SidecarMissing => "sidecar_missing",
        SourceState::SidecarCorrupt => "sidecar_corrupt",
        SourceState::Empty => "empty",
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocWritePayloadDto {
    html: String,
    markdown: String,
    meta: DocMeta,
    extras: Option<serde_json::Value>,
}

impl From<DocWritePayloadDto> for DocPayload {
    fn from(payload: DocWritePayloadDto) -> Self {
        Self {
            html: payload.html,
            markdown: payload.markdown,
            meta: payload.meta,
            extras: payload.extras,
        }
    }
}

/// Partial payload accepted by [`doc_write_workspace`]. The server merges
/// any missing fields against the existing sidecar so a single round-trip
/// suffices for the editor's "save" flow.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocWriteInputDto {
    #[serde(default)]
    html: Option<String>,
    #[serde(default)]
    markdown: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    meta: Option<serde_json::Value>,
    #[serde(default)]
    extras: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceScanResultDto {
    root: String,
    documents: Vec<WorkspaceDocumentDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceDocumentDto {
    id: String,
    id_source: String,
    path: String,
    name: String,
    title: Option<String>,
    document_type: String,
    has_sidecar: bool,
    // Frontmatter-sourced display metadata. These ride along on the scan
    // result so the workspace list can render icons, covers, and favorite
    // stars without an extra per-file read on the client.
    #[serde(skip_serializing_if = "Option::is_none")]
    icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cover: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cover_position: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    favorite: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WorkspaceIndexDto {
    version: u32,
    ids: BTreeMap<String, String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownSearchResultDto {
    id: String,
    path: String,
    name: String,
    title: Option<String>,
    matches: Vec<MarkdownSearchMatchDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownSearchMatchDto {
    line: usize,
    preview: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocCreatePayloadDto {
    path: String,
    html: String,
    markdown: String,
    meta: DocMeta,
    extras: Option<serde_json::Value>,
}

impl From<DocCreatePayloadDto> for DocPayload {
    fn from(payload: DocCreatePayloadDto) -> Self {
        Self {
            html: payload.html,
            markdown: payload.markdown,
            meta: payload.meta,
            extras: payload.extras,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeleteResultDto {
    path: String,
    sidecar_path: Option<String>,
}

// `doc_move` accepts either a Document path or a Folder path. The two cases
// return slightly different shapes — documents carry the full DTO so the
// frontend can refresh metadata in-place; folders only need to confirm the
// new path. The discriminator field keeps callers honest about which payload
// they're deserialising.
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum MoveResultDto {
    #[serde(rename = "document")]
    Document(WorkspaceDocumentDto),
    #[serde(rename = "folder")]
    Folder { path: String },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetImportResultDto {
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DialogFileFilterDto {
    name: String,
    extensions: Vec<String>,
}

fn dialog_path_to_string(path: FilePath) -> Result<String, String> {
    path.into_path()
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|err| format!("failed to resolve selected path: {err}"))
}

#[tauri::command]
fn get_backend_url(state: tauri::State<'_, BackendUrl>) -> String {
    state.0.clone()
}

#[tauri::command]
async fn pick_workspace_folder(
    app: AppHandle,
    title: Option<String>,
) -> Result<Option<String>, String> {
    let mut dialog = app.dialog().file();
    if let Some(title) = title {
        dialog = dialog.set_title(title);
    }
    dialog
        .blocking_pick_folder()
        .map(dialog_path_to_string)
        .transpose()
}

#[tauri::command]
async fn pick_workspace_file(
    app: AppHandle,
    title: Option<String>,
    filters: Option<Vec<DialogFileFilterDto>>,
) -> Result<Option<String>, String> {
    let mut dialog = app.dialog().file();
    if let Some(title) = title {
        dialog = dialog.set_title(title);
    }
    if let Some(filters) = filters {
        for filter in filters {
            let extensions = filter
                .extensions
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>();
            dialog = dialog.add_filter(filter.name, &extensions);
        }
    }
    dialog
        .blocking_pick_file()
        .map(dialog_path_to_string)
        .transpose()
}

#[tauri::command]
async fn pick_save_location(
    app: AppHandle,
    title: Option<String>,
    default_name: Option<String>,
    filters: Option<Vec<DialogFileFilterDto>>,
) -> Result<Option<String>, String> {
    let mut dialog = app.dialog().file();
    if let Some(title) = title {
        dialog = dialog.set_title(title);
    }
    if let Some(name) = default_name {
        dialog = dialog.set_file_name(name);
    }
    if let Some(filters) = filters {
        for filter in filters {
            let extensions = filter
                .extensions
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>();
            dialog = dialog.add_filter(filter.name, &extensions);
        }
    }
    dialog
        .blocking_save_file()
        .map(dialog_path_to_string)
        .transpose()
}

#[tauri::command]
fn workspace_default_root() -> Result<String, String> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "HOME is not set; cannot create default workspace".to_string())?;
    let root = home.join("Documents").join("doXmind");
    fs::create_dir_all(&root)
        .map_err(|err| format!("failed to create default workspace: {err}"))?;
    fs::canonicalize(&root)
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|err| format!("failed to resolve default workspace: {err}"))
}

#[tauri::command]
async fn doc_read(path: String) -> Result<ReadResultDto, String> {
    let path = PathBuf::from(path);
    if is_html_file(&path) {
        let mut result = doxmind_sidecar::read_html_doc(&path)
            .await
            .map_err(|err| err.to_string())?;
        // HTML id is path-derived + stable (see html_doc_id); overriding here
        // keeps it identical across read/scan/write so the client never sees
        // the document "switch" on save.
        result.meta.id = html_doc_id(&path);
        return Ok(ReadResultDto::from(result));
    }
    doxmind_sidecar::read_doc(path)
        .await
        .map(ReadResultDto::from)
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn doc_write(path: String, payload: DocWritePayloadDto) -> Result<(), String> {
    doxmind_sidecar::write_doc(PathBuf::from(path), &DocPayload::from(payload))
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn doc_write_workspace(
    root: String,
    path: String,
    payload: DocWriteInputDto,
) -> Result<ReadResultDto, String> {
    let root = canonical_workspace_root(&root)?;
    if is_html_file(Path::new(&path)) {
        return doc_write_workspace_html(&root, &path, payload).await;
    }
    ensure_markdown_path(&path)?;
    let path = resolve_workspace_path_for_write(&root, &path)?;

    // Merge incoming meta with the existing sidecar/frontmatter so callers
    // can send partial payloads. Falling through to read_doc here is cheap
    // (one file read) and saves the client an extra IPC round-trip. Also
    // capture html/markdown so meta-only writes (cover, icon, …) don't wipe
    // the body — without this, partial payloads would overwrite the document
    // with empty content.
    let mut existing_html: Option<String> = None;
    let mut existing_markdown: Option<String> = None;
    let mut existing_meta: Option<DocMeta> = None;
    let mut existing_extras: Option<serde_json::Value> = None;
    if path.exists() {
        if let Ok(read) = doxmind_sidecar::read_doc(&path).await {
            existing_html = Some(read.html);
            existing_markdown = Some(read.markdown);
            existing_meta = Some(read.meta);
            existing_extras = read.extras;
        }
    }

    let mut meta = match existing_meta {
        Some(m) => m,
        None => DocMeta::new(uuid::Uuid::new_v4().to_string()),
    };

    if let Some(value) = payload.meta {
        if let serde_json::Value::Object(map) = value {
            for (key, val) in map {
                match key.as_str() {
                    "id" => {
                        if let Some(id) = val.as_str() {
                            if !id.trim().is_empty() {
                                meta.id = id.to_string();
                            }
                        }
                    }
                    "title" => {
                        meta.title = val.as_str().map(String::from);
                    }
                    "icon" => {
                        meta.icon = val.as_str().map(String::from);
                    }
                    "favorite" => {
                        meta.favorite = val.as_bool();
                    }
                    "cover" => {
                        meta.cover = val.as_str().map(String::from);
                    }
                    "created" => {
                        meta.created = val.as_str().map(String::from);
                    }
                    "updated" => {
                        meta.updated = val.as_str().map(String::from);
                    }
                    _ => {
                        meta.extras.insert(key, val);
                    }
                }
            }
        }
    }

    if meta.id.trim().is_empty() {
        meta.id = uuid::Uuid::new_v4().to_string();
    }
    if let Some(name) = payload.name.as_ref() {
        if meta.title.as_deref().unwrap_or("").is_empty() {
            meta.title = Some(name.clone());
        }
    }
    meta.updated = Some(doxmind_sidecar::now_iso8601());

    let extras = payload.extras.or(existing_extras);

    // Fall back to existing sidecar content when the client doesn't include
    // html/markdown — keeps meta-only writes from clobbering the body.
    let html = payload.html.or(existing_html).unwrap_or_default();
    let markdown = payload.markdown.or(existing_markdown).unwrap_or_default();
    let doc_payload = DocPayload {
        html: html.clone(),
        markdown: markdown.clone(),
        meta: meta.clone(),
        extras: extras.clone(),
    };

    doxmind_sidecar::write_doc(&path, &doc_payload)
        .await
        .map_err(|err| err.to_string())?;

    let browsing = doxmind_sidecar::render_browsing_markdown(&markdown);
    Ok(ReadResultDto {
        html: html.clone(),
        editor_html: html.clone(),
        browsing_html: browsing.html,
        markdown,
        meta,
        extras,
        correlation: None,
        source: "sidecar".to_string(),
        source_state: "sidecar_fresh".to_string(),
        outline: browsing.outline,
        browsing_renderer_version: browsing.renderer_version,
    })
}

/// HTML branch of `doc_write_workspace`. The editor serializes the whole
/// document; it is written back verbatim (lossless round-trip). The sidecar
/// only carries the stable id and external-edit hash.
async fn doc_write_workspace_html(
    root: &Path,
    rel_path: &str,
    payload: DocWriteInputDto,
) -> Result<ReadResultDto, String> {
    ensure_html_path(rel_path)?;
    let path = resolve_workspace_path_for_write(root, rel_path)?;

    let mut incoming_title: Option<String> = None;
    if let Some(serde_json::Value::Object(map)) = payload.meta {
        if let Some(title) = map.get("title").and_then(|v| v.as_str()) {
            incoming_title = Some(title.to_string());
        }
    }

    // Deterministic path-derived id (matches read/scan) so identity is stable.
    let mut meta = DocMeta::new(html_doc_id(&path));
    meta.title = incoming_title
        .or_else(|| payload.name.clone())
        .or_else(|| path.file_stem().map(|s| s.to_string_lossy().into_owned()));
    meta.updated = Some(doxmind_sidecar::now_iso8601());

    let html = payload.html.unwrap_or_default();
    doxmind_sidecar::write_html_doc(&path, &html, &meta)
        .await
        .map_err(|err| err.to_string())?;

    let source_state = if html.trim().is_empty() {
        "empty"
    } else {
        "sidecar_fresh"
    }
    .to_string();
    let outline = doxmind_sidecar::extract_html_outline(&html);
    Ok(ReadResultDto {
        html: html.clone(),
        editor_html: html,
        browsing_html: String::new(),
        markdown: String::new(),
        meta,
        extras: None,
        correlation: None,
        source: "sidecar".to_string(),
        source_state,
        outline,
        browsing_renderer_version: doxmind_sidecar::BROWSING_RENDERER_VERSION.to_string(),
    })
}

#[tauri::command]
fn workspace_stat_binary(root: String, path: String) -> Result<serde_json::Value, String> {
    // Cheap (mtime, size) probe used by the frontend switch caches to detect
    // external edits. Bytes are NOT read; this is microseconds. mtime is
    // serialised as a decimal string because Number can't hold ns precision.
    let root = canonical_workspace_root(&root)?;
    let path = resolve_existing_workspace_path(&root, &path)?;
    if !is_pdf_file(&path) && !is_excel_file(&path) {
        return Err("binary workspace stat is only enabled for PDF and Excel files".to_string());
    }
    let meta =
        fs::metadata(&path).map_err(|err| format!("failed to stat workspace file: {err}"))?;
    let mtime_ns: u128 = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    Ok(serde_json::json!({
        "mtimeNs": mtime_ns.to_string(),
        "size": meta.len(),
    }))
}

#[tauri::command]
fn workspace_read_binary(root: String, path: String) -> Result<tauri::ipc::Response, String> {
    // Returning `tauri::ipc::Response` instead of `Vec<u8>` opts into Tauri's
    // raw-binary IPC channel: the bytes go over the bridge as an ArrayBuffer
    // instead of being JSON-stringified into a `number[]` (~5x bloat) and then
    // walked back into a `Uint8Array` on the JS side. This substantially
    // reduces JSON-IPC overhead on the binary read path; the actual gain
    // depends on file size and the dev/release build profile.
    let root = canonical_workspace_root(&root)?;
    let path = resolve_existing_workspace_path(&root, &path)?;
    if !is_pdf_file(&path) && !is_excel_file(&path) {
        return Err("binary workspace reads are only enabled for PDF and Excel files".to_string());
    }
    let bytes =
        fs::read(path).map_err(|err| format!("failed to read binary workspace file: {err}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn workspace_read_pdf_editor_state(
    root: String,
    path: String,
) -> Result<Option<serde_json::Value>, String> {
    let root = canonical_workspace_root(&root)?;
    let path = resolve_existing_workspace_path(&root, &path)?;
    if !is_pdf_file(&path) {
        return Err("PDF editor state is only enabled for PDFs".to_string());
    }
    let state = load_pdf_synthetic_sidecar(&root, &path)?;
    Ok(
        pdf_block_slot(&state.sidecar, &state.block_id)
            .and_then(|slot| slot.get("editor").cloned()),
    )
}

#[tauri::command]
fn workspace_write_pdf_editor_state(
    root: String,
    path: String,
    payload: serde_json::Value,
) -> Result<(), String> {
    let root = canonical_workspace_root(&root)?;
    let path = resolve_existing_workspace_path(&root, &path)?;
    if !is_pdf_file(&path) {
        return Err("PDF editor state is only enabled for PDFs".to_string());
    }
    update_pdf_block_slot(&root, &path, |slot| {
        slot.insert("editor".to_string(), payload);
    })
}

#[tauri::command]
fn workspace_read_pdf_doc_state(
    root: String,
    path: String,
) -> Result<Option<serde_json::Value>, String> {
    let root = canonical_workspace_root(&root)?;
    let path = resolve_existing_workspace_path(&root, &path)?;
    if !is_pdf_file(&path) {
        return Err("PDF document state is only enabled for PDFs".to_string());
    }
    let state = load_pdf_synthetic_sidecar(&root, &path)?;
    let slot = pdf_block_slot(&state.sidecar, &state.block_id);
    Ok(Some(serde_json::json!({
        "editor": slot.and_then(|slot| slot.get("editor").cloned()).unwrap_or(serde_json::Value::Null),
        "parsedCache": slot.and_then(|slot| slot.get("parsedCache").cloned()).unwrap_or(serde_json::Value::Null),
    })))
}

#[tauri::command]
fn workspace_write_pdf_parsed_cache(
    root: String,
    path: String,
    source_hash: String,
    parsed: serde_json::Value,
) -> Result<(), String> {
    let root = canonical_workspace_root(&root)?;
    let path = resolve_existing_workspace_path(&root, &path)?;
    if !is_pdf_file(&path) {
        return Err("PDF parsed cache is only enabled for PDFs".to_string());
    }
    if source_hash.trim().is_empty() {
        return Err("sourceHash is required".to_string());
    }
    update_pdf_block_slot(&root, &path, |slot| {
        slot.insert(
            "parsedCache".to_string(),
            serde_json::json!({ "sourceHash": source_hash, "parsed": parsed }),
        );
    })
}

struct PdfSyntheticSidecar {
    sidecar_path: PathBuf,
    sidecar: serde_json::Value,
    block_id: String,
    /// True when this state was synthesized from a legacy on-disk sidecar
    /// while `DOXMIND_SIDECAR_MIGRATE` was off. Mirrors Python's
    /// `Document.read_only`: subsequent writes via `update_pdf_block_slot`
    /// must fail with a `ReadOnlyDocumentError`-shaped error, and the
    /// on-disk sidecar bytes (and any `.bak`) must remain untouched.
    read_only: bool,
}

fn load_pdf_synthetic_sidecar(root: &Path, path: &Path) -> Result<PdfSyntheticSidecar, String> {
    let sidecar_path = doxmind_sidecar::sidecar_path_for(path);
    let raw = match fs::read(&sidecar_path) {
        Ok(raw) => raw,
        Err(err) if err.kind() == io::ErrorKind::NotFound => {
            // Read paths return the synthesized sidecar in-memory only; the
            // first explicit write through `update_pdf_block_slot` (or the
            // editor/parsed-cache writers) materializes it on disk. Writing
            // here would turn a read into a write-permission error on
            // read-only filesystems.
            return new_pdf_synthetic_sidecar(root, path, None, None, None, None);
        }
        Err(err) => return Err(format!("failed to read PDF sidecar: {err}")),
    };

    let mut sidecar = parse_pdf_sidecar_json(&sidecar_path, &raw)?;
    if pdf_sidecar_has_legacy_top_level(&sidecar) {
        if migration_disabled()? {
            // Mirror Python's `_synthesize_read_only_from_legacy`: expose
            // legacy editor / parsedCache content as an in-memory v2
            // sidecar, but never touch `.bak` and never rewrite the on-disk
            // sidecar. The `read_only` flag causes the next write to fail.
            return synthesize_pdf_read_only_from_legacy(root, path, sidecar_path, sidecar);
        }
        sidecar = migrate_pdf_legacy_sidecar(root, path, &sidecar_path, &raw, sidecar)?;
    }

    let block_id = ensure_pdf_block_slot(root, path, &mut sidecar)?;
    Ok(PdfSyntheticSidecar {
        sidecar_path,
        sidecar,
        block_id,
        read_only: false,
    })
}

fn update_pdf_block_slot<F>(root: &Path, path: &Path, mutate: F) -> Result<(), String>
where
    F: FnOnce(&mut serde_json::Map<String, serde_json::Value>),
{
    let mut state = load_pdf_synthetic_sidecar(root, path)?;
    if state.read_only {
        return Err(read_only_document_error(path));
    }
    let slot = pdf_block_slot_mut(&mut state.sidecar, &state.block_id)?;
    mutate(slot);
    remove_pdf_legacy_top_level(&mut state.sidecar);
    refresh_pdf_synthetic_sidecar(root, path, &mut state.sidecar)?;
    write_json_sidecar(&state.sidecar_path, &state.sidecar)
}

fn parse_pdf_sidecar_json(sidecar_path: &Path, raw: &[u8]) -> Result<serde_json::Value, String> {
    let value: serde_json::Value = match serde_json::from_slice(raw) {
        Ok(value) => value,
        Err(err) => {
            let forensic = write_pdf_forensic_copy(sidecar_path, raw)?;
            return Err(format!(
                "corrupt PDF sidecar at {}: {err}; forensic copy: {}",
                sidecar_path.display(),
                forensic.display()
            ));
        }
    };
    if !value.is_object() {
        let forensic = write_pdf_forensic_copy(sidecar_path, raw)?;
        return Err(format!(
            "corrupt PDF sidecar at {}: JSON top level is not an object; forensic copy: {}",
            sidecar_path.display(),
            forensic.display()
        ));
    }
    Ok(value)
}

fn migrate_pdf_legacy_sidecar(
    root: &Path,
    path: &Path,
    sidecar_path: &Path,
    raw: &[u8],
    legacy: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let bak_path = sidecar_path.with_file_name(format!(
        "{}.bak",
        sidecar_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(".pdf.doxmind")
    ));
    if bak_path.exists() {
        return Err(format!(
            "legacy PDF sidecar migration blocked because backup already exists: {}",
            bak_path.display()
        ));
    }
    atomic_write_bytes(&bak_path, raw)
        .map_err(|err| format!("failed to back up legacy PDF sidecar: {err}"))?;

    let migrated = build_pdf_synthetic_from_legacy(root, path, &legacy)?;

    write_json_sidecar(sidecar_path, &migrated.sidecar)?;
    Ok(migrated.sidecar)
}

/// Compose an in-memory `PdfSyntheticSidecar` from a parsed legacy sidecar
/// value WITHOUT touching the disk. Shared by the on-disk migration path
/// (which calls this then writes `.bak` + the migrated sidecar) and the
/// `DOXMIND_SIDECAR_MIGRATE=off` read-only path (which returns this and
/// writes nothing).
fn build_pdf_synthetic_from_legacy(
    root: &Path,
    path: &Path,
    legacy: &serde_json::Value,
) -> Result<PdfSyntheticSidecar, String> {
    let legacy_editor = legacy.get(PDF_LEGACY_EDITOR_KEY).cloned();
    let legacy_cache = legacy.get(PDF_LEGACY_PARSED_CACHE_KEY).cloned();
    let legacy_id = legacy
        .get("id")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string);
    let legacy_block_id = pdf_block_id_from_sidecar(legacy)?;
    let mut migrated = new_pdf_synthetic_sidecar(
        root,
        path,
        legacy_id,
        legacy_block_id,
        legacy_editor,
        legacy_cache,
    )?;

    if let Some(extras) = legacy.get("extras").and_then(|value| value.as_object()) {
        let mut preserved_extras = serde_json::Value::Object(extras.clone());
        let slot = pdf_block_slot_mut_in_extras(&mut preserved_extras, &migrated.block_id)?;
        if !slot.contains_key("editor") {
            if let Some(editor) = pdf_block_slot(&migrated.sidecar, &migrated.block_id)
                .and_then(|slot| slot.get("editor").cloned())
            {
                slot.insert("editor".to_string(), editor);
            }
        }
        if !slot.contains_key("parsedCache") {
            if let Some(cache) = pdf_block_slot(&migrated.sidecar, &migrated.block_id)
                .and_then(|slot| slot.get("parsedCache").cloned())
            {
                slot.insert("parsedCache".to_string(), cache);
            }
        }
        migrated
            .sidecar
            .as_object_mut()
            .expect("new sidecar is an object")
            .insert("extras".to_string(), preserved_extras);
    }

    Ok(migrated)
}

fn synthesize_pdf_read_only_from_legacy(
    root: &Path,
    path: &Path,
    sidecar_path: PathBuf,
    legacy: serde_json::Value,
) -> Result<PdfSyntheticSidecar, String> {
    let mut synthesized = build_pdf_synthetic_from_legacy(root, path, &legacy)?;
    // Preserve the on-disk sidecar path so callers see the real location,
    // even though no write will happen.
    synthesized.sidecar_path = sidecar_path;
    synthesized.read_only = true;
    Ok(synthesized)
}

fn new_pdf_synthetic_sidecar(
    _root: &Path,
    path: &Path,
    id_override: Option<String>,
    block_id_override: Option<String>,
    editor: Option<serde_json::Value>,
    parsed_cache: Option<serde_json::Value>,
) -> Result<PdfSyntheticSidecar, String> {
    let id = id_override.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let block_id = block_id_override.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let mut slot = serde_json::Map::new();
    if let Some(editor) = editor.filter(|value| value.is_object()) {
        slot.insert("editor".to_string(), editor);
    }
    if let Some(parsed_cache) = parsed_cache.filter(|value| value.is_object()) {
        slot.insert("parsedCache".to_string(), parsed_cache);
    }
    let src = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("document.pdf");
    let html = pdf_placeholder_line(&block_id, src);
    let markdown = format!("{html}\n");
    let sidecar = serde_json::json!({
        "version": doxmind_sidecar::SIDECAR_VERSION,
        "id": id,
        "html": html,
        "markdown_hash": synthetic_markdown_hash(&id, path, &markdown),
        "updated_at": doxmind_sidecar::now_iso8601(),
        "extras": {
            "blocks": {
                block_id.clone(): serde_json::Value::Object(slot),
            },
        },
    });
    Ok(PdfSyntheticSidecar {
        sidecar_path: doxmind_sidecar::sidecar_path_for(path),
        sidecar,
        block_id,
        read_only: false,
    })
}

fn ensure_pdf_block_slot(
    _root: &Path,
    path: &Path,
    sidecar: &mut serde_json::Value,
) -> Result<String, String> {
    let block_id =
        pdf_block_id_from_sidecar(sidecar)?.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    // Tolerate v1 markdown-shape sidecars emitted by older Python runtimes
    // and bring them up to the current version on the next explicit write.
    let needs_version_bump = match sidecar.get("version").and_then(|value| value.as_u64()) {
        None => true,
        Some(v) => v < doxmind_sidecar::SIDECAR_VERSION as u64,
    };
    if needs_version_bump {
        sidecar
            .as_object_mut()
            .expect("sidecar is an object")
            .insert(
                "version".to_string(),
                serde_json::json!(doxmind_sidecar::SIDECAR_VERSION),
            );
    }
    let src = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("document.pdf");
    if sidecar
        .get("html")
        .and_then(|value| value.as_str())
        .is_none()
    {
        sidecar
            .as_object_mut()
            .expect("sidecar is an object")
            .insert(
                "html".to_string(),
                serde_json::json!(pdf_placeholder_line(&block_id, src)),
            );
    }
    if sidecar.get("id").and_then(|value| value.as_str()).is_none() {
        sidecar
            .as_object_mut()
            .expect("sidecar is an object")
            .insert(
                "id".to_string(),
                serde_json::json!(uuid::Uuid::new_v4().to_string()),
            );
    }
    let _ = pdf_block_slot_mut(sidecar, &block_id)?;
    refresh_pdf_synthetic_sidecar(_root, path, sidecar)?;
    Ok(block_id)
}

fn refresh_pdf_synthetic_sidecar(
    _root: &Path,
    path: &Path,
    sidecar: &mut serde_json::Value,
) -> Result<(), String> {
    let id = sidecar
        .get("id")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "PDF sidecar document id is required".to_string())?
        .to_string();
    let html = sidecar
        .get("html")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    let markdown = format!("{html}\n");
    let obj = sidecar
        .as_object_mut()
        .ok_or_else(|| "PDF sidecar JSON top level is not an object".to_string())?;
    obj.insert(
        "markdown_hash".to_string(),
        serde_json::json!(synthetic_markdown_hash(&id, path, &markdown)),
    );
    obj.insert(
        "updated_at".to_string(),
        serde_json::json!(doxmind_sidecar::now_iso8601()),
    );
    Ok(())
}

fn pdf_block_slot<'a>(
    sidecar: &'a serde_json::Value,
    block_id: &str,
) -> Option<&'a serde_json::Map<String, serde_json::Value>> {
    sidecar
        .get("extras")?
        .get("blocks")?
        .get(block_id)?
        .as_object()
}

fn pdf_block_slot_mut<'a>(
    sidecar: &'a mut serde_json::Value,
    block_id: &str,
) -> Result<&'a mut serde_json::Map<String, serde_json::Value>, String> {
    let obj = sidecar
        .as_object_mut()
        .ok_or_else(|| "PDF sidecar JSON top level is not an object".to_string())?;
    let extras = obj
        .entry("extras".to_string())
        .or_insert_with(|| serde_json::json!({}));
    if !extras.is_object() {
        *extras = serde_json::json!({});
    }
    let extras_obj = extras.as_object_mut().expect("extras is an object");
    let blocks = extras_obj
        .entry("blocks".to_string())
        .or_insert_with(|| serde_json::json!({}));
    if !blocks.is_object() {
        *blocks = serde_json::json!({});
    }
    let blocks_obj = blocks.as_object_mut().expect("blocks is an object");
    // Mirror Python's OrphanPolicy.DISCARD: a Synthetic Document has exactly
    // one placeholder, so any extras.blocks key other than `block_id` is an
    // orphan slot. Without this, Rust writes preserve orphans that Python
    // reads would discard, and the on-disk shape diverges between runtimes.
    blocks_obj.retain(|key, _| key == block_id);
    let slot = blocks_obj
        .entry(block_id.to_string())
        .or_insert_with(|| serde_json::json!({}));
    if !slot.is_object() {
        *slot = serde_json::json!({});
    }
    Ok(slot.as_object_mut().expect("slot is an object"))
}

fn pdf_block_slot_mut_in_extras<'a>(
    extras: &'a mut serde_json::Value,
    block_id: &str,
) -> Result<&'a mut serde_json::Map<String, serde_json::Value>, String> {
    if !extras.is_object() {
        *extras = serde_json::json!({});
    }
    let extras_obj = extras.as_object_mut().expect("extras is an object");
    let blocks = extras_obj
        .entry("blocks".to_string())
        .or_insert_with(|| serde_json::json!({}));
    if !blocks.is_object() {
        *blocks = serde_json::json!({});
    }
    let blocks_obj = blocks.as_object_mut().expect("blocks is an object");
    blocks_obj.retain(|key, _| key == block_id);
    let slot = blocks_obj
        .entry(block_id.to_string())
        .or_insert_with(|| serde_json::json!({}));
    if !slot.is_object() {
        *slot = serde_json::json!({});
    }
    Ok(slot.as_object_mut().expect("slot is an object"))
}

fn pdf_block_id_from_sidecar(sidecar: &serde_json::Value) -> Result<Option<String>, String> {
    if let Some(html) = sidecar.get("html").and_then(|value| value.as_str()) {
        let ids = pdf_block_ids_in_html(html);
        if ids.len() > 1 {
            return Err(duplicate_placeholder_error("PDF", PDF_BLOCK_TYPE, &ids));
        }
        if let Some(id) = ids.into_iter().next() {
            return Ok(Some(id));
        }
    }
    Ok(sidecar
        .get("extras")
        .and_then(|value| value.get("blocks"))
        .and_then(|value| value.as_object())
        .and_then(|blocks| blocks.keys().next().cloned()))
}

/// Format the `len(ids) > 1` error message for markdown-shape sidecars,
/// matching Python's vocabulary in `services.synthetic_document`. Same-id
/// duplicates point at a different fix (user hand-edited a sidecar to
/// repeat an id) than different-id duplicates ("two separate blocks where
/// the schema requires one"), so the message distinguishes them.
fn duplicate_placeholder_error(runtime_label: &str, block_type: &str, ids: &[String]) -> String {
    let mut duplicate_ids: Vec<&String> = Vec::new();
    let mut seen: std::collections::BTreeSet<&String> = std::collections::BTreeSet::new();
    for id in ids {
        let count = ids.iter().filter(|other| *other == id).count();
        if count > 1 && seen.insert(id) {
            duplicate_ids.push(id);
        }
    }
    if !duplicate_ids.is_empty() {
        duplicate_ids.sort();
        let joined = duplicate_ids
            .iter()
            .map(|id| id.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        return format!(
            "markdown-shape {runtime_label} sidecar has duplicate {block_type} placeholder id(s): {joined}"
        );
    }
    format!(
        "markdown-shape {runtime_label} sidecar has multiple {block_type} placeholders; Synthetic Documents require exactly one"
    )
}

fn pdf_block_ids_in_html(html: &str) -> Vec<String> {
    let mut ids = Vec::new();
    let marker = format!("<!-- {PDF_BLOCK_TYPE} ");
    let mut rest = html;
    while let Some(start) = rest.find(&marker) {
        let after_marker = &rest[start + marker.len()..];
        if let Some(id_start) = after_marker.find("id=\"") {
            let after_id = &after_marker[id_start + 4..];
            if let Some(id_end) = after_id.find('"') {
                let id = &after_id[..id_end];
                if !id.is_empty() {
                    ids.push(id.to_string());
                }
            }
        }
        rest = after_marker;
    }
    ids
}

fn pdf_placeholder_line(block_id: &str, src: &str) -> String {
    format!(r#"<!-- {PDF_BLOCK_TYPE} id="{block_id}" src="{src}" -->"#)
}

fn synthetic_markdown_hash(id: &str, path: &Path, markdown: &str) -> String {
    let title = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled");
    let md_content = format!(
        "---\nid: {}\ntitle: {}\n---\n\n{}",
        yaml_json_string(id),
        yaml_json_string(title),
        markdown
    );
    doxmind_sidecar::hash_markdown(&md_content)
}

fn yaml_json_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

fn pdf_sidecar_has_legacy_top_level(sidecar: &serde_json::Value) -> bool {
    sidecar.get(PDF_LEGACY_EDITOR_KEY).is_some()
        || sidecar.get(PDF_LEGACY_PARSED_CACHE_KEY).is_some()
}

/// Returns `true` when `DOXMIND_SIDECAR_MIGRATE` is set to a disabled
/// value (case-insensitive, trimmed). Mirrors Python's
/// `_migration_disabled()` in `server/services/synthetic_document.py`:
///   * unset → false (migration enabled, default)
///   * one of `MIGRATE_DISABLED_VALUES` → true
///   * one of `MIGRATE_ENABLED_VALUES` → false
///   * any other value → `Err` with the same message shape as Python
///
/// Matching Python exactly is load-bearing: cross-runtime callers that
/// rely on the documented escape hatch must see identical semantics on
/// both runtimes (see CLAUDE.md and docs/adr/0003).
fn migration_disabled() -> Result<bool, String> {
    let raw = match std::env::var(MIGRATE_ENV_VAR) {
        Ok(value) => value,
        Err(std::env::VarError::NotPresent) => return Ok(false),
        Err(std::env::VarError::NotUnicode(_)) => {
            return Err(format!(
                "{MIGRATE_ENV_VAR} has invalid (non-unicode) value; accepted: \
                 {MIGRATE_DISABLED_VALUES:?} (disabled), \
                 {MIGRATE_ENABLED_VALUES:?} (enabled)"
            ));
        }
    };
    let value = raw.trim().to_ascii_lowercase();
    if MIGRATE_DISABLED_VALUES.iter().any(|v| *v == value) {
        return Ok(true);
    }
    if MIGRATE_ENABLED_VALUES.iter().any(|v| *v == value) {
        return Ok(false);
    }
    Err(format!(
        "{MIGRATE_ENV_VAR} has invalid value {raw:?}; accepted: \
         {MIGRATE_DISABLED_VALUES:?} (disabled), \
         {MIGRATE_ENABLED_VALUES:?} (enabled)"
    ))
}

/// String shape that mirrors Python's `ReadOnlyDocumentError` so the
/// frontend can match on a stable substring (`"read-only"`) regardless
/// of which runtime served the read.
fn read_only_document_error(path: &Path) -> String {
    format!(
        "document at {} is read-only ({MIGRATE_ENV_VAR}=0 against legacy sidecar)",
        path.display()
    )
}

fn remove_pdf_legacy_top_level(sidecar: &mut serde_json::Value) {
    if let Some(obj) = sidecar.as_object_mut() {
        obj.remove(PDF_LEGACY_EDITOR_KEY);
        obj.remove(PDF_LEGACY_PARSED_CACHE_KEY);
    }
}

fn write_pdf_forensic_copy(sidecar_path: &Path, raw: &[u8]) -> Result<PathBuf, String> {
    let forensic_path = sidecar_path.with_file_name(format!(
        "{}.corrupt-{}",
        sidecar_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(".pdf.doxmind"),
        unix_nanos()
    ));
    atomic_write_bytes(&forensic_path, raw)
        .map_err(|err| format!("failed to preserve corrupt PDF sidecar: {err}"))?;
    Ok(forensic_path)
}

fn write_json_sidecar(path: &Path, sidecar: &serde_json::Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(sidecar)
        .map_err(|err| format!("failed to encode PDF sidecar: {err}"))?;
    atomic_write_bytes(path, &bytes).map_err(|err| format!("failed to write PDF sidecar: {err}"))
}

#[tauri::command]
fn workspace_read_excel_editor_state(
    root: String,
    path: String,
) -> Result<Option<serde_json::Value>, String> {
    let root = canonical_workspace_root(&root)?;
    let path = resolve_existing_workspace_path(&root, &path)?;
    if !is_excel_file(&path) {
        return Err("Excel editor state is only enabled for .xlsx/.xlsm files".to_string());
    }
    read_excel_editor_state_light(&path)
}

/// Write `bytes` to `path` atomically via temp-file + rename.
///
/// Contract:
///   * The temp file is created in the **same directory** as `path` so the
///     final `fs::rename` is intra-filesystem and POSIX-atomic. Cross-device
///     renames would fail at the rename step, which is fine for our use
///     (sidecars always live next to the source they describe — see ADR
///     0001 / 0003).
///   * `sync_all()` flushes both the file contents and its metadata to
///     disk before the rename, so the rename is the only window during
///     which a crash could leave nothing-or-old (never new-with-zero-bytes).
///   * `fs::rename` is atomic on Unix (POSIX `rename(2)`) and on Windows
///     (`MoveFileEx` with `MOVEFILE_REPLACE_EXISTING`) when source and
///     destination share a volume.
///   * On error, the temp file is best-effort removed and the original
///     `path` (if any) is left untouched. Callers can safely ignore the
///     `Err` — the next call will retry without data loss. The slim-on-read
///     site does exactly that.
fn atomic_write_bytes(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no parent")
    })?;
    let stem = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("doxmind");
    let tmp = parent.join(format!(".{stem}.tmp.{}", uuid::Uuid::new_v4()));
    {
        use std::io::Write;
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    if let Err(err) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(err);
    }
    // Intentionally NOT setting FILE_ATTRIBUTE_HIDDEN on per-file sidecars
    // here: Win32 `CreateFile` with `CREATE_ALWAYS` rejects hidden files
    // with ERROR_ACCESS_DENIED, which would break external rewriters
    // (sync tools, manual edits, third-party processes using the standard
    // open-truncate-write pattern). Directory-level hiding is still
    // applied where it's safe — see `write_workspace_index`.
    Ok(())
}

/// Best-effort: set FILE_ATTRIBUTE_HIDDEN on Windows for a *directory* whose
/// name starts with `.`. Only safe for directories — see the comment in
/// `atomic_write_bytes` for why we don't hide per-file sidecars on Windows.
/// On POSIX the leading dot is already the hidden convention so this is a
/// no-op. Failures are swallowed: visibility is cosmetic, never block writes.
fn mark_hidden_if_dot_prefixed(path: &Path) {
    let starts_with_dot = path
        .file_name()
        .and_then(|s| s.to_str())
        .map(|name| name.starts_with('.'))
        .unwrap_or(false);
    if !starts_with_dot {
        return;
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            GetFileAttributesW, SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN,
        };

        // INVALID_FILE_ATTRIBUTES is documented as 0xFFFFFFFF. We inline the
        // literal because the constant's module path has shifted across
        // windows-sys versions.
        const INVALID_FILE_ATTRIBUTES: u32 = u32::MAX;

        let wide: Vec<u16> = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        // SAFETY: `wide` is a valid null-terminated UTF-16 string for the
        // lifetime of the call; the Win32 APIs take a const pointer and do
        // not retain it past return.
        unsafe {
            let attrs = GetFileAttributesW(wide.as_ptr());
            if attrs == INVALID_FILE_ATTRIBUTES {
                return;
            }
            if attrs & FILE_ATTRIBUTE_HIDDEN != 0 {
                return;
            }
            let _ = SetFileAttributesW(wide.as_ptr(), attrs | FILE_ATTRIBUTE_HIDDEN);
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path; // silence unused-variable warning on POSIX
    }
}

#[tauri::command]
fn workspace_write_excel_editor_state(
    root: String,
    path: String,
    payload: serde_json::Value,
) -> Result<(), String> {
    let root = canonical_workspace_root(&root)?;
    let path = resolve_existing_workspace_path(&root, &path)?;
    if !is_excel_file(&path) {
        return Err("Excel editor state is only enabled for .xlsx/.xlsm files".to_string());
    }
    write_excel_slot(&path, |slot| {
        slot.insert("editor".to_string(), payload);
    })
}

#[tauri::command]
fn workspace_read_excel_doc_state(
    root: String,
    path: String,
) -> Result<Option<serde_json::Value>, String> {
    let root = canonical_workspace_root(&root)?;
    let path = resolve_existing_workspace_path(&root, &path)?;
    if !is_excel_file(&path) {
        return Err("Excel document state is only enabled for .xlsx/.xlsm files".to_string());
    }
    let sidecar = load_excel_sidecar(&path)?;
    Ok(Some(serde_json::json!({
        "editor": excel_slot_field(&sidecar.sidecar, &sidecar.block_id, "editor").unwrap_or(serde_json::Value::Null),
        "parsedCache": excel_slot_field(&sidecar.sidecar, &sidecar.block_id, "parsedCache").unwrap_or(serde_json::Value::Null),
    })))
}

#[tauri::command]
fn workspace_write_excel_parsed_cache(
    root: String,
    path: String,
    source_hash: String,
    parsed: serde_json::Value,
) -> Result<(), String> {
    let root = canonical_workspace_root(&root)?;
    let path = resolve_existing_workspace_path(&root, &path)?;
    if !is_excel_file(&path) {
        return Err("Excel parsed cache is only enabled for .xlsx/.xlsm files".to_string());
    }
    if source_hash.trim().is_empty() {
        return Err("sourceHash is required".to_string());
    }
    write_excel_slot(&path, |slot| {
        slot.insert(
            "parsedCache".to_string(),
            serde_json::json!({ "sourceHash": source_hash, "parsed": parsed }),
        );
    })
}

const EXCEL_BLOCK_TYPE: &str = "excel-block";
const EXCEL_LEGACY_EDITOR_KEY: &str = "excel_editor";
const EXCEL_LEGACY_PARSED_CACHE_KEY: &str = "excel_parsed_cache";

struct ExcelSidecar {
    sidecar_path: PathBuf,
    sidecar: serde_json::Value,
    block_id: String,
    /// True when this state was synthesized from a legacy on-disk sidecar
    /// while `DOXMIND_SIDECAR_MIGRATE` was off. Mirrors Python's
    /// `Document.read_only`: subsequent writes via `write_excel_slot`
    /// must fail with a `ReadOnlyDocumentError`-shaped error, and the
    /// on-disk sidecar bytes (and any `.bak`) must remain untouched.
    read_only: bool,
}

#[derive(Deserialize)]
struct ExcelEditorOnlySidecar {
    html: Option<String>,
    extras: Option<ExcelEditorOnlyExtras>,
    #[serde(rename = "excel_editor")]
    legacy_editor: Option<serde_json::Value>,
    #[serde(rename = "excel_parsed_cache")]
    legacy_parsed_cache: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct ExcelEditorOnlyExtras {
    blocks: Option<BTreeMap<String, ExcelEditorOnlySlot>>,
}

#[derive(Deserialize)]
struct ExcelEditorOnlySlot {
    editor: Option<serde_json::Value>,
}

fn read_excel_editor_state_light(path: &Path) -> Result<Option<serde_json::Value>, String> {
    let sidecar_path = doxmind_sidecar::sidecar_path_for(path);
    let raw = match fs::read(&sidecar_path) {
        Ok(raw) => raw,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(format!("failed to read Excel sidecar: {err}")),
    };

    let sidecar: ExcelEditorOnlySidecar = match serde_json::from_slice(&raw) {
        Ok(value) => value,
        Err(err) => {
            let forensic = write_excel_forensic_copy(&sidecar_path, &raw)?;
            return Err(format!(
                "invalid Excel sidecar JSON: {err}; forensic copy: {}",
                forensic.display()
            ));
        }
    };

    if sidecar.legacy_editor.is_some() || sidecar.legacy_parsed_cache.is_some() {
        let sidecar = load_excel_sidecar(path)?;
        return Ok(excel_slot_field(
            &sidecar.sidecar,
            &sidecar.block_id,
            "editor",
        ));
    }

    let block_id = if let Some(html) = sidecar.html.as_deref() {
        let ids = excel_block_ids_in_html(html);
        if ids.len() > 1 {
            return Err(duplicate_placeholder_error("Excel", EXCEL_BLOCK_TYPE, &ids));
        }
        ids.into_iter().next()
    } else {
        None
    }
    .or_else(|| {
        sidecar
            .extras
            .as_ref()
            .and_then(|extras| extras.blocks.as_ref())
            .and_then(|blocks| blocks.keys().next().cloned())
    });

    let Some(block_id) = block_id else {
        return Ok(None);
    };
    Ok(sidecar
        .extras
        .and_then(|extras| extras.blocks)
        .and_then(|blocks| blocks.get(&block_id).and_then(|slot| slot.editor.clone()))
        .filter(|value| !value.is_null()))
}

fn load_excel_sidecar(path: &Path) -> Result<ExcelSidecar, String> {
    let sidecar_path = doxmind_sidecar::sidecar_path_for(path);
    let raw = match fs::read(&sidecar_path) {
        Ok(raw) => raw,
        Err(err) if err.kind() == io::ErrorKind::NotFound => {
            // Read paths return the synthesized sidecar in-memory only; the
            // first explicit write through `write_excel_slot` (or the editor/
            // parsed-cache writers) materializes it on disk. Writing here
            // would turn a read into a write-permission error on read-only
            // filesystems.
            let block_id = uuid::Uuid::new_v4().to_string();
            let sidecar =
                canonical_excel_sidecar(path, None, &block_id, empty_excel_extras(&block_id));
            return Ok(ExcelSidecar {
                sidecar_path,
                sidecar,
                block_id,
                read_only: false,
            });
        }
        Err(err) => return Err(format!("failed to read Excel sidecar: {err}")),
    };

    let sidecar = parse_excel_sidecar_or_forensic(&sidecar_path, &raw)?;
    if sidecar.get(EXCEL_LEGACY_EDITOR_KEY).is_some()
        || sidecar.get(EXCEL_LEGACY_PARSED_CACHE_KEY).is_some()
    {
        if migration_disabled()? {
            // Mirror Python's `_synthesize_read_only_from_legacy`: expose
            // legacy editor / parsedCache content as an in-memory v2
            // sidecar, but never touch `.bak` and never rewrite the on-disk
            // sidecar. The `read_only` flag causes the next write to fail.
            return synthesize_excel_read_only_from_legacy(path, sidecar_path, sidecar);
        }
        return migrate_legacy_excel_sidecar(path, sidecar_path, sidecar, raw);
    }

    let block_id = excel_block_id_from_sidecar(&sidecar)?.ok_or_else(|| {
        format!(
            "markdown-shape Excel sidecar at {} has no {EXCEL_BLOCK_TYPE} placeholder",
            sidecar_path.display()
        )
    })?;
    Ok(ExcelSidecar {
        sidecar_path,
        sidecar,
        block_id,
        read_only: false,
    })
}

fn migrate_legacy_excel_sidecar(
    path: &Path,
    sidecar_path: PathBuf,
    legacy: serde_json::Value,
    raw: Vec<u8>,
) -> Result<ExcelSidecar, String> {
    let bak_path = sidecar_path.with_file_name(format!(
        "{}.bak",
        sidecar_path
            .file_name()
            .map(|name| name.to_string_lossy())
            .unwrap_or_default()
    ));
    if bak_path.exists() {
        return Err(format!(
            "legacy Excel sidecar migration is blocked because a backup already exists: {}",
            bak_path.display()
        ));
    }
    atomic_write_bytes(&bak_path, &raw)
        .map_err(|err| format!("failed to write Excel sidecar migration backup: {err}"))?;

    let (block_id, migrated) = build_excel_synthetic_from_legacy(path, &legacy)?;
    write_excel_sidecar_value(&sidecar_path, &migrated).map_err(|err| {
        format!(
            "failed to migrate Excel sidecar after writing backup {}: {err}",
            bak_path.display()
        )
    })?;

    Ok(ExcelSidecar {
        sidecar_path,
        sidecar: migrated,
        block_id,
        read_only: false,
    })
}

/// Compose an in-memory v2 Excel sidecar value from a parsed legacy
/// sidecar WITHOUT touching disk. Shared by the on-disk migration path
/// and the `DOXMIND_SIDECAR_MIGRATE=off` read-only path.
fn build_excel_synthetic_from_legacy(
    path: &Path,
    legacy: &serde_json::Value,
) -> Result<(String, serde_json::Value), String> {
    let block_id = excel_block_id_from_sidecar(legacy)?
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let mut extras = extras_object(legacy);
    let existing_blocks = blocks_object_from_extras(&extras);
    let mut slot = existing_blocks
        .get(&block_id)
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();

    if !slot.contains_key("editor") {
        if let Some(editor) = legacy
            .get(EXCEL_LEGACY_EDITOR_KEY)
            .filter(|value| !value.is_null())
        {
            slot.insert("editor".to_string(), editor.clone());
        }
    }
    if !slot.contains_key("parsedCache") {
        if let Some(cache) = legacy
            .get(EXCEL_LEGACY_PARSED_CACHE_KEY)
            .filter(|value| !value.is_null())
        {
            slot.insert("parsedCache".to_string(), cache.clone());
        }
    }

    // Mirror Python's OrphanPolicy.DISCARD during legacy migration too:
    // build a fresh blocks map holding only the canonical block_id so any
    // legacy extras.blocks entry that wasn't the one referenced by the
    // placeholder is dropped at the migration boundary, not silently
    // carried into the v2 shape.
    let mut blocks = serde_json::Map::new();
    blocks.insert(block_id.clone(), serde_json::Value::Object(slot));
    extras.insert("blocks".to_string(), serde_json::Value::Object(blocks));

    let migrated = canonical_excel_sidecar(
        path,
        Some(legacy),
        &block_id,
        serde_json::Value::Object(extras),
    );
    Ok((block_id, migrated))
}

fn synthesize_excel_read_only_from_legacy(
    path: &Path,
    sidecar_path: PathBuf,
    legacy: serde_json::Value,
) -> Result<ExcelSidecar, String> {
    let (block_id, sidecar) = build_excel_synthetic_from_legacy(path, &legacy)?;
    Ok(ExcelSidecar {
        sidecar_path,
        sidecar,
        block_id,
        read_only: true,
    })
}

fn write_excel_slot<F>(path: &Path, update: F) -> Result<(), String>
where
    F: FnOnce(&mut serde_json::Map<String, serde_json::Value>),
{
    let loaded = load_excel_sidecar(path)?;
    if loaded.read_only {
        return Err(read_only_document_error(path));
    }
    let mut extras = extras_object(&loaded.sidecar);
    let existing_blocks = blocks_object_from_extras(&extras);
    let mut slot = existing_blocks
        .get(&loaded.block_id)
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();

    update(&mut slot);

    // Mirror Python's OrphanPolicy.DISCARD: drop any extras.blocks key that
    // doesn't match the canonical placeholder id; otherwise orphan slots
    // ride through Rust writes forever and the on-disk shape diverges from
    // what Python's read path produces.
    let mut blocks = serde_json::Map::new();
    blocks.insert(loaded.block_id.clone(), serde_json::Value::Object(slot));
    extras.insert("blocks".to_string(), serde_json::Value::Object(blocks));
    let next = canonical_excel_sidecar(
        path,
        Some(&loaded.sidecar),
        &loaded.block_id,
        serde_json::Value::Object(extras),
    );
    write_excel_sidecar_value(&loaded.sidecar_path, &next)
}

fn parse_excel_sidecar_or_forensic(
    sidecar_path: &Path,
    raw: &[u8],
) -> Result<serde_json::Value, String> {
    let parsed: serde_json::Value = match serde_json::from_slice(raw) {
        Ok(value) => value,
        Err(err) => {
            let forensic = write_excel_forensic_copy(sidecar_path, raw)?;
            return Err(format!(
                "invalid Excel sidecar JSON: {err}; forensic copy: {}",
                forensic.display()
            ));
        }
    };
    if !parsed.is_object() {
        let forensic = write_excel_forensic_copy(sidecar_path, raw)?;
        return Err(format!(
            "invalid Excel sidecar JSON: top level is not an object; forensic copy: {}",
            forensic.display()
        ));
    }
    Ok(parsed)
}

fn write_excel_forensic_copy(sidecar_path: &Path, raw: &[u8]) -> Result<PathBuf, String> {
    let forensic_path = sidecar_path.with_file_name(format!(
        "{}.corrupt-{}",
        sidecar_path
            .file_name()
            .map(|name| name.to_string_lossy())
            .unwrap_or_default(),
        unix_nanos()
    ));
    atomic_write_bytes(&forensic_path, raw)
        .map_err(|err| format!("failed to write Excel sidecar forensic copy: {err}"))?;
    Ok(forensic_path)
}

fn write_excel_sidecar_value(
    sidecar_path: &Path,
    sidecar: &serde_json::Value,
) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(sidecar)
        .map_err(|err| format!("failed to encode Excel sidecar: {err}"))?;
    atomic_write_bytes(sidecar_path, &bytes)
        .map_err(|err| format!("failed to write Excel sidecar: {err}"))
}

fn canonical_excel_sidecar(
    path: &Path,
    existing: Option<&serde_json::Value>,
    block_id: &str,
    extras: serde_json::Value,
) -> serde_json::Value {
    let id = existing
        .and_then(|sidecar| sidecar.get("id"))
        .and_then(|id| id.as_str())
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let rel_src = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "workbook.xlsx".to_string());
    let placeholder = excel_placeholder(block_id, &rel_src);
    let html = existing
        .and_then(|sidecar| sidecar.get("html"))
        .and_then(|html| html.as_str())
        .filter(|html| first_excel_block_id_in_html(html).as_deref() == Some(block_id))
        .unwrap_or(&placeholder)
        .to_string();
    let title = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Workbook".to_string());
    let markdown = synthetic_excel_markdown(&id, &title, &placeholder);

    serde_json::json!({
        "version": doxmind_sidecar::SIDECAR_VERSION,
        "id": id,
        "html": html,
        "markdown_hash": doxmind_sidecar::hash_markdown(&markdown),
        "updated_at": doxmind_sidecar::now_iso8601(),
        "extras": extras,
    })
}

fn synthetic_excel_markdown(id: &str, title: &str, placeholder: &str) -> String {
    format!(
        "---\nid: {}\ntitle: {}\n---\n\n{}\n",
        serde_json::to_string(id).unwrap_or_else(|_| "\"\"".to_string()),
        serde_json::to_string(title).unwrap_or_else(|_| "\"\"".to_string()),
        placeholder
    )
}

fn empty_excel_extras(block_id: &str) -> serde_json::Value {
    serde_json::json!({ "blocks": { block_id: {} } })
}

fn excel_placeholder(block_id: &str, rel_src: &str) -> String {
    format!(r#"<!-- {EXCEL_BLOCK_TYPE} id="{block_id}" src="{rel_src}" -->"#)
}

fn excel_block_id_from_sidecar(sidecar: &serde_json::Value) -> Result<Option<String>, String> {
    if let Some(html) = sidecar.get("html").and_then(|html| html.as_str()) {
        let ids = excel_block_ids_in_html(html);
        if ids.len() > 1 {
            return Err(duplicate_placeholder_error("Excel", EXCEL_BLOCK_TYPE, &ids));
        }
        if let Some(id) = ids.into_iter().next() {
            return Ok(Some(id));
        }
    }
    Ok(sidecar
        .get("extras")
        .and_then(|extras| extras.get("blocks"))
        .and_then(|blocks| blocks.as_object())
        .and_then(|blocks| blocks.keys().next().cloned()))
}

fn first_excel_block_id_in_html(html: &str) -> Option<String> {
    excel_block_ids_in_html(html).into_iter().next()
}

fn excel_block_ids_in_html(html: &str) -> Vec<String> {
    let mut ids = Vec::new();
    let mut rest = html;
    while let Some(start) = rest.find("<!--") {
        let after_start = &rest[start + 4..];
        let Some(end) = after_start.find("-->") else {
            return ids;
        };
        let comment = after_start[..end].trim();
        if comment.starts_with(EXCEL_BLOCK_TYPE) {
            if let Some(id) = html_attr(comment, "id") {
                ids.push(id);
            }
        }
        rest = &after_start[end + 3..];
    }
    ids
}

fn html_attr(input: &str, attr: &str) -> Option<String> {
    let pattern = format!(r#"{attr}=""#);
    let start = input.find(&pattern)? + pattern.len();
    let end = input[start..].find('"')?;
    let value = &input[start..start + end];
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn excel_slot_field(
    sidecar: &serde_json::Value,
    block_id: &str,
    key: &str,
) -> Option<serde_json::Value> {
    sidecar
        .get("extras")
        .and_then(|extras| extras.get("blocks"))
        .and_then(|blocks| blocks.get(block_id))
        .and_then(|slot| slot.as_object())
        .and_then(|slot| slot.get(key))
        .filter(|value| !value.is_null())
        .cloned()
}

fn extras_object(sidecar: &serde_json::Value) -> serde_json::Map<String, serde_json::Value> {
    sidecar
        .get("extras")
        .and_then(|extras| extras.as_object())
        .cloned()
        .unwrap_or_default()
}

fn blocks_object_from_extras(
    extras: &serde_json::Map<String, serde_json::Value>,
) -> serde_json::Map<String, serde_json::Value> {
    extras
        .get("blocks")
        .and_then(|blocks| blocks.as_object())
        .cloned()
        .unwrap_or_default()
}

#[tauri::command]
fn workspace_scan(root: String) -> Result<WorkspaceScanResultDto, String> {
    let root = canonical_workspace_root(&root)?;
    let mut documents = Vec::new();
    scan_workspace_dir(&root, &root, &mut documents)?;
    documents.sort_by(|a, b| a.path.cmp(&b.path));
    let index = workspace_index_from_documents(&documents);
    write_workspace_index(&root, &index)?;

    Ok(WorkspaceScanResultDto {
        root: root.to_string_lossy().into_owned(),
        documents,
    })
}

/// Normalize a raw root string into the stable key used to identify a watcher.
/// Trims a single trailing path separator so `~/x` and `~/x/` map to the same
/// watcher and don't cause a redundant drop+respawn.
fn workspace_watch_key(root: &str) -> &str {
    root.strip_suffix(std::path::MAIN_SEPARATOR)
        .unwrap_or(root)
}

/// Start watching `root` for the calling window. Replaces any existing watcher
/// for that window (opening a different folder in the same window swaps the
/// watch). A no-op early-out if the same root is already watched avoids
/// tearing down and rebuilding the OS watch on redundant calls.
#[tauri::command]
fn workspace_watch(
    app: AppHandle,
    window: WebviewWindow,
    root: String,
    watchers: tauri::State<'_, WorkspaceWatchers>,
) -> Result<(), String> {
    let label = window.label().to_string();
    let key = workspace_watch_key(&root).to_string();

    // Hold the lock across check → canonicalize → spawn → insert so a concurrent
    // watch for the same window can't slip a second watcher in between. The
    // early-out runs before canonicalizing, so a redundant re-watch never pays
    // an fs syscall and never fails just because the (already-watched) folder
    // briefly stops resolving. canonicalize and spawn only register OS state on
    // success; on error we return without mutating the map, leaving any existing
    // watcher intact.
    let mut map = watchers
        .by_label
        .lock()
        .map_err(|_| "watcher registry poisoned".to_string())?;
    if map.get(&label).map(|w| w.key.as_str()) == Some(key.as_str()) {
        return Ok(());
    }
    let canonical = canonical_workspace_root(&root)?;
    let watch = spawn_workspace_watch(&app, label.clone(), canonical, key)?;
    // Replacing the entry drops the prior watcher, which stops its drain thread.
    map.insert(label, watch);
    Ok(())
}

/// Stop watching for the calling window. Idempotent. `root` scopes the removal
/// to the watcher the caller believes is active: when the frontend swaps folder
/// A → B, the teardown for A and the setup for B race across IPC, and an A-late
/// unwatch must not tear down the freshly-installed B watcher. We match on the
/// raw caller key, so a deleted/renamed folder (whose path no longer
/// canonicalizes) still tears down precisely its own watcher and never another.
/// Window teardown uses `WorkspaceWatchers::remove` directly for unconditional
/// "stop everything" semantics.
#[tauri::command]
fn workspace_unwatch(
    window: WebviewWindow,
    root: String,
    watchers: tauri::State<'_, WorkspaceWatchers>,
) {
    watchers.remove_if_key(window.label(), workspace_watch_key(&root));
}

#[tauri::command]
fn workspace_index_rebuild(root: String) -> Result<WorkspaceIndexDto, String> {
    let root = canonical_workspace_root(&root)?;
    let index = rebuild_workspace_index(&root)?;
    write_workspace_index(&root, &index)?;
    Ok(index)
}

#[tauri::command]
fn workspace_index_read(root: String) -> Result<WorkspaceIndexDto, String> {
    let root = canonical_workspace_root(&root)?;
    read_workspace_index(&root)
}

#[tauri::command]
fn workspace_markdown_search(
    root: String,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<MarkdownSearchResultDto>, String> {
    let root = canonical_workspace_root(&root)?;
    search_workspace_markdown(&root, &query, limit)
}

#[tauri::command]
async fn doc_create(
    root: String,
    payload: DocCreatePayloadDto,
) -> Result<WorkspaceDocumentDto, String> {
    let root = canonical_workspace_root(&root)?;
    ensure_markdown_path(&payload.path)?;
    let path = resolve_workspace_path_for_write(&root, &payload.path)?;
    if path.exists() {
        return Err(format!("document already exists: {}", payload.path));
    }

    doxmind_sidecar::write_doc(&path, &DocPayload::from(payload))
        .await
        .map_err(|err| err.to_string())?;

    document_dto_for_path(&path, relative_path_string(&root, &path)?)
}

#[tauri::command]
fn doc_create_pdf(
    root: String,
    path: String,
    bytes: Vec<u8>,
) -> Result<WorkspaceDocumentDto, String> {
    let root = canonical_workspace_root(&root)?;
    ensure_pdf_path(&path)?;
    let resolved = resolve_workspace_path_for_write(&root, &path)?;
    if resolved.exists() {
        return Err(format!("document already exists: {path}"));
    }
    if let Some(parent) = resolved.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create destination directory: {err}"))?;
    }
    // Sanity-check the magic header. The frontend feeds us pdf-lib output, but
    // a corrupt blob would otherwise silently land on disk and only blow up at
    // open time.
    if !bytes.starts_with(b"%PDF-") {
        return Err("payload is not a PDF (missing %PDF- header)".into());
    }
    fs::write(&resolved, &bytes).map_err(|err| format!("failed to write PDF: {err}"))?;
    document_dto_for_path(&resolved, relative_path_string(&root, &resolved)?)
}

#[tauri::command]
fn doc_create_excel(
    root: String,
    path: String,
    bytes: Vec<u8>,
) -> Result<WorkspaceDocumentDto, String> {
    let root = canonical_workspace_root(&root)?;
    ensure_excel_path(&path)?;
    let resolved = resolve_workspace_path_for_write(&root, &path)?;
    if resolved.exists() {
        return Err(format!("document already exists: {path}"));
    }
    if let Some(parent) = resolved.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create destination directory: {err}"))?;
    }
    // .xlsx is a ZIP archive — every valid file starts with the local file
    // header signature `PK\x03\x04`. Reject anything else early so a corrupt
    // blob doesn't silently land on disk.
    if !bytes.starts_with(b"PK\x03\x04") {
        return Err("payload is not an XLSX (missing PK ZIP header)".into());
    }
    fs::write(&resolved, &bytes).map_err(|err| format!("failed to write XLSX: {err}"))?;
    document_dto_for_path(&resolved, relative_path_string(&root, &resolved)?)
}

/// External-import whitelist (extensions, lowercase, with leading dot).
/// Mirrors the frontend D2 module (`src/lib/external-import-resolver.ts`) and
/// the backend `doc_import_external` handler. The frontend rejects out-of-list
/// files before the IPC call, but we re-validate here so a misbehaving caller
/// can't smuggle a non-document file through Tauri's permission boundary.
const IMPORT_SUPPORTED_EXTENSIONS: &[&str] = &["md", "pdf", "xlsx"];

fn ensure_import_extension(name: &str) -> Result<(), String> {
    let ext = Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase());
    match ext.as_deref() {
        Some(value) if IMPORT_SUPPORTED_EXTENSIONS.contains(&value) => Ok(()),
        _ => Err(format!(
            "only .md, .pdf, .xlsx are supported for external import: {name}"
        )),
    }
}

#[tauri::command]
fn doc_import_external(
    root: String,
    src_path: Option<String>,
    bytes: Option<Vec<u8>>,
    dest_folder: Option<String>,
    name: String,
    mode: String,
) -> Result<WorkspaceDocumentDto, String> {
    // `mode`:
    //  - "create"  — refuse to overwrite (collision returns "already exists").
    //  - "replace" — overwrite the user file. The pre-existing `.doxmind`
    //                sidecar is **deliberately left untouched** so the next
    //                open trips the Stale-sidecar / Salvage path. At the FS
    //                level a Replace is indistinguishable from an external
    //                edit (CONTEXT.md "Stale sidecar" + ADR 0002).
    if mode != "create" && mode != "replace" {
        return Err(format!("unsupported import mode: {mode}"));
    }
    if name.trim().is_empty() {
        return Err("import name is required".into());
    }
    ensure_import_extension(&name)?;

    let root = canonical_workspace_root(&root)?;
    let dest_folder = dest_folder.unwrap_or_default();
    let dest_folder_clean = dest_folder.trim();
    let rel_path = if dest_folder_clean.is_empty() {
        name.clone()
    } else {
        format!("{dest_folder_clean}/{name}")
    };

    let destination = resolve_workspace_path_for_write(&root, &rel_path)?;
    if mode == "create" && destination.exists() {
        // Frontend translates this into a "File already exists; collision
        // handling ships in #69" toast. The string is matched on substring,
        // so keep "already exists" stable.
        return Err(format!("destination already exists: {rel_path}"));
    }
    if mode == "replace" && !destination.exists() {
        // Replace presupposes a pre-existing destination. If the file
        // vanished between plan and resolve, surface a clear error rather
        // than silently degrading to create — that would mask a race with
        // an external delete.
        return Err(format!(
            "destination does not exist for replace: {rel_path}"
        ));
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create destination directory: {err}"))?;
    }

    if let Some(byte_payload) = bytes {
        // Browser dev fallback path: HTML5 DataTransfer.files reaches us as
        // a byte buffer rather than a real OS path. atomic_write_bytes only
        // touches the destination file; the hidden sidecar next to it is
        // left untouched in replace mode.
        atomic_write_bytes(&destination, &byte_payload)
            .map_err(|err| format!("failed to write imported file: {err}"))?;
    } else if let Some(src) = src_path {
        let source = PathBuf::from(&src);
        if !source.is_file() {
            return Err(format!("source file does not exist: {src}"));
        }
        // `fs::copy` is the always-copy primitive: source on disk is left
        // byte-for-byte intact. In replace mode it overwrites only the user
        // file at `destination`; the hidden sidecar living next to it is
        // intentionally NOT touched.
        fs::copy(&source, &destination)
            .map_err(|err| format!("failed to copy imported file: {err}"))?;
    } else {
        return Err("doc_import_external requires either srcPath or bytes".into());
    }

    document_dto_for_path(&destination, relative_path_string(&root, &destination)?)
}

#[tauri::command]
fn doc_rename(
    root: String,
    old_path: String,
    new_path: String,
) -> Result<WorkspaceDocumentDto, String> {
    move_document_pair(&root, &old_path, &new_path)
}

// Polymorphic move: today's frontend calls this with either a document path
// (extension-checked, pair-atomic via `move_document_pair`) or a folder path
// (validated as a directory, atomic via a single `fs::rename` of the subtree
// — every nested `.md` + `.doxmind` pair travels with the parent inode).
//
// The folder path was previously only reachable via `workspace_rename_folder`;
// consolidating both into `doc_move` so the sidebar's drag-and-drop dispatch
// is a single command regardless of source kind. ADR 0005's pair-atomicity
// invariant is preserved by relying on the OS's directory rename semantics:
// either the whole subtree moves, or none of it does.
#[tauri::command]
fn doc_move(root: String, old_path: String, new_path: String) -> Result<MoveResultDto, String> {
    let canonical_root = canonical_workspace_root(&root)?;
    let source = resolve_existing_workspace_path(&canonical_root, &old_path)?;
    if source.is_dir() {
        move_folder(&canonical_root, &old_path, &new_path)?;
        Ok(MoveResultDto::Folder { path: new_path })
    } else {
        move_document_pair(&root, &old_path, &new_path).map(MoveResultDto::Document)
    }
}

fn move_folder(canonical_root: &Path, old_path: &str, new_path: &str) -> Result<(), String> {
    let source = resolve_existing_workspace_path(canonical_root, old_path)?;
    if !source.is_dir() {
        return Err(format!("folder is not a directory: {old_path}"));
    }
    let destination = resolve_workspace_path_for_write(canonical_root, new_path)?;
    if destination.exists() {
        return Err(format!("destination already exists: {new_path}"));
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create destination directory: {err}"))?;
    }
    fs::rename(&source, &destination).map_err(|err| format!("failed to move folder: {err}"))
}

#[tauri::command]
fn doc_delete(root: String, path: String) -> Result<DeleteResultDto, String> {
    let root = canonical_workspace_root(&root)?;
    let source = resolve_existing_workspace_path(&root, &path)?;
    if !source.is_file() {
        return Err(format!("document is not a file: {path}"));
    }
    if !is_workspace_document_file(&source) {
        return Err(format!(
            "document path must end in .md, .markdown, .pdf, .xlsx, or .xlsm: {path}"
        ));
    }

    let source_sidecar = doxmind_sidecar::sidecar_path_for(&source);
    let sidecar_existed = source_sidecar.exists();

    move_to_os_trash(&source).map_err(|err| format!("failed to move document to Trash: {err}"))?;

    let mut sidecar_path = None;
    if sidecar_existed {
        // Sidecar travels into Trash as a separate entry; pair atomicity is
        // captured in the user-facing Confirm copy, not enforced by the OS.
        // If the sidecar move fails, the .md is already gone — surface the
        // error so the caller knows the pair is half-deleted (the document
        // is recoverable from Trash, the sidecar is now stranded).
        move_to_os_trash(&source_sidecar)
            .map_err(|err| format!("document moved to Trash but sidecar move failed: {err}"))?;
        sidecar_path = Some(relative_path_string(&root, &source_sidecar)?);
    }

    Ok(DeleteResultDto { path, sidecar_path })
}

// Production builds delegate to the platform recycle bin via the `trash` crate
// (macOS Trash / Windows Recycle Bin). Unit tests use an `fs::remove_*` shim
// so the test harness doesn't spam the developer's real Trash with fixtures —
// the contract being tested is "the file leaves the workspace", not "the file
// is in the OS recycle bin"; the latter is exercised manually and in CI smoke.
#[cfg(not(test))]
fn move_to_os_trash(path: &Path) -> Result<(), String> {
    trash::delete(path).map_err(|err| err.to_string())
}

#[cfg(test)]
fn move_to_os_trash(path: &Path) -> Result<(), String> {
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|err| err.to_string())
    } else {
        fs::remove_file(path).map_err(|err| err.to_string())
    }
}

#[tauri::command]
fn workspace_create_folder(root: String, path: String) -> Result<(), String> {
    let root = canonical_workspace_root(&root)?;
    let destination = resolve_workspace_path_for_write(&root, &path)?;
    if destination.exists() {
        return Err(format!("folder already exists: {path}"));
    }
    fs::create_dir_all(&destination).map_err(|err| format!("failed to create folder: {err}"))
}

#[tauri::command]
fn workspace_rename_folder(root: String, old_path: String, new_path: String) -> Result<(), String> {
    let root = canonical_workspace_root(&root)?;
    move_folder(&root, &old_path, &new_path)
}

#[tauri::command]
fn workspace_delete_folder(root: String, path: String) -> Result<DeleteResultDto, String> {
    let root = canonical_workspace_root(&root)?;
    let source = resolve_existing_workspace_path(&root, &path)?;
    if !source.is_dir() {
        return Err(format!("folder is not a directory: {path}"));
    }
    move_to_os_trash(&source).map_err(|err| format!("failed to move folder to Trash: {err}"))?;
    Ok(DeleteResultDto {
        path,
        sidecar_path: None,
    })
}

#[tauri::command]
fn workspace_import_asset(
    root: String,
    document_path: String,
    filename: String,
    bytes: Vec<u8>,
) -> Result<AssetImportResultDto, String> {
    let root = canonical_workspace_root(&root)?;
    ensure_markdown_path(&document_path)?;
    let document = resolve_existing_workspace_path(&root, &document_path)?;
    if !document.is_file() {
        return Err(format!("document is not a file: {document_path}"));
    }
    if bytes.is_empty() {
        return Err("asset is empty".into());
    }

    let safe_name = sanitize_asset_filename(&filename);
    let assets_dir = document
        .parent()
        .ok_or_else(|| format!("document path has no parent: {document_path}"))?
        .join("assets");
    fs::create_dir_all(&assets_dir)
        .map_err(|err| format!("failed to create assets directory: {err}"))?;
    let destination = unique_asset_path(&assets_dir, &safe_name);
    fs::write(&destination, bytes).map_err(|err| format!("failed to write asset: {err}"))?;

    Ok(AssetImportResultDto {
        path: format!(
            "./assets/{}",
            destination
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or(safe_name)
        ),
    })
}

fn canonical_workspace_root(root: &str) -> Result<PathBuf, String> {
    if root.trim().is_empty() {
        return Err("workspace root is required".into());
    }
    let root =
        fs::canonicalize(root).map_err(|err| format!("failed to resolve workspace root: {err}"))?;
    if !root.is_dir() {
        return Err(format!(
            "workspace root is not a directory: {}",
            root.display()
        ));
    }
    Ok(root)
}

fn validate_relative_path(path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("document path is required".into());
    }

    let input = Path::new(path);
    if input.is_absolute() {
        return Err(format!("document path must be relative: {path}"));
    }

    let mut clean = PathBuf::new();
    for component in input.components() {
        match component {
            Component::Normal(part) => clean.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!("document path escapes workspace root: {path}"));
            }
        }
    }

    if clean.as_os_str().is_empty() {
        return Err("document path is required".into());
    }

    Ok(clean)
}

fn ensure_markdown_path(path: &str) -> Result<(), String> {
    let extension = Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase());
    match extension.as_deref() {
        Some("md") | Some("markdown") => Ok(()),
        _ => Err(format!(
            "document path must end in .md or .markdown: {path}"
        )),
    }
}

fn ensure_html_path(path: &str) -> Result<(), String> {
    let extension = Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase());
    match extension.as_deref() {
        Some("html") | Some("htm") => Ok(()),
        _ => Err(format!("document path must end in .html or .htm: {path}")),
    }
}

fn ensure_pdf_path(path: &str) -> Result<(), String> {
    let extension = Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase());
    match extension.as_deref() {
        Some("pdf") => Ok(()),
        _ => Err(format!("document path must end in .pdf: {path}")),
    }
}

fn ensure_excel_path(path: &str) -> Result<(), String> {
    let extension = Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase());
    match extension.as_deref() {
        Some("xlsx") | Some("xlsm") => Ok(()),
        _ => Err(format!("document path must end in .xlsx or .xlsm: {path}")),
    }
}

/// The lowercased extension of a workspace document, or an error if the path
/// isn't a supported document type. Unlike `ensure_markdown_path`, this accepts
/// every first-class type so PDF/Excel can be renamed and moved too.
fn workspace_document_extension(path: &str) -> Result<String, String> {
    let extension = Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "md" | "markdown" | "html" | "htm" | "pdf" | "xlsx" | "xlsm" => Ok(extension),
        _ => Err(format!(
            "document path must end in .md, .markdown, .html, .htm, .pdf, .xlsx, or .xlsm: {path}"
        )),
    }
}

/// A rename or in-place move may target any document type, but must never
/// change the file's type — the destination keeps the source's extension so a
/// `.pdf` can't silently become a `.md`. Legitimate callers (sidebar rename,
/// drag-move) always preserve the extension; this guards a malformed request.
fn ensure_same_document_extension(old_path: &str, new_path: &str) -> Result<(), String> {
    let old_ext = workspace_document_extension(old_path)?;
    let new_ext = workspace_document_extension(new_path)?;
    if old_ext != new_ext {
        return Err(format!(
            "cannot change document type on move: {old_path} -> {new_path}"
        ));
    }
    Ok(())
}

fn resolve_existing_workspace_path(root: &Path, path: &str) -> Result<PathBuf, String> {
    let relative = validate_relative_path(path)?;
    let candidate = root.join(relative);
    let canonical = fs::canonicalize(&candidate)
        .map_err(|err| format!("failed to resolve document path: {err}"))?;
    ensure_path_within_root(root, &canonical)?;
    Ok(candidate)
}

fn resolve_workspace_path_for_write(root: &Path, path: &str) -> Result<PathBuf, String> {
    let relative = validate_relative_path(path)?;
    let candidate = root.join(relative);

    if candidate.exists() {
        let canonical = fs::canonicalize(&candidate)
            .map_err(|err| format!("failed to resolve document path: {err}"))?;
        ensure_path_within_root(root, &canonical)?;
        return Ok(candidate);
    }

    let parent = candidate
        .parent()
        .ok_or_else(|| format!("document path has no parent: {path}"))?;
    let mut nearest = parent;
    while !nearest.exists() {
        nearest = nearest
            .parent()
            .ok_or_else(|| format!("document path escapes workspace root: {path}"))?;
    }
    let canonical_parent = fs::canonicalize(nearest)
        .map_err(|err| format!("failed to resolve destination parent: {err}"))?;
    ensure_path_within_root(root, &canonical_parent)?;

    Ok(candidate)
}

fn ensure_path_within_root(root: &Path, path: &Path) -> Result<(), String> {
    if path.starts_with(root) {
        Ok(())
    } else {
        Err(format!(
            "path escapes workspace root: {}",
            path.to_string_lossy()
        ))
    }
}

fn scan_workspace_dir(
    root: &Path,
    dir: &Path,
    documents: &mut Vec<WorkspaceDocumentDto>,
) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|err| format!("failed to read directory: {err}"))? {
        let entry = entry.map_err(|err| format!("failed to read directory entry: {err}"))?;
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().into_owned();
        let file_type = entry
            .file_type()
            .map_err(|err| format!("failed to inspect file type: {err}"))?;

        if file_type.is_dir() {
            if is_ignored_scan_dir(&file_name) {
                continue;
            }
            scan_workspace_dir(root, &path, documents)?;
            continue;
        }

        if !file_type.is_file()
            || is_hidden_sidecar_name(&file_name)
            || !is_workspace_document_file(&path)
        {
            continue;
        }

        documents.push(document_dto_for_path(
            &path,
            relative_path_string(root, &path)?,
        )?);
    }
    Ok(())
}

fn collect_workspace_markdown_paths(
    root: &Path,
    dir: &Path,
    paths: &mut Vec<PathBuf>,
) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|err| format!("failed to read directory: {err}"))? {
        let entry = entry.map_err(|err| format!("failed to read directory entry: {err}"))?;
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().into_owned();
        let file_type = entry
            .file_type()
            .map_err(|err| format!("failed to inspect file type: {err}"))?;

        if file_type.is_dir() {
            if is_ignored_scan_dir(&file_name) {
                continue;
            }
            collect_workspace_markdown_paths(root, &path, paths)?;
            continue;
        }

        if file_type.is_file() && !is_hidden_sidecar_name(&file_name) && is_markdown_file(&path) {
            ensure_path_within_root(root, &path)?;
            paths.push(path);
        }
    }
    Ok(())
}

fn is_ignored_scan_dir(name: &str) -> bool {
    is_hidden_sidecar_name(name)
        || matches!(
            name,
            ".git" | "node_modules" | "target" | ".next" | "out" | "dist" | "build"
        )
}

fn is_hidden_sidecar_name(name: &str) -> bool {
    name.starts_with('.') && name.ends_with(".doxmind")
}

fn is_markdown_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "md" | "markdown"))
        .unwrap_or(false)
}

fn is_pdf_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false)
}

fn is_excel_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let lowered = ext.to_ascii_lowercase();
            matches!(lowered.as_str(), "xlsx" | "xlsm")
        })
        .unwrap_or(false)
}

fn is_html_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let lowered = ext.to_ascii_lowercase();
            matches!(lowered.as_str(), "html" | "htm")
        })
        .unwrap_or(false)
}

fn is_workspace_document_file(path: &Path) -> bool {
    is_markdown_file(path) || is_html_file(path) || is_pdf_file(path) || is_excel_file(path)
}

fn document_dto_for_path(
    path: &Path,
    relative_path: String,
) -> Result<WorkspaceDocumentDto, String> {
    let document_type = if is_pdf_file(path) {
        "pdf"
    } else if is_excel_file(path) {
        "excel"
    } else if is_html_file(path) {
        "html"
    } else {
        "markdown"
    }
    .to_string();
    let (id, id_source, title, scan_meta) = if document_type == "markdown" {
        let raw = fs::read_to_string(path)
            .map_err(|err| format!("failed to read markdown document for scan: {err}"))?;
        let meta = parse_frontmatter_scan_fields(&raw);
        match meta.id.clone() {
            Some(id) => (id, "frontmatter".to_string(), meta.title.clone(), meta),
            None => (
                stable_path_id(&relative_path),
                "path".to_string(),
                meta.title.clone(),
                meta,
            ),
        }
    } else if document_type == "html" {
        // Match read/write: canonical path-derived id, stable across the three.
        (
            html_doc_id(path),
            "path".to_string(),
            path.file_stem()
                .map(|name| name.to_string_lossy().into_owned()),
            ScanFrontmatter::default(),
        )
    } else {
        (
            stable_path_id(&relative_path),
            "path".to_string(),
            path.file_stem()
                .map(|name| name.to_string_lossy().into_owned()),
            ScanFrontmatter::default(),
        )
    };

    Ok(WorkspaceDocumentDto {
        id,
        id_source,
        path: relative_path,
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        title,
        document_type,
        has_sidecar: doxmind_sidecar::sidecar_path_for(path).exists(),
        icon: scan_meta.icon,
        cover: scan_meta.cover,
        cover_position: scan_meta.cover_position,
        favorite: scan_meta.favorite,
    })
}

#[derive(Debug, Default, Clone)]
struct ScanFrontmatter {
    id: Option<String>,
    title: Option<String>,
    icon: Option<String>,
    cover: Option<String>,
    cover_position: Option<f64>,
    favorite: Option<bool>,
}

fn parse_frontmatter_scan_fields(raw: &str) -> ScanFrontmatter {
    let mut out = ScanFrontmatter::default();
    let mut lines = raw.lines();
    if !matches!(lines.next().map(str::trim), Some("---")) {
        return out;
    }

    for line in lines {
        if line.trim() == "---" {
            break;
        }
        if out.id.is_none() {
            out.id = parse_yaml_scalar(line, "id");
        }
        if out.title.is_none() {
            out.title = parse_yaml_scalar(line, "title");
        }
        if out.icon.is_none() {
            out.icon = parse_yaml_scalar(line, "icon");
        }
        if out.cover.is_none() {
            out.cover = parse_yaml_scalar(line, "cover");
        }
        if out.cover_position.is_none() {
            // Editor sends snake_case (`cover_position`), legacy docs may use
            // camelCase (`coverPosition`). Accept both for forward-compat.
            out.cover_position = parse_yaml_scalar(line, "cover_position")
                .or_else(|| parse_yaml_scalar(line, "coverPosition"))
                .and_then(|v| v.parse::<f64>().ok());
        }
        if out.favorite.is_none() {
            out.favorite = parse_yaml_scalar(line, "favorite").and_then(|v| match v.as_str() {
                "true" => Some(true),
                "false" => Some(false),
                _ => None,
            });
        }
    }

    out
}

fn parse_yaml_scalar(line: &str, key: &str) -> Option<String> {
    let trimmed = line.trim_start();
    let value = trimmed.strip_prefix(key)?.strip_prefix(':')?.trim();
    if value.is_empty() {
        return None;
    }
    let unquoted = value
        .trim_matches('"')
        .trim_matches('\'')
        .trim()
        .to_string();
    if unquoted.is_empty() || unquoted == "null" || unquoted == "~" {
        return None;
    }
    Some(unquoted)
}

fn stable_path_id(path: &str) -> String {
    // FNV-1a is enough here: this is a deterministic temporary scan id, not
    // a security boundary or canonical document identity.
    let mut hash = 0xcbf29ce484222325u64;
    for byte in path.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("path:{hash:016x}")
}

/// Deterministic id for an HTML document, derived from its canonical absolute
/// path. HTML has no frontmatter to hold a portable id, so the path is the
/// identity; canonicalizing keeps scan/read/write agreeing even when the path
/// reaches them through a symlink. Mirrors `html_doc_id` in the Python sidecar.
fn html_doc_id(path: &Path) -> String {
    let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    stable_path_id(&canonical.to_string_lossy())
}

fn rebuild_workspace_index(root: &Path) -> Result<WorkspaceIndexDto, String> {
    let mut paths = Vec::new();
    collect_workspace_markdown_paths(root, root, &mut paths)?;
    paths.sort_by_key(|p| relative_path_string(root, p));

    let mut ids = BTreeMap::new();
    for path in paths {
        let raw = fs::read_to_string(&path)
            .map_err(|err| format!("failed to read markdown document for index: {err}"))?;
        if let Some(id) = parse_frontmatter_scan_fields(&raw).id {
            ids.entry(id).or_insert(relative_path_string(root, &path)?);
        }
    }

    Ok(WorkspaceIndexDto { version: 1, ids })
}

fn workspace_index_from_documents(documents: &[WorkspaceDocumentDto]) -> WorkspaceIndexDto {
    let mut ids = BTreeMap::new();
    for doc in documents {
        if doc.document_type == "markdown" && doc.id_source == "frontmatter" {
            ids.entry(doc.id.clone())
                .or_insert_with(|| doc.path.clone());
        }
    }
    WorkspaceIndexDto { version: 1, ids }
}

fn workspace_index_path(root: &Path) -> PathBuf {
    root.join(".doxmind").join("index.json")
}

fn write_workspace_index(root: &Path, index: &WorkspaceIndexDto) -> Result<(), String> {
    let path = workspace_index_path(root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create workspace index directory: {err}"))?;
        // The parent directory is `.doxmind/`. Its leading dot hides it on
        // POSIX but not on Windows; flip FILE_ATTRIBUTE_HIDDEN so the workspace
        // doesn't grow a visible doXmind folder next to the user's documents.
        mark_hidden_if_dot_prefixed(parent);
    }
    let raw = serde_json::to_string_pretty(index)
        .map_err(|err| format!("failed to serialize workspace index: {err}"))?;
    if path.exists() {
        let existing = fs::read_to_string(&path)
            .map_err(|err| format!("failed to read existing workspace index: {err}"))?;
        if existing == raw {
            return Ok(());
        }
    }
    fs::write(&path, raw).map_err(|err| format!("failed to write workspace index: {err}"))
}

fn read_workspace_index(root: &Path) -> Result<WorkspaceIndexDto, String> {
    let path = workspace_index_path(root);
    if !path.exists() {
        return Ok(WorkspaceIndexDto {
            version: 1,
            ids: BTreeMap::new(),
        });
    }
    let raw =
        fs::read_to_string(path).map_err(|err| format!("failed to read workspace index: {err}"))?;
    let index: WorkspaceIndexDto = serde_json::from_str(&raw)
        .map_err(|err| format!("failed to parse workspace index: {err}"))?;
    if index.version != 1 {
        return Err(format!(
            "unsupported workspace index version: {}",
            index.version
        ));
    }
    validate_workspace_index_paths(root, &index)?;
    Ok(index)
}

fn validate_workspace_index_paths(root: &Path, index: &WorkspaceIndexDto) -> Result<(), String> {
    for path in index.ids.values() {
        ensure_markdown_path(path)?;
        let candidate = resolve_workspace_path_for_write(root, path)?;
        ensure_path_within_root(root, &candidate)?;
    }
    Ok(())
}

fn search_workspace_markdown(
    root: &Path,
    query: &str,
    limit: Option<usize>,
) -> Result<Vec<MarkdownSearchResultDto>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("search query is required".into());
    }

    let max_results = cmp::min(limit.unwrap_or(50), 200);
    if max_results == 0 {
        return Ok(Vec::new());
    }

    let mut paths = Vec::new();
    collect_workspace_markdown_paths(root, root, &mut paths)?;
    paths.sort_by_key(|p| relative_path_string(root, p));

    let needle = query.to_lowercase();
    let mut results = Vec::new();
    for path in paths {
        let raw = fs::read_to_string(&path)
            .map_err(|err| format!("failed to read markdown document for search: {err}"))?;
        let relative_path = relative_path_string(root, &path)?;
        let matches = markdown_line_matches(&raw, &needle);
        if matches.is_empty() {
            continue;
        }
        let meta = parse_frontmatter_scan_fields(&raw);
        let id = meta
            .id
            .clone()
            .unwrap_or_else(|| stable_path_id(&relative_path));

        results.push(MarkdownSearchResultDto {
            id,
            path: relative_path,
            name: path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default(),
            title: meta.title,
            matches,
        });

        if results.len() >= max_results {
            break;
        }
    }

    Ok(results)
}

fn markdown_line_matches(raw: &str, needle: &str) -> Vec<MarkdownSearchMatchDto> {
    raw.lines()
        .enumerate()
        .filter(|(_, line)| line.to_lowercase().contains(needle))
        .take(3)
        .map(|(index, line)| MarkdownSearchMatchDto {
            line: index + 1,
            preview: compact_search_preview(line),
        })
        .collect()
}

fn compact_search_preview(line: &str) -> String {
    let trimmed = line.trim();
    const MAX_CHARS: usize = 160;
    if trimmed.chars().count() <= MAX_CHARS {
        return trimmed.to_string();
    }
    trimmed.chars().take(MAX_CHARS).collect::<String>()
}

fn move_document_pair(
    root: &str,
    old_path: &str,
    new_path: &str,
) -> Result<WorkspaceDocumentDto, String> {
    let root = canonical_workspace_root(root)?;
    ensure_same_document_extension(old_path, new_path)?;

    let source = resolve_existing_workspace_path(&root, old_path)?;
    if !source.is_file() {
        return Err(format!("document is not a file: {old_path}"));
    }

    let destination = resolve_workspace_path_for_write(&root, new_path)?;
    if destination.exists() {
        return Err(format!("destination already exists: {new_path}"));
    }

    let source_sidecar = doxmind_sidecar::sidecar_path_for(&source);
    let destination_sidecar = doxmind_sidecar::sidecar_path_for(&destination);
    if destination_sidecar.exists() {
        return Err(format!(
            "destination sidecar already exists: {}",
            relative_path_string(&root, &destination_sidecar)?
        ));
    }

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create destination directory: {err}"))?;
    }
    fs::rename(&source, &destination).map_err(|err| format!("failed to move document: {err}"))?;

    if source_sidecar.exists() {
        if let Some(parent) = destination_sidecar.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("failed to create sidecar destination: {err}"))?;
        }
        if let Err(err) = fs::rename(&source_sidecar, &destination_sidecar) {
            let _ = fs::rename(&destination, &source);
            return Err(format!("failed to move sidecar: {err}"));
        }
    }

    document_dto_for_path(&destination, relative_path_string(&root, &destination)?)
}

fn sanitize_asset_filename(filename: &str) -> String {
    let name = Path::new(filename)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("image");
    let cleaned = name
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string();
    if cleaned.is_empty() {
        "image".to_string()
    } else {
        cleaned
    }
}

fn unique_asset_path(assets_dir: &Path, filename: &str) -> PathBuf {
    let first = assets_dir.join(filename);
    if !first.exists() {
        return first;
    }

    let path = Path::new(filename);
    let stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("image");
    let extension = path.extension().and_then(|ext| ext.to_str());
    for counter in 2.. {
        let name = match extension {
            Some(ext) => format!("{stem} ({counter}).{ext}"),
            None => format!("{stem} ({counter})"),
        };
        let candidate = assets_dir.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!("infinite counter should always produce a unique path")
}

fn unix_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
}

fn relative_path_string(root: &Path, path: &Path) -> Result<String, String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| format!("path escapes workspace root: {}", path.display()))?;
    Ok(path_to_slash_string(relative))
}

fn path_to_slash_string(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

/// Build the editor URL with optional `?folder=` / `?file=` params encoded
/// safely. Mirrors the dev/prod webview URL resolution from `run()` so any
/// new window inherits the same backend-aware shell.
fn editor_webview_url(target: Option<&OpenTarget>) -> WebviewUrl {
    let dev_url = std::env::var("DOXMIND_DEV_URL")
        .ok()
        .filter(|s| !s.is_empty());

    if let Some(raw) = dev_url {
        let trimmed = raw.trim_end_matches('/');
        let base = format!("{trimmed}/editor/");
        match Url::parse(&base) {
            Ok(mut url) => {
                if let Some(t) = target {
                    url.query_pairs_mut().append_pair(&t.kind, &t.path);
                }
                return WebviewUrl::External(url);
            }
            Err(err) => {
                log::warn!("[webview] ignoring invalid DOXMIND_DEV_URL ({raw}): {err}");
            }
        }
    }

    // App-relative path. WebviewUrl::App takes a relative URL; we encode the
    // query with url::Url against a dummy base, then strip back to "editor/".
    if let Some(t) = target {
        let mut tmp = Url::parse("tauri://localhost/editor/").expect("static base parses");
        tmp.query_pairs_mut().append_pair(&t.kind, &t.path);
        let path_with_query = format!(
            "editor/{query}",
            query = tmp.query().map(|q| format!("?{q}")).unwrap_or_default()
        );
        WebviewUrl::App(path_with_query.into())
    } else {
        WebviewUrl::App("editor/".into())
    }
}

/// Apply the macOS-specific window styling (overlay title bar, traffic lights,
/// vibrancy). Called on every doXmind window so they all match.
#[cfg(target_os = "macos")]
fn apply_macos_window_chrome(window: &WebviewWindow) {
    if let Err(err) = apply_vibrancy(
        window,
        NSVisualEffectMaterial::Sidebar,
        Some(NSVisualEffectState::Active),
        None,
    ) {
        log::warn!("[window] failed to apply macOS vibrancy: {err}");
    }
}

/// Create a new editor window. The first window uses the fixed label "main"
/// so legacy lookups (tray menu, etc.) still find it; subsequent windows
/// use unique `doc-N` labels supplied by the registry.
fn create_editor_window(
    app: &AppHandle,
    label: &str,
    target: Option<OpenTarget>,
    init_script: &str,
) -> tauri::Result<WebviewWindow> {
    if let Some(existing) = app.get_webview_window(label) {
        return Ok(existing);
    }

    let webview_url = editor_webview_url(target.as_ref());
    let mut builder = WebviewWindowBuilder::new(app, label, webview_url)
        .title("doXmind")
        .inner_size(1400.0, 900.0)
        .min_inner_size(900.0, 600.0)
        .resizable(true)
        .initialization_script(init_script);

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .traffic_light_position(LogicalPosition::new(12.0, 30.0))
            .hidden_title(true)
            .transparent(true);
    }

    let window = builder.build()?;

    // Pre-register the window's intended target so that a concurrent
    // `focus_or_open_window` from the dock menu sees it immediately, even
    // before the JS side calls `register_window_target` after boot.
    if let Some(t) = target {
        if let Some(registry) = app.try_state::<WindowRegistry>() {
            registry.set(label, t);
        }
    }

    // Native close semantics: the red traffic light destroys the window. On
    // macOS the app stays resident in the dock even after the last window
    // closes; `RunEvent::Reopen` below brings a fresh window back when the
    // user clicks the dock icon. Freeing the label on destroy lets the same
    // folder be reopened later under a clean label.
    let owned_label = label.to_string();
    let close_handle = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Destroyed = event {
            if let Some(registry) = close_handle.try_state::<WindowRegistry>() {
                registry.clear(&owned_label);
            }
            // Drop this window's filesystem watcher so it stops emitting into a
            // dead window and the OS watch is released.
            if let Some(watchers) = close_handle.try_state::<WorkspaceWatchers>() {
                watchers.remove(&owned_label);
            }
        }
    });

    #[cfg(target_os = "macos")]
    apply_macos_window_chrome(&window);

    let _ = window.show();
    let _ = window.set_focus();

    Ok(window)
}

#[tauri::command]
fn open_window_for_target(
    app: AppHandle,
    target: OpenTarget,
    registry: tauri::State<'_, WindowRegistry>,
    init_script: tauri::State<'_, InitScript>,
) -> Result<String, String> {
    if let Some(label) = registry.find_label(&target) {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
            return Ok(label);
        }
        // Stale entry — drop it and fall through to create a fresh window.
        registry.clear(&label);
    }

    let label = registry.next_label();
    create_editor_window(&app, &label, Some(target), &init_script.0).map_err(|e| e.to_string())?;
    Ok(label)
}

#[tauri::command]
fn open_new_window(
    app: AppHandle,
    registry: tauri::State<'_, WindowRegistry>,
    init_script: tauri::State<'_, InitScript>,
) -> Result<String, String> {
    let label = registry.next_label();
    create_editor_window(&app, &label, None, &init_script.0).map_err(|e| e.to_string())?;
    Ok(label)
}

/// Always spawn a fresh window for `target`, even if some window already shows
/// it. Differs from `open_window_for_target` (which de-duplicates by focusing
/// the existing window) — used by the in-app "Open in New Window" affordance
/// where the user explicitly wants another copy regardless of what's already
/// open.
#[tauri::command]
fn force_open_new_window_for_target(
    app: AppHandle,
    target: OpenTarget,
    registry: tauri::State<'_, WindowRegistry>,
    init_script: tauri::State<'_, InitScript>,
) -> Result<String, String> {
    let label = registry.next_label();
    create_editor_window(&app, &label, Some(target), &init_script.0).map_err(|e| e.to_string())?;
    Ok(label)
}

#[tauri::command]
fn register_window_target(
    window: WebviewWindow,
    target: OpenTarget,
    registry: tauri::State<'_, WindowRegistry>,
) {
    registry.set(window.label(), target);
}

#[tauri::command]
fn unregister_window_target(window: WebviewWindow, registry: tauri::State<'_, WindowRegistry>) {
    registry.clear(window.label());
}

/// Receive the latest recents from any window. The dock menu reads this
/// global state on every right-click, so the most recent push wins. The
/// macOS menu bar's `Open Recent` submenu and the tray's `Recent Files`
/// submenu are rebuilt eagerly here because both are static menus that
/// don't query state at click time.
#[tauri::command]
fn dock_set_recents(app: AppHandle, recents: Vec<OpenTarget>) {
    #[cfg(target_os = "macos")]
    {
        dock_menu::set_recents(recents.clone());
        if let Err(err) = menu_bar::refresh_recents(&app, &recents) {
            log::warn!("[menu] failed to refresh app menu recents: {err}");
        }
        refresh_macos_tray_menu(&app, &recents);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, recents);
    }
}

/// Look up what the focused window currently has open. Returns the path and
/// whether it's a file or folder. Used by the menu-bar `Reveal in Finder`
/// item, which fires from native code without context about the active doc.
#[tauri::command]
fn current_window_open_target(
    window: WebviewWindow,
    registry: tauri::State<'_, WindowRegistry>,
) -> Option<OpenTarget> {
    registry
        .open_targets
        .lock()
        .ok()
        .and_then(|map| map.get(window.label()).cloned())
}

/// Write the PDF bytes produced by the local Python sidecar to the selected
/// path. The shell handles filesystem access; PyMuPDF handles document layout.
#[tauri::command]
async fn save_window_pdf(
    window: WebviewWindow,
    target_path: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    pdf_export::save_window_pdf(window, target_path, bytes)
}

/// Holds the per-process WebView init script. We need it on hand whenever a
/// new window is built, since it injects `__TAURI_BACKEND_URL__` and the
/// platform class — without it, the new window's React tree can't reach the
/// FastAPI sidecar.
struct InitScript(String);

pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .try_init()
        .ok();

    // Override the dock tile icon BEFORE any heavy setup (backend spawn,
    // window creation). Otherwise macOS shows the cached .icns for the
    // 1-3 seconds it takes setup to reach apply_dock_icon, producing a
    // visible "wrong logo → correct logo" flash on every launch.
    //
    // The companion call invalidates LaunchServices' cached metadata for
    // our bundle so the *next* cold launch's dock-bounce icon comes from
    // the on-disk .icns rather than a stale system cache entry.
    #[cfg(target_os = "macos")]
    {
        apply_dock_icon();
        refresh_launchservices_bundle_record();
    }

    let port = pick_free_port();
    let backend_url = format!("http://127.0.0.1:{port}");
    log::info!("[backend] reserved {backend_url}");

    // Bootstrap script — runs in the WebView before any page script. This is
    // how the frontend's `getApiBase()` discovers the dynamic sidecar port,
    // and where we tag the document with a platform class so the custom
    // header can leave room for the macOS traffic-light buttons.
    let platform = if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    };
    let init_script = format!(
        r#"window.__TAURI_BACKEND_URL__ = {url};
window.__TAURI_PLATFORM__ = "{platform}";
(function() {{
    var apply = function() {{
    if (!document.documentElement) return;
    document.documentElement.classList.add("is-tauri", "is-tauri-" + "{platform}");
    if ("{platform}" === "macos") {{
      document.documentElement.classList.add("macos-vibrancy");
    }}
  }};
  if (document.documentElement) apply();
  else document.addEventListener("DOMContentLoaded", apply, {{ once: true }});
}})();"#,
        url = serde_json::to_string(&backend_url).unwrap(),
        platform = platform,
    );

    let backend_state = Backend::new();

    // Harvest file paths from CLI args before tauri starts dispatching events.
    // Windows and Linux pass file-association arguments straight as argv;
    // macOS uses RunEvent::Opened (handled below) but a `open -a doXmind foo.md`
    // still routes through here too.
    let pending_open_paths = PendingOpenPaths::new();
    for arg in std::env::args().skip(1) {
        if arg.starts_with('-') {
            continue;
        }
        if let Some(path) = normalize_open_path(&arg) {
            pending_open_paths.push(path);
        }
    }

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(BackendUrl(backend_url.clone()))
        .manage(backend_state)
        .manage(WindowRegistry::new())
        .manage(WorkspaceWatchers::new())
        .manage(pending_open_paths)
        .manage(InitScript(init_script.clone()))
        .invoke_handler(tauri::generate_handler![
            get_backend_url,
            pick_workspace_folder,
            pick_workspace_file,
            pick_save_location,
            workspace_default_root,
            doc_read,
            doc_write,
            doc_write_workspace,
            workspace_read_binary,
            workspace_stat_binary,
            workspace_read_pdf_editor_state,
            workspace_write_pdf_editor_state,
            workspace_read_pdf_doc_state,
            workspace_write_pdf_parsed_cache,
            workspace_read_excel_editor_state,
            workspace_write_excel_editor_state,
            workspace_read_excel_doc_state,
            workspace_write_excel_parsed_cache,
            workspace_scan,
            workspace_watch,
            workspace_unwatch,
            workspace_index_rebuild,
            workspace_index_read,
            workspace_markdown_search,
            doc_create,
            doc_create_pdf,
            doc_create_excel,
            doc_import_external,
            doc_rename,
            doc_move,
            doc_delete,
            workspace_create_folder,
            workspace_rename_folder,
            workspace_delete_folder,
            workspace_import_asset,
            open_window_for_target,
            open_new_window,
            force_open_new_window_for_target,
            register_window_target,
            unregister_window_target,
            dock_set_recents,
            current_window_open_target,
            save_window_pdf,
            take_pending_open_paths
        ])
        .setup(move |app| {
            // Spawn the backend.
            #[cfg(debug_assertions)]
            {
                let child = spawn_backend_dev(port);
                let state: tauri::State<'_, Backend> = app.state();
                *state.child.lock().unwrap() = Some(child);
            }
            #[cfg(not(debug_assertions))]
            {
                let child = spawn_backend_sidecar(&app.handle(), port);
                let state: tauri::State<'_, Backend> = app.state();
                *state.child.lock().unwrap() = Some(child);
            }

            // Build the first window. Subsequent windows go through
            // `open_window_for_target` / `open_new_window` and reuse the same
            // helper so they share traffic-light placement, vibrancy, and
            // close-to-dock semantics.
            //
            // The first window keeps the literal label "main" because the tray
            // menu's "Open doXmind" looks it up by that label. New windows get
            // unique labels from the registry's counter.
            //
            // If the OS launched us with a file (file association on
            // Windows/Linux argv, or `open -a doXmind foo.md`), point the main
            // window at it directly so we don't flash the welcome screen.
            // Remaining paths stay queued for the frontend to drain into
            // additional windows. macOS RunEvent::Opened arrives later and is
            // handled in the run-event loop below.
            let initial_target = {
                let pending: tauri::State<'_, PendingOpenPaths> = app.state();
                pending.pop_first().map(|path| OpenTarget {
                    kind: "file".to_string(),
                    path,
                })
            };
            create_editor_window(app.handle(), "main", initial_target.clone(), &init_script)?;
            if let Some(target) = initial_target {
                let registry: tauri::State<'_, WindowRegistry> = app.state();
                registry.set("main", target);
            }

            #[cfg(target_os = "macos")]
            {
                apply_dock_icon();
                if let Err(err) = install_macos_tray(app.handle()) {
                    log::warn!("[tray] failed to install: {err}");
                }
                if let Err(err) = menu_bar::install(app.handle()) {
                    log::warn!("[menu] failed to install app menu bar: {err}");
                }
                // Dock menu install is deferred to `RunEvent::Ready` below
                // because NSApplication's delegate may not be set yet at this
                // point in the lifecycle.
            }

            Ok(())
        });

    let app = builder
        .build(tauri::generate_context!())
        .expect("failed to build tauri app");

    #[cfg(target_os = "macos")]
    let mut dock_installed = false;

    app.run(move |handle, event| {
        match event {
            RunEvent::ExitRequested { .. } | RunEvent::Exit => {
                shutdown_backend(handle);
            }
            #[cfg(target_os = "macos")]
            RunEvent::Ready => {
                if !dock_installed {
                    if let Err(err) = dock_menu::install(handle.clone()) {
                        log::warn!("[dock] failed to install dock menu: {err}");
                    } else {
                        dock_installed = true;
                    }
                }
            }
            // macOS dock-icon click after every window has been closed. Tauri
            // keeps the process resident; we bring a window back so the user
            // can keep working.
            #[cfg(target_os = "macos")]
            RunEvent::Reopen {
                has_visible_windows,
                ..
            } => {
                if !has_visible_windows {
                    focus_main_window(handle);
                }
            }
            // macOS dispatches Finder "Open With" / drag-to-dock as file://
            // URLs here. Push the paths into the shared queue and ping the
            // frontend; the listener in NativeMenuListener calls
            // `take_pending_open_paths` and routes each into a window via
            // the existing open_window_for_target flow (focuses an existing
            // window if the file is already showing, otherwise spawns a new
            // one).
            #[cfg(target_os = "macos")]
            RunEvent::Opened { urls } => {
                let pending: tauri::State<'_, PendingOpenPaths> = handle.state();
                let mut added = false;
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        if let Some(normalized) = normalize_open_path(&path.to_string_lossy()) {
                            pending.push(normalized);
                            added = true;
                        }
                    }
                }
                if added {
                    let _ = handle.emit("os://open-pending", ());
                }
            }
            _ => {}
        }
    });
}

/// Bytes of the master app logo. Embedded at compile time so the dock-tile
/// override works in `tauri dev` (where there is no .app bundle wrapper) as
/// well as in production builds.
#[cfg(target_os = "macos")]
const APP_ICON_PNG: &[u8] = include_bytes!("../icons/icon.png");

/// Decode the embedded PNG into an NSImage. Returns `None` if AppKit refuses
/// the data (should never happen for our static asset).
#[cfg(target_os = "macos")]
fn load_ns_image() -> Option<Retained<NSImage>> {
    let data = NSData::with_bytes(APP_ICON_PNG);
    NSImage::initWithData(NSImage::alloc(), &data)
}

/// Set the application icon at runtime. macOS uses this for the dock tile,
/// the Cmd+Tab switcher, AND as the bottom-right corner badge that Mission
/// Control / App Exposé / minimize-to-dock thumbnails draw on top of the
/// captured window snapshot — i.e. the "logo in the corner of the live
/// preview" effect. In `tauri dev` there is no .app bundle for macOS to read
/// CFBundleIconFile from, so without this call the dock and previews fall
/// back to a generic blue square.
#[cfg(target_os = "macos")]
fn apply_dock_icon() {
    let Some(mtm) = MainThreadMarker::new() else {
        log::warn!("[dock] skipping icon override — not on main thread");
        return;
    };
    let Some(image) = load_ns_image() else {
        log::warn!("[dock] failed to decode embedded icon.png");
        return;
    };
    let app = NSApplication::sharedApplication(mtm);
    unsafe { app.setApplicationIconImage(Some(&image)) };
}

/// Tell LaunchServices to forget what it cached for our bundle and re-read
/// the .icns from disk. Without this, Dock shows the stale cached icon during
/// the launch bounce on every cold start (the runtime override only kicks in
/// after the binary loads). One call here means the next launch — and every
/// launch after that — pulls the current .icns instead.
#[cfg(target_os = "macos")]
fn refresh_launchservices_bundle_record() {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    // Walk up: <bundle>.app/Contents/MacOS/<binary>  →  <bundle>.app
    let Some(bundle) = exe
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
    else {
        return;
    };
    if bundle.extension().map_or(true, |ext| ext != "app") {
        return;
    }
    let path = bundle.to_string_lossy();
    let ns_path = NSString::from_str(&path);
    let workspace = NSWorkspace::sharedWorkspace();
    workspace.noteFileSystemChanged_(&ns_path);
    log::info!("[dock] refreshed LaunchServices record for {}", path);
}

#[cfg(target_os = "macos")]
fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return;
    }
    // "main" was destroyed (user closed every window). Re-create it so the
    // tray menu and dock-icon reopen flow land on a fresh welcome screen
    // instead of silently doing nothing.
    if let Some(init) = app.try_state::<InitScript>() {
        if let Err(err) = create_editor_window(app, "main", None, &init.0) {
            log::warn!("[focus] failed to recreate main window: {err}");
        }
    }
}

/// Install the macOS menu-bar (tray) icon and dropdown menu.
///
/// The icon is a black-only template PNG; passing `icon_as_template(true)`
/// lets macOS recolor it to match the active menu bar appearance. Menu items
/// emit `tray://*` events that the frontend listens for to invoke the same
/// store actions the in-app UI uses (so we don't reimplement file creation
/// in Rust). The dropdown's `Recent Files` submenu is rebuilt on every
/// `dock_set_recents` push by `refresh_macos_tray_menu` below.
#[cfg(target_os = "macos")]
const TRAY_ID: &str = "doxmind-tray";
#[cfg(target_os = "macos")]
const TRAY_RECENT_PREFIX: &str = "tray-recent-";

#[cfg(target_os = "macos")]
fn install_macos_tray(app: &AppHandle) -> tauri::Result<()> {
    let icon_bytes = include_bytes!("../icons/tray-icon-template.png");
    let icon = Image::from_bytes(icon_bytes)?;

    let menu = build_tray_menu(app, &[])?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("doXmind")
        .on_menu_event(handle_tray_menu_event)
        .build(app)?;

    Ok(())
}

#[cfg(target_os = "macos")]
fn build_tray_menu(
    app: &AppHandle,
    recents: &[OpenTarget],
) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::SubmenuBuilder;

    let new_file = MenuItemBuilder::with_id("tray-new-file", "New Document")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let open_file = MenuItemBuilder::with_id("tray-open-file", "Open File…").build(app)?;
    let open_folder = MenuItemBuilder::with_id("tray-open-folder", "Open Folder…").build(app)?;

    let recents_submenu = {
        let mut builder = SubmenuBuilder::new(app, "Recent Files");
        if recents.is_empty() {
            let empty = MenuItemBuilder::with_id("tray-recent-empty", "No Recent Items")
                .enabled(false)
                .build(app)?;
            builder = builder.item(&empty);
        } else {
            for (idx, entry) in recents.iter().take(10).enumerate() {
                let label = recent_short_label(entry);
                let id = format!("{TRAY_RECENT_PREFIX}{idx}");
                builder = builder.item(&MenuItemBuilder::with_id(id, label).build(app)?);
            }
        }
        builder.build()?
    };

    let show = MenuItemBuilder::with_id("tray-show", "Open doXmind").build(app)?;
    let settings = MenuItemBuilder::with_id("tray-settings", "Settings…").build(app)?;
    let quit = PredefinedMenuItem::quit(app, Some("Quit doXmind"))?;

    MenuBuilder::new(app)
        .item(&new_file)
        .separator()
        .item(&open_file)
        .item(&open_folder)
        .item(&recents_submenu)
        .separator()
        .item(&show)
        .item(&settings)
        .separator()
        .item(&quit)
        .build()
}

#[cfg(target_os = "macos")]
fn recent_short_label(entry: &OpenTarget) -> String {
    let normalized = entry.path.replace('\\', "/");
    let trimmed = normalized.trim_end_matches('/');
    trimmed
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| entry.path.clone())
}

#[cfg(target_os = "macos")]
fn handle_tray_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref().to_string();
    if let Some(rest) = id.strip_prefix(TRAY_RECENT_PREFIX) {
        if let Ok(idx) = rest.parse::<usize>() {
            if let Some(entry) = dock_menu::recent_at(idx) {
                let _ = app.emit("tray://open-recent", entry);
            }
        }
        return;
    }

    match id.as_str() {
        "tray-new-file" => {
            focus_main_window(app);
            let _ = app.emit("tray://new-file", ());
        }
        "tray-open-file" => {
            focus_main_window(app);
            let _ = app.emit("tray://open-file", ());
        }
        "tray-open-folder" => {
            focus_main_window(app);
            let _ = app.emit("tray://open-folder", ());
        }
        "tray-show" => {
            focus_main_window(app);
        }
        "tray-settings" => {
            focus_main_window(app);
            let _ = app.emit("tray://settings", ());
        }
        _ => {}
    }
}

#[cfg(target_os = "macos")]
fn refresh_macos_tray_menu(app: &AppHandle, recents: &[OpenTarget]) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    match build_tray_menu(app, recents) {
        Ok(menu) => {
            if let Err(err) = tray.set_menu(Some(menu)) {
                log::warn!("[tray] failed to refresh menu: {err}");
            }
        }
        Err(err) => log::warn!("[tray] failed to rebuild menu: {err}"),
    }
}

fn shutdown_backend(app: &AppHandle) {
    if let Some(state) = app.try_state::<Backend>() {
        if let Ok(mut guard) = state.child.lock() {
            if let Some(child) = guard.take() {
                log::info!("[backend] terminating sidecar");
                #[cfg(debug_assertions)]
                {
                    let mut child = child;
                    let _ = child.kill();
                    let _ = child.wait();
                }
                #[cfg(not(debug_assertions))]
                {
                    let _ = child.kill();
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PDF_MARKDOWN_SHAPE_FIXTURE: &str =
        include_str!("../../tests/fixtures/sidecar_compat/pdf_markdown_shape.doxmind.json");
    const EXCEL_MARKDOWN_SHAPE_FIXTURE: &str =
        include_str!("../../tests/fixtures/sidecar_compat/excel_markdown_shape.doxmind.json");
    const PDF_LEGACY_FIXTURE: &str =
        include_str!("../../tests/fixtures/sidecar_compat/pdf_legacy.doxmind.json");
    const EXCEL_LEGACY_FIXTURE: &str =
        include_str!("../../tests/fixtures/sidecar_compat/excel_legacy.doxmind.json");

    struct TempWorkspace {
        path: PathBuf,
    }

    impl TempWorkspace {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "doxmind-tauri-{name}-{}-{}",
                std::process::id(),
                unix_nanos()
            ));
            fs::create_dir_all(&path).expect("create temp workspace");
            Self { path }
        }

        fn root(&self) -> String {
            self.path.to_string_lossy().into_owned()
        }
    }

    impl Drop for TempWorkspace {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn write_file(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(path, content).expect("write file");
    }

    fn read_json_file(path: &Path) -> serde_json::Value {
        serde_json::from_slice(&fs::read(path).expect("read json file")).expect("parse json file")
    }

    fn install_compat_fixture(workspace: &TempWorkspace, filename: &str, fixture: &str) -> PathBuf {
        let source_path = workspace.path.join(filename);
        if filename.to_ascii_lowercase().ends_with(".pdf") {
            fs::write(&source_path, b"%PDF-1.4\n% compat fixture\n%%EOF\n").expect("write pdf");
        } else {
            fs::write(&source_path, b"PK\x03\x04 compat fixture workbook").expect("write workbook");
        }
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&source_path);
        fs::write(&sidecar_path, fixture).expect("write fixture sidecar");
        sidecar_path
    }

    fn assert_no_legacy_fields(sidecar: &serde_json::Value, keys: &[&str]) {
        assert_eq!(
            sidecar["version"],
            serde_json::json!(doxmind_sidecar::SIDECAR_VERSION)
        );
        assert!(sidecar.get("source_path").is_none());
        assert!(sidecar.get("updated_at_unix_nanos").is_none());
        for key in keys {
            assert!(sidecar.get(*key).is_none(), "{key} should not be durable");
        }
    }

    fn sidecar_bak_path(sidecar_path: &Path) -> PathBuf {
        sidecar_path.with_file_name(format!(
            "{}.bak",
            sidecar_path
                .file_name()
                .map(|name| name.to_string_lossy())
                .unwrap_or_default()
        ))
    }

    fn only_excel_slot(sidecar: &serde_json::Value) -> (&String, &serde_json::Value) {
        let blocks = sidecar["extras"]["blocks"]
            .as_object()
            .expect("extras.blocks object");
        assert_eq!(blocks.len(), 1, "synthetic Excel documents own one block");
        blocks.iter().next().expect("one block")
    }

    fn read_json(path: &Path) -> serde_json::Value {
        serde_json::from_slice(&fs::read(path).expect("read json")).expect("parse json")
    }

    fn only_pdf_block(sidecar: &serde_json::Value) -> (&str, &serde_json::Value) {
        let blocks = sidecar["extras"]["blocks"]
            .as_object()
            .expect("extras.blocks object");
        assert_eq!(blocks.len(), 1);
        let (block_id, slot) = blocks.iter().next().expect("one block");
        (block_id.as_str(), slot)
    }

    #[test]
    fn move_document_pair_renames_pdf_and_keeps_extension() {
        let workspace = TempWorkspace::new("rename-pdf");
        let pdf_path = workspace.path.join("Spec.pdf");
        fs::write(&pdf_path, b"%PDF-1.4\n% rename test\n%%EOF\n").expect("write pdf");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);
        fs::write(&sidecar_path, br#"{"id":"pdf"}"#).expect("write sidecar");

        let dto =
            move_document_pair(&workspace.root(), "Spec.pdf", "Report.pdf").expect("rename pdf");

        assert_eq!(dto.path, "Report.pdf");
        assert_eq!(dto.document_type, "pdf");
        assert!(!pdf_path.exists());
        assert!(workspace.path.join("Report.pdf").exists());
        // The hidden sidecar travels with the document (pair atomicity).
        assert!(!sidecar_path.exists());
        assert!(doxmind_sidecar::sidecar_path_for(&workspace.path.join("Report.pdf")).exists());
    }

    #[test]
    fn move_document_pair_renames_xlsx_and_keeps_extension() {
        let workspace = TempWorkspace::new("rename-xlsx");
        let xlsx_path = workspace.path.join("Budget.xlsx");
        fs::write(&xlsx_path, b"PK\x03\x04 workbook").expect("write xlsx");

        let dto =
            move_document_pair(&workspace.root(), "Budget.xlsx", "Q1.xlsx").expect("rename xlsx");

        assert_eq!(dto.path, "Q1.xlsx");
        assert_eq!(dto.document_type, "excel");
        assert!(!xlsx_path.exists());
        assert!(workspace.path.join("Q1.xlsx").exists());
    }

    #[test]
    fn move_document_pair_rejects_type_change() {
        let workspace = TempWorkspace::new("rename-type-change");
        let pdf_path = workspace.path.join("Spec.pdf");
        fs::write(&pdf_path, b"%PDF-1.4\n%%EOF\n").expect("write pdf");

        let err = move_document_pair(&workspace.root(), "Spec.pdf", "Spec.md")
            .expect_err("type change must be rejected");

        assert!(err.contains("cannot change document type"), "got: {err}");
        assert!(pdf_path.exists(), "source must be untouched on rejection");
    }

    #[test]
    fn pdf_sidecar_missing_read_synthesizes_markdown_shape_slot() {
        let workspace = TempWorkspace::new("pdf-sidecar-missing");
        let pdf_path = workspace.path.join("Spec.pdf");
        let source_bytes = b"%PDF-1.4\nmissing sidecar\n%%EOF\n";
        fs::write(&pdf_path, source_bytes).expect("write pdf");
        let sidecar_path = workspace.path.join(".Spec.pdf.doxmind");

        let state = workspace_read_pdf_doc_state(workspace.root(), "Spec.pdf".into())
            .expect("read pdf state")
            .expect("synthetic state");

        // Read paths must NOT touch disk; the sidecar only materializes on
        // the first explicit write.
        assert_eq!(state["editor"], serde_json::Value::Null);
        assert_eq!(state["parsedCache"], serde_json::Value::Null);
        assert_eq!(fs::read(&pdf_path).expect("pdf bytes"), source_bytes);
        assert!(
            !sidecar_path.exists(),
            "missing-sidecar read must not write to disk"
        );

        // First explicit editor write materializes the sidecar in v2 shape.
        workspace_write_pdf_editor_state(
            workspace.root(),
            "Spec.pdf".into(),
            serde_json::json!({ "freeTextBoxes": [] }),
        )
        .expect("write editor state");

        assert!(sidecar_path.exists(), "explicit write creates the sidecar");
        let sidecar = read_json(&sidecar_path);
        let (_block_id, _slot) = only_pdf_block(&sidecar);
        assert_eq!(
            sidecar["version"],
            serde_json::json!(doxmind_sidecar::SIDECAR_VERSION)
        );
        assert!(sidecar["html"]
            .as_str()
            .expect("html")
            .contains("<!-- pdf-block"));
        assert!(sidecar.get(PDF_LEGACY_EDITOR_KEY).is_none());
        assert!(sidecar.get(PDF_LEGACY_PARSED_CACHE_KEY).is_none());
    }

    #[test]
    fn pdf_sidecar_same_id_duplicate_placeholders_error_without_rewrite() {
        // A hand-edited sidecar with the same placeholder id repeated:
        // Python distinguishes this from different-id duplicates so the
        // user can find and remove the offending repeat; Rust matches
        // that vocabulary.
        let workspace = TempWorkspace::new("pdf-sidecar-duplicate-placeholder");
        let pdf_path = workspace.path.join("Spec.pdf");
        fs::write(&pdf_path, b"%PDF-1.4\n%%EOF\n").expect("write pdf");
        let sidecar_path = workspace.path.join(".Spec.pdf.doxmind");
        write_file(
            &sidecar_path,
            r#"{
  "version": 2,
  "id": "doc-1",
  "html": "<!-- pdf-block id=\"block-1\" src=\"Spec.pdf\" -->\n<!-- pdf-block id=\"block-1\" src=\"Spec.pdf\" -->",
  "markdown_hash": "old",
  "updated_at": "old",
  "extras": {"blocks": {"block-1": {"editor": {"version": 1}}}}
}"#,
        );
        let raw_before = fs::read(&sidecar_path).expect("read sidecar before");

        let err = workspace_read_pdf_doc_state(workspace.root(), "Spec.pdf".into())
            .expect_err("duplicate placeholders must fail visibly");

        assert!(
            err.contains("duplicate pdf-block placeholder id(s): block-1"),
            "{err}"
        );
        assert_eq!(
            fs::read(&sidecar_path).expect("read sidecar after"),
            raw_before
        );
    }

    #[test]
    fn pdf_sidecar_different_id_duplicate_placeholders_error_without_rewrite() {
        // Two placeholders with different ids: the failure mode is
        // "schema requires one block, found multiple" — distinct from the
        // same-id case above and reported with different wording.
        let workspace = TempWorkspace::new("pdf-sidecar-multi-placeholder");
        let pdf_path = workspace.path.join("Spec.pdf");
        fs::write(&pdf_path, b"%PDF-1.4\n%%EOF\n").expect("write pdf");
        let sidecar_path = workspace.path.join(".Spec.pdf.doxmind");
        write_file(
            &sidecar_path,
            r#"{
  "version": 2,
  "id": "doc-1",
  "html": "<!-- pdf-block id=\"block-A\" src=\"Spec.pdf\" -->\n<!-- pdf-block id=\"block-B\" src=\"Spec.pdf\" -->",
  "markdown_hash": "old",
  "updated_at": "old",
  "extras": {"blocks": {"block-A": {}, "block-B": {}}}
}"#,
        );
        let raw_before = fs::read(&sidecar_path).expect("read sidecar before");

        let err = workspace_read_pdf_doc_state(workspace.root(), "Spec.pdf".into())
            .expect_err("multiple placeholders must fail visibly");

        assert!(
            err.contains(
                "multiple pdf-block placeholders; Synthetic Documents require exactly one"
            ),
            "{err}"
        );
        assert!(!err.contains("duplicate"), "{err}");
        assert_eq!(
            fs::read(&sidecar_path).expect("read sidecar after"),
            raw_before
        );
    }

    #[test]
    fn pdf_editor_write_preserves_unrelated_extras_keys() {
        // The orphan-pruning rule in issue #96 applies only to
        // `extras.blocks`. Other top-level extras keys (theme, layout,
        // user-authored metadata, …) are not part of the block schema
        // and must ride through writes untouched.
        let workspace = TempWorkspace::new("pdf-preserve-extras");
        let pdf_path = workspace.path.join("Spec.pdf");
        fs::write(&pdf_path, b"%PDF-1.4\n%%EOF\n").expect("write pdf");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);
        fs::write(
            &sidecar_path,
            serde_json::to_vec_pretty(&serde_json::json!({
                "version": doxmind_sidecar::SIDECAR_VERSION,
                "id": "doc-1",
                "html": "<!-- pdf-block id=\"keep\" src=\"Spec.pdf\" -->",
                "markdown_hash": "old",
                "updated_at": "2026-05-12T00:00:00Z",
                "extras": {
                    "blocks": { "keep": {} },
                    "theme": "solarized",
                    "user_metadata": { "tags": ["draft"] }
                }
            }))
            .expect("sidecar bytes"),
        )
        .expect("write sidecar");

        workspace_write_pdf_editor_state(
            workspace.root(),
            "Spec.pdf".into(),
            serde_json::json!({ "freeTextBoxes": [] }),
        )
        .expect("write editor state");

        let after = read_json_file(&sidecar_path);
        assert_eq!(after["extras"]["theme"], "solarized");
        assert_eq!(after["extras"]["user_metadata"]["tags"][0], "draft");
    }

    #[test]
    fn pdf_editor_write_prunes_orphan_extras_blocks_slots() {
        // Python's BlockCorrelation runs with OrphanPolicy.DISCARD on read,
        // so an extras.blocks entry whose id doesn't match the placeholder
        // gets pruned. Rust writes must produce the same on-disk shape;
        // otherwise the two runtimes' outputs diverge and orphans
        // accumulate forever (issue #96).
        let workspace = TempWorkspace::new("pdf-orphan-prune");
        let pdf_path = workspace.path.join("Spec.pdf");
        fs::write(&pdf_path, b"%PDF-1.4\n%%EOF\n").expect("write pdf");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);
        fs::write(
            &sidecar_path,
            serde_json::to_vec_pretty(&serde_json::json!({
                "version": doxmind_sidecar::SIDECAR_VERSION,
                "id": "doc-1",
                "html": "<!-- pdf-block id=\"keep\" src=\"Spec.pdf\" -->",
                "markdown_hash": "old",
                "updated_at": "2026-05-12T00:00:00Z",
                "extras": {
                    "blocks": {
                        "keep": { "editor": { "freeTextBoxes": [] } },
                        "orphan": { "editor": { "freeTextBoxes": [{"id": "leftover"}] } }
                    }
                }
            }))
            .expect("sidecar bytes"),
        )
        .expect("write sidecar");

        workspace_write_pdf_editor_state(
            workspace.root(),
            "Spec.pdf".into(),
            serde_json::json!({ "freeTextBoxes": [{"id": "fresh"}] }),
        )
        .expect("write editor state");

        let after = read_json_file(&sidecar_path);
        let blocks = after["extras"]["blocks"]
            .as_object()
            .expect("extras.blocks object");
        assert_eq!(
            blocks.len(),
            1,
            "orphan slot must be pruned to match Python's OrphanPolicy.DISCARD; got: {:?}",
            blocks.keys().collect::<Vec<_>>()
        );
        assert!(blocks.contains_key("keep"));
        assert!(!blocks.contains_key("orphan"));
    }

    #[test]
    fn pdf_sidecar_legacy_read_migrates_once_with_backup_and_preserves_binary() {
        // Serialise against `migrate_off_gates_legacy_sidecar_migration`,
        // which mutates `DOXMIND_SIDECAR_MIGRATE` (a process-global).
        // Without this lock, that test setting `=off` mid-parallel-run
        // turns this test's read into a read-only synthesis and the
        // expected `.bak` never appears.
        let _lock = MIGRATE_ENV_LOCK.lock().unwrap_or_else(|err| err.into_inner());
        let workspace = TempWorkspace::new("pdf-sidecar-legacy");
        let pdf_path = workspace.path.join("Spec.pdf");
        let source_bytes = b"%PDF-1.4\nlegacy source\n%%EOF\n";
        fs::write(&pdf_path, source_bytes).expect("write pdf");
        let sidecar_path = workspace.path.join(".Spec.pdf.doxmind");
        let legacy = br#"{
  "version": 1,
  "id": "legacy-doc",
  "pdf_editor": {"textEdits": [{"id": "t1"}]},
  "pdf_parsed_cache": {"sourceHash": "abc", "parsed": {"pages": [1]}},
  "extras": {"keep": {"x": 1}}
}"#;
        fs::write(&sidecar_path, legacy).expect("write legacy sidecar");

        let state = workspace_read_pdf_doc_state(workspace.root(), "Spec.pdf".into())
            .expect("read migrated")
            .expect("state");

        assert_eq!(state["editor"]["textEdits"][0]["id"], "t1");
        assert_eq!(state["parsedCache"]["sourceHash"], "abc");
        assert_eq!(fs::read(&pdf_path).expect("pdf bytes"), source_bytes);
        assert_eq!(
            fs::read(workspace.path.join(".Spec.pdf.doxmind.bak")).expect("backup"),
            legacy
        );

        let migrated = read_json(&sidecar_path);
        let (_block_id, slot) = only_pdf_block(&migrated);
        assert_eq!(slot["editor"]["textEdits"][0]["id"], "t1");
        assert_eq!(slot["parsedCache"]["parsed"]["pages"][0], 1);
        assert_eq!(migrated["extras"]["keep"]["x"], 1);
        assert!(migrated.get(PDF_LEGACY_EDITOR_KEY).is_none());
        assert!(migrated.get(PDF_LEGACY_PARSED_CACHE_KEY).is_none());
    }

    #[test]
    fn pdf_sidecar_already_migrated_reads_editor_slot() {
        let workspace = TempWorkspace::new("pdf-sidecar-migrated");
        fs::write(workspace.path.join("Spec.pdf"), b"%PDF-1.4\n%%EOF\n").expect("write pdf");
        // v1 markdown-shape sidecar emitted by an older Python runtime; read
        // must tolerate it, and the next explicit write must rewrite to v2.
        write_file(
            &workspace.path.join(".Spec.pdf.doxmind"),
            r#"{
  "version": 1,
  "id": "doc-1",
  "html": "<!-- pdf-block id=\"block-1\" src=\"Spec.pdf\" -->",
  "markdown_hash": "old",
  "updated_at": "old",
  "extras": {
    "blocks": {
      "block-1": {
        "editor": {"freeTextBoxes": [{"id": "box-1"}]},
        "parsedCache": {"sourceHash": "hash", "parsed": {"pages": []}}
      }
    }
  }
}"#,
        );

        let editor =
            workspace_read_pdf_editor_state(workspace.root(), "Spec.pdf".into()).expect("read");

        assert_eq!(editor.expect("editor")["freeTextBoxes"][0]["id"], "box-1");

        // Explicit editor write rewrites the sidecar in v2 shape.
        workspace_write_pdf_editor_state(
            workspace.root(),
            "Spec.pdf".into(),
            serde_json::json!({"freeTextBoxes": [{"id": "box-2"}]}),
        )
        .expect("write editor");

        let sidecar = read_json(&workspace.path.join(".Spec.pdf.doxmind"));
        assert_eq!(
            sidecar["version"],
            serde_json::json!(doxmind_sidecar::SIDECAR_VERSION)
        );
        assert!(sidecar.get(PDF_LEGACY_EDITOR_KEY).is_none());
        assert!(sidecar.get(PDF_LEGACY_PARSED_CACHE_KEY).is_none());
    }

    #[test]
    fn pdf_sidecar_editor_write_preserves_parsed_cache_and_unrelated_extras() {
        let workspace = TempWorkspace::new("pdf-sidecar-editor-merge");
        fs::write(workspace.path.join("Spec.pdf"), b"%PDF-1.4\n%%EOF\n").expect("write pdf");
        write_file(
            &workspace.path.join(".Spec.pdf.doxmind"),
            r#"{
  "version": 1,
  "id": "doc-1",
  "html": "<!-- pdf-block id=\"block-1\" src=\"Spec.pdf\" -->",
  "markdown_hash": "old",
  "updated_at": "old",
  "extras": {
    "theme": {"dark": true},
    "blocks": {
      "block-1": {
        "editor": {"textEdits": []},
        "parsedCache": {"sourceHash": "hash", "parsed": {"pages": [1]}}
      }
    }
  }
}"#,
        );

        workspace_write_pdf_editor_state(
            workspace.root(),
            "Spec.pdf".into(),
            serde_json::json!({"textEdits": [{"id": "new"}]}),
        )
        .expect("write editor");

        let sidecar = read_json(&workspace.path.join(".Spec.pdf.doxmind"));
        let (_block_id, slot) = only_pdf_block(&sidecar);
        assert_eq!(slot["editor"]["textEdits"][0]["id"], "new");
        assert_eq!(slot["parsedCache"]["sourceHash"], "hash");
        assert_eq!(sidecar["extras"]["theme"]["dark"], true);
        assert!(sidecar.get(PDF_LEGACY_EDITOR_KEY).is_none());
        assert!(sidecar.get(PDF_LEGACY_PARSED_CACHE_KEY).is_none());
    }

    #[test]
    fn pdf_sidecar_parsed_cache_write_preserves_editor_and_unrelated_extras() {
        let workspace = TempWorkspace::new("pdf-sidecar-cache-merge");
        fs::write(workspace.path.join("Spec.pdf"), b"%PDF-1.4\n%%EOF\n").expect("write pdf");
        write_file(
            &workspace.path.join(".Spec.pdf.doxmind"),
            r#"{
  "version": 1,
  "id": "doc-1",
  "html": "<!-- pdf-block id=\"block-1\" src=\"Spec.pdf\" -->",
  "markdown_hash": "old",
  "updated_at": "old",
  "extras": {
    "theme": {"dark": true},
    "blocks": {
      "block-1": {
        "editor": {"highlightBoxes": [{"id": "h1"}]},
        "parsedCache": {"sourceHash": "old", "parsed": {"pages": []}}
      }
    }
  }
}"#,
        );

        workspace_write_pdf_parsed_cache(
            workspace.root(),
            "Spec.pdf".into(),
            "new-hash".into(),
            serde_json::json!({"pages": [2]}),
        )
        .expect("write cache");

        let sidecar = read_json(&workspace.path.join(".Spec.pdf.doxmind"));
        let (_block_id, slot) = only_pdf_block(&sidecar);
        assert_eq!(slot["editor"]["highlightBoxes"][0]["id"], "h1");
        assert_eq!(slot["parsedCache"]["sourceHash"], "new-hash");
        assert_eq!(slot["parsedCache"]["parsed"]["pages"][0], 2);
        assert_eq!(sidecar["extras"]["theme"]["dark"], true);
        assert!(sidecar.get(PDF_LEGACY_EDITOR_KEY).is_none());
        assert!(sidecar.get(PDF_LEGACY_PARSED_CACHE_KEY).is_none());
    }

    #[test]
    fn pdf_cross_runtime_fixture_editor_and_cache_writes_match_contract() {
        let workspace = TempWorkspace::new("pdf-cross-runtime-shape");
        let sidecar_path =
            install_compat_fixture(&workspace, "Spec.pdf", PDF_MARKDOWN_SHAPE_FIXTURE);

        let initial = workspace_read_pdf_doc_state(workspace.root(), "Spec.pdf".into())
            .expect("read fixture")
            .expect("state");
        assert_eq!(initial["parsedCache"]["sourceHash"], "valid-pdf-hash");

        let editor = serde_json::json!({"version": 1, "edits": {"9:0": {"text": "desktop pdf"}}});
        workspace_write_pdf_editor_state(workspace.root(), "Spec.pdf".into(), editor.clone())
            .expect("write editor");
        let after_editor = workspace_read_pdf_doc_state(workspace.root(), "Spec.pdf".into())
            .expect("read after editor")
            .expect("state");
        assert_eq!(after_editor["editor"], editor);
        assert_eq!(after_editor["parsedCache"], initial["parsedCache"]);

        let parsed = serde_json::json!({"pages": [{"index": 1, "text": "updated"}]});
        workspace_write_pdf_parsed_cache(
            workspace.root(),
            "Spec.pdf".into(),
            "valid-pdf-hash-2".into(),
            parsed.clone(),
        )
        .expect("write cache");

        let sidecar = read_json_file(&sidecar_path);
        assert_no_legacy_fields(
            &sidecar,
            &[PDF_LEGACY_EDITOR_KEY, PDF_LEGACY_PARSED_CACHE_KEY],
        );
        assert!(sidecar["html"]
            .as_str()
            .expect("html")
            .contains("id=\"fixture-pdf-block\""));
        assert_eq!(sidecar["extras"]["unrelated"]["keep"], true);
        let slot = sidecar["extras"]["blocks"]["fixture-pdf-block"]
            .as_object()
            .expect("slot");
        assert_eq!(slot["editor"], editor);
        assert_eq!(slot["parsedCache"]["sourceHash"], "valid-pdf-hash-2");
        assert_eq!(slot["parsedCache"]["parsed"], parsed);
        assert_eq!(slot["slotExtra"]["keep"], "pdf");
    }

    #[test]
    fn pdf_cross_runtime_legacy_fixture_migrates_to_shared_shape() {
        let _lock = MIGRATE_ENV_LOCK.lock().unwrap_or_else(|err| err.into_inner());
        let workspace = TempWorkspace::new("pdf-cross-runtime-legacy");
        let sidecar_path = install_compat_fixture(&workspace, "Spec.pdf", PDF_LEGACY_FIXTURE);

        let migrated = workspace_read_pdf_doc_state(workspace.root(), "Spec.pdf".into())
            .expect("read migrated")
            .expect("state");
        assert!(migrated["editor"]["edits"].get("2:0").is_some());
        assert_eq!(migrated["parsedCache"]["sourceHash"], "legacy-pdf-hash");
        assert!(sidecar_bak_path(&sidecar_path).exists());

        let sidecar = read_json_file(&sidecar_path);
        assert_no_legacy_fields(
            &sidecar,
            &[PDF_LEGACY_EDITOR_KEY, PDF_LEGACY_PARSED_CACHE_KEY],
        );
        assert_eq!(sidecar["id"], "legacy-pdf-doc");
        assert!(sidecar["html"]
            .as_str()
            .expect("html")
            .contains("id=\"legacy-pdf-block\""));
        assert_eq!(sidecar["extras"]["unrelated"]["keep"], "legacy-pdf");
        let slot = sidecar["extras"]["blocks"]["legacy-pdf-block"]
            .as_object()
            .expect("slot");
        assert_eq!(slot["slotExtra"]["keep"], true);
        assert_eq!(slot["parsedCache"]["sourceHash"], "legacy-pdf-hash");

        let post_editor = serde_json::json!({"version": 1, "edits": {"3:0": {"text": "post"}}});
        workspace_write_pdf_editor_state(workspace.root(), "Spec.pdf".into(), post_editor.clone())
            .expect("post migration write");
        let post_write = read_json_file(&sidecar_path);
        assert_no_legacy_fields(
            &post_write,
            &[PDF_LEGACY_EDITOR_KEY, PDF_LEGACY_PARSED_CACHE_KEY],
        );
        assert_eq!(
            post_write["extras"]["blocks"]["legacy-pdf-block"]["editor"],
            post_editor
        );
    }

    #[test]
    fn pdf_sidecar_corrupt_read_errors_and_preserves_forensic_copy() {
        let workspace = TempWorkspace::new("pdf-sidecar-corrupt");
        fs::write(workspace.path.join("Spec.pdf"), b"%PDF-1.4\n%%EOF\n").expect("write pdf");
        let sidecar_path = workspace.path.join(".Spec.pdf.doxmind");
        let corrupt = b"not json {{";
        fs::write(&sidecar_path, corrupt).expect("write corrupt sidecar");

        let err = workspace_read_pdf_doc_state(workspace.root(), "Spec.pdf".into())
            .expect_err("corrupt sidecar should fail");

        assert!(err.contains("corrupt PDF sidecar"), "unexpected: {err}");
        assert_eq!(fs::read(&sidecar_path).expect("original corrupt"), corrupt);
        let forensic = fs::read_dir(&workspace.path)
            .expect("list workspace")
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .find(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.starts_with(".Spec.pdf.doxmind.corrupt-"))
                    .unwrap_or(false)
            })
            .expect("forensic copy");
        assert_eq!(fs::read(forensic).expect("forensic bytes"), corrupt);
    }

    #[test]
    fn read_result_dto_serializes_null_correlation() {
        let dto = ReadResultDto::from(ReadResult {
            html: "<p>Hello</p>".into(),
            editor_html: "<p>Hello</p>".into(),
            browsing_html: "<p>Hello</p>".into(),
            markdown: "Hello".into(),
            meta: DocMeta::new("doc-1"),
            extras: None,
            correlation: None,
            source: Source::Markdown,
            source_state: SourceState::SidecarMissing,
            outline: Vec::new(),
            browsing_renderer_version: doxmind_sidecar::BROWSING_RENDERER_VERSION.to_string(),
        });

        let value = serde_json::to_value(dto).expect("serialize dto");

        assert!(
            value.as_object().unwrap().contains_key("correlation"),
            "correlation must be explicit on the Tauri wire DTO"
        );
        assert_eq!(value["correlation"], serde_json::Value::Null);
    }

    #[test]
    fn doc_write_workspace_response_shape_serializes_null_correlation() {
        let dto = ReadResultDto {
            html: "<p>Hello</p>".into(),
            editor_html: "<p>Hello</p>".into(),
            browsing_html: "<p>Hello</p>".into(),
            markdown: "Hello".into(),
            meta: DocMeta::new("doc-1"),
            extras: None,
            correlation: None,
            source: "sidecar".into(),
            source_state: "sidecar_fresh".into(),
            outline: Vec::new(),
            browsing_renderer_version: doxmind_sidecar::BROWSING_RENDERER_VERSION.to_string(),
        };

        let value = serde_json::to_value(dto).expect("serialize dto");

        assert!(
            value.as_object().unwrap().contains_key("correlation"),
            "workspace writes must return explicit null until Rust correlation exists"
        );
        assert_eq!(value["correlation"], serde_json::Value::Null);
    }

    #[test]
    fn workspace_scan_uses_stable_path_id_without_writing_document_sidecar() {
        let workspace = TempWorkspace::new("scan-stable-id");
        write_file(&workspace.path.join("notes/Untitled.md"), "# Untitled\n");
        write_file(&workspace.path.join(".git/ignored.md"), "# ignored\n");
        write_file(
            &workspace.path.join("node_modules/pkg/ignored.md"),
            "# ignored\n",
        );

        let scan = workspace_scan(workspace.root()).expect("scan workspace");

        assert_eq!(scan.documents.len(), 1);
        let doc = &scan.documents[0];
        assert_eq!(doc.path, "notes/Untitled.md");
        assert_eq!(doc.id_source, "path");
        assert_eq!(doc.id, stable_path_id("notes/Untitled.md"));
        assert!(!workspace.path.join("notes/.Untitled.doxmind").exists());
    }

    #[test]
    fn workspace_scan_reads_frontmatter_id_and_title() {
        let workspace = TempWorkspace::new("scan-frontmatter");
        write_file(
            &workspace.path.join("Plan.markdown"),
            "---\nid: doc-1\ntitle: \"Project Plan\"\n---\n\n# Body\n",
        );

        let scan = workspace_scan(workspace.root()).expect("scan workspace");

        assert_eq!(scan.documents.len(), 1);
        assert_eq!(scan.documents[0].id, "doc-1");
        assert_eq!(scan.documents[0].id_source, "frontmatter");
        assert_eq!(scan.documents[0].title.as_deref(), Some("Project Plan"));

        let cached = workspace_index_read(workspace.root()).expect("read scan-written index");
        assert_eq!(
            cached.ids.get("doc-1").map(String::as_str),
            Some("Plan.markdown")
        );
    }

    #[test]
    fn workspace_index_rebuild_writes_frontmatter_id_cache_only() {
        let workspace = TempWorkspace::new("index-rebuild");
        write_file(
            &workspace.path.join("notes/Plan.md"),
            "---\nid: plan-1\ntitle: Plan\n---\n\n# Body\n",
        );
        write_file(&workspace.path.join("notes/No Id.md"), "# No Id\n");
        write_file(
            &workspace.path.join(".doxmind/Cached.md"),
            "---\nid: cached\n---\n",
        );
        write_file(
            &workspace.path.join(".git/Ignored.md"),
            "---\nid: git\n---\n",
        );

        let index = workspace_index_rebuild(workspace.root()).expect("rebuild index");

        assert_eq!(index.version, 1);
        assert_eq!(index.ids.len(), 1);
        assert_eq!(
            index.ids.get("plan-1").map(String::as_str),
            Some("notes/Plan.md")
        );
        assert!(workspace.path.join(".doxmind/index.json").exists());

        let cached = workspace_index_read(workspace.root()).expect("read index");
        assert_eq!(cached, index);
    }

    #[test]
    fn workspace_index_read_missing_cache_returns_empty_index() {
        let workspace = TempWorkspace::new("index-missing");

        let index = workspace_index_read(workspace.root()).expect("read missing index");

        assert_eq!(index.version, 1);
        assert!(index.ids.is_empty());
        assert!(!workspace.path.join(".doxmind/index.json").exists());
    }

    #[test]
    fn workspace_index_read_rejects_escaped_cached_paths() {
        let workspace = TempWorkspace::new("index-escape");
        write_file(
            &workspace.path.join(".doxmind/index.json"),
            r#"{"version":1,"ids":{"bad":"../outside.md"}}"#,
        );

        assert!(workspace_index_read(workspace.root()).is_err());
    }

    #[test]
    fn workspace_markdown_search_finds_content_and_ignores_cache_dirs() {
        let workspace = TempWorkspace::new("markdown-search");
        write_file(
            &workspace.path.join("Notes.md"),
            "---\nid: notes\ntitle: \"Meeting Notes\"\n---\n\nAlpha roadmap\nbeta ALPHA\n",
        );
        write_file(&workspace.path.join("Other.md"), "# Other\nNo match\n");
        write_file(
            &workspace.path.join(".doxmind/Indexed.md"),
            "Alpha hidden\n",
        );
        write_file(
            &workspace.path.join("node_modules/pkg/Readme.md"),
            "Alpha dependency\n",
        );

        let results = workspace_markdown_search(workspace.root(), "alpha".into(), Some(10))
            .expect("search markdown");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "notes");
        assert_eq!(results[0].path, "Notes.md");
        assert_eq!(results[0].name, "Notes.md");
        assert_eq!(results[0].title.as_deref(), Some("Meeting Notes"));
        assert_eq!(results[0].matches.len(), 2);
        assert_eq!(results[0].matches[0].line, 6);
        assert_eq!(results[0].matches[0].preview, "Alpha roadmap");
        assert_eq!(results[0].matches[1].line, 7);
        assert_eq!(results[0].matches[1].preview, "beta ALPHA");
    }

    #[test]
    fn workspace_markdown_search_rejects_empty_query() {
        let workspace = TempWorkspace::new("markdown-search-empty");

        assert!(workspace_markdown_search(workspace.root(), "  ".into(), None).is_err());
    }

    #[test]
    fn workspace_import_asset_writes_relative_assets_without_overwrite() {
        let workspace = TempWorkspace::new("asset-import");
        write_file(&workspace.path.join("notes/doc.md"), "# Doc\n");
        write_file(&workspace.path.join("notes/assets/image.png"), "old");

        let imported = workspace_import_asset(
            workspace.root(),
            "notes/doc.md".into(),
            "../image.png".into(),
            vec![1, 2, 3],
        )
        .expect("import asset");

        assert_eq!(imported.path, "./assets/image (2).png");
        assert_eq!(
            fs::read(workspace.path.join("notes/assets/image (2).png")).expect("read asset"),
            vec![1, 2, 3]
        );
        assert!(!workspace.path.join("image.png").exists());
    }

    #[test]
    fn workspace_paths_reject_escape_segments() {
        let workspace = TempWorkspace::new("path-escape");
        let root = canonical_workspace_root(&workspace.root()).expect("root");

        assert!(resolve_workspace_path_for_write(&root, "../outside.md").is_err());
        assert!(resolve_workspace_path_for_write(&root, "/tmp/outside.md").is_err());
    }

    #[test]
    fn workspace_paths_reject_symlink_escape_for_write_parent() {
        #[cfg(unix)]
        {
            let workspace = TempWorkspace::new("symlink-escape");
            let outside = TempWorkspace::new("outside");
            std::os::unix::fs::symlink(&outside.path, workspace.path.join("link"))
                .expect("create symlink");
            let root = canonical_workspace_root(&workspace.root()).expect("root");

            assert!(resolve_workspace_path_for_write(&root, "link/doc.md").is_err());
        }
    }

    #[test]
    fn doc_import_external_copies_md_and_leaves_source_untouched() {
        let workspace = TempWorkspace::new("import-create-md");
        // Simulate the user's Downloads folder with a separate temp dir so we
        // exercise the cross-directory copy path the real OS DnD takes.
        let downloads = TempWorkspace::new("import-downloads");
        let src = downloads.path.join("Plan.md");
        let payload = b"# Plan\n\nbody\n";
        write_file(&src, std::str::from_utf8(payload).unwrap());

        let doc = doc_import_external(
            workspace.root(),
            Some(src.to_string_lossy().into_owned()),
            None,
            Some(String::new()),
            "Plan.md".into(),
            "create".into(),
        )
        .expect("import md");

        assert_eq!(doc.path, "Plan.md");
        assert_eq!(
            fs::read(workspace.path.join("Plan.md")).expect("read copied"),
            payload
        );
        // Source file untouched — both presence and bytes are byte-identical.
        // This is the always-copy invariant: doXmind never moves user files
        // out from under them on external DnD.
        assert!(src.exists(), "source must remain in place after copy");
        assert_eq!(
            fs::read(&src).expect("read source"),
            payload,
            "source bytes must be unchanged after import"
        );
    }

    #[test]
    fn doc_import_external_copies_into_dest_folder() {
        let workspace = TempWorkspace::new("import-create-folder");
        std::fs::create_dir_all(workspace.path.join("Notes")).expect("create Notes");
        let src_dir = TempWorkspace::new("import-src-pdf");
        let src = src_dir.path.join("Spec.pdf");
        let payload = b"%PDF-1.4\nspec\n";
        write_file(&src, std::str::from_utf8(payload).unwrap());

        let doc = doc_import_external(
            workspace.root(),
            Some(src.to_string_lossy().into_owned()),
            None,
            Some("Notes".into()),
            "Spec.pdf".into(),
            "create".into(),
        )
        .expect("import pdf");

        assert_eq!(doc.path, "Notes/Spec.pdf");
        assert!(workspace.path.join("Notes/Spec.pdf").exists());
        assert_eq!(fs::read(&src).expect("source bytes"), payload);
    }

    #[test]
    fn doc_import_external_accepts_bytes_for_browser_dev() {
        let workspace = TempWorkspace::new("import-bytes");
        let payload = b"PK\x03\x04dummy";

        let doc = doc_import_external(
            workspace.root(),
            None,
            Some(payload.to_vec()),
            Some(String::new()),
            "Q3.xlsx".into(),
            "create".into(),
        )
        .expect("import xlsx");

        assert_eq!(doc.path, "Q3.xlsx");
        assert_eq!(
            fs::read(workspace.path.join("Q3.xlsx")).expect("read xlsx"),
            payload
        );
    }

    #[test]
    fn doc_import_external_rejects_collision() {
        let workspace = TempWorkspace::new("import-collision");
        write_file(&workspace.path.join("Plan.md"), "existing");
        let src_dir = TempWorkspace::new("import-collision-src");
        let src = src_dir.path.join("Plan.md");
        write_file(&src, "incoming");

        let err = doc_import_external(
            workspace.root(),
            Some(src.to_string_lossy().into_owned()),
            None,
            Some(String::new()),
            "Plan.md".into(),
            "create".into(),
        )
        .expect_err("collision should error");

        assert!(
            err.contains("already exists"),
            "unexpected collision error: {err}"
        );
        // Always-copy semantics survive the error path: source is untouched
        // AND the existing destination keeps its content.
        assert_eq!(fs::read_to_string(&src).expect("source"), "incoming");
        assert_eq!(
            fs::read_to_string(workspace.path.join("Plan.md")).expect("dest"),
            "existing"
        );
    }

    #[test]
    fn doc_import_external_rejects_non_whitelisted_extension() {
        let workspace = TempWorkspace::new("import-bad-ext");
        let src_dir = TempWorkspace::new("import-bad-ext-src");
        let src = src_dir.path.join("notes.txt");
        write_file(&src, "hi");

        let err = doc_import_external(
            workspace.root(),
            Some(src.to_string_lossy().into_owned()),
            None,
            Some(String::new()),
            "notes.txt".into(),
            "create".into(),
        )
        .expect_err("non-whitelisted should error");
        assert!(
            err.contains("only .md, .pdf, .xlsx are supported"),
            "unexpected error: {err}"
        );
        assert!(
            !workspace.path.join("notes.txt").exists(),
            "no copy should land on disk"
        );
    }

    #[test]
    fn doc_import_external_rejects_unknown_mode() {
        let workspace = TempWorkspace::new("import-unknown-mode");
        let src_dir = TempWorkspace::new("import-unknown-mode-src");
        let src = src_dir.path.join("Plan.md");
        write_file(&src, "x");

        let err = doc_import_external(
            workspace.root(),
            Some(src.to_string_lossy().into_owned()),
            None,
            Some(String::new()),
            "Plan.md".into(),
            "rename-and-pray".into(),
        )
        .expect_err("unknown mode should error");
        assert!(err.contains("unsupported import mode"), "unexpected: {err}");
    }

    #[test]
    fn doc_import_external_replace_overwrites_user_file_and_leaves_sidecar_untouched() {
        // Sidecar-untouched invariant: `mode: "replace"` rewrites the user
        // file (.md/.pdf/.xlsx) but the pre-existing `.doxmind` sidecar must
        // be byte-identical afterwards. The next open will trip the
        // Stale-sidecar / Salvage path because the markdown_hash no longer
        // matches — that's the right behavior since at the FS level a
        // Replace is indistinguishable from an external edit.
        let workspace = TempWorkspace::new("import-replace-md");
        // Pre-existing destination pair.
        let dest_md = workspace.path.join("Plan.md");
        write_file(&dest_md, "# Old\n");
        let sidecar_path = workspace.path.join(".Plan.doxmind");
        let sidecar_payload =
            br#"{"version":1,"id":"fixed-id","html":"<p>old</p>","markdown_hash":"sha256:dead","extras":{"databases":{"x":1}}}"#;
        fs::write(&sidecar_path, sidecar_payload).expect("write sidecar");

        // Source file from a "Downloads" temp dir.
        let downloads = TempWorkspace::new("import-replace-md-src");
        let src = downloads.path.join("Plan.md");
        let new_payload = b"# New\n\nfresh body\n";
        write_file(&src, std::str::from_utf8(new_payload).unwrap());

        let doc = doc_import_external(
            workspace.root(),
            Some(src.to_string_lossy().into_owned()),
            None,
            Some(String::new()),
            "Plan.md".into(),
            "replace".into(),
        )
        .expect("replace import");

        assert_eq!(doc.path, "Plan.md");
        // User file overwritten with the source bytes.
        assert_eq!(fs::read(&dest_md).expect("dest"), new_payload);
        // Always-copy: source untouched.
        assert_eq!(fs::read(&src).expect("src"), new_payload);
        // SIDECAR INVARIANT: byte-identical. This is the load-bearing assertion.
        assert_eq!(
            fs::read(&sidecar_path).expect("sidecar"),
            sidecar_payload,
            "the .doxmind sidecar must be byte-identical after replace"
        );
    }

    #[test]
    fn doc_import_external_replace_via_bytes_leaves_sidecar_untouched() {
        // Same invariant via the browser-dev `bytes` payload path.
        let workspace = TempWorkspace::new("import-replace-bytes");
        let dest = workspace.path.join("Q3.xlsx");
        write_file(&dest, "old");
        let sidecar_path = workspace.path.join(".Q3.doxmind");
        let sidecar_payload = br#"{"version":1,"id":"x","html":""}"#;
        fs::write(&sidecar_path, sidecar_payload).expect("write sidecar");

        let new_payload = b"PK\x03\x04new bytes";
        let doc = doc_import_external(
            workspace.root(),
            None,
            Some(new_payload.to_vec()),
            Some(String::new()),
            "Q3.xlsx".into(),
            "replace".into(),
        )
        .expect("replace via bytes");

        assert_eq!(doc.path, "Q3.xlsx");
        assert_eq!(fs::read(&dest).expect("dest"), new_payload);
        assert_eq!(
            fs::read(&sidecar_path).expect("sidecar"),
            sidecar_payload,
            "sidecar must survive byte-identical across a bytes-mode replace"
        );
    }

    #[test]
    fn doc_import_external_replace_requires_existing_destination() {
        // Replace presupposes a pre-existing file. If the destination
        // vanished between plan and resolve, surface a clear error rather
        // than silently degrading to create — that would mask a race with
        // an external delete.
        let workspace = TempWorkspace::new("import-replace-missing");
        let src_dir = TempWorkspace::new("import-replace-missing-src");
        let src = src_dir.path.join("Missing.md");
        write_file(&src, "x");

        let err = doc_import_external(
            workspace.root(),
            Some(src.to_string_lossy().into_owned()),
            None,
            Some(String::new()),
            "Missing.md".into(),
            "replace".into(),
        )
        .expect_err("missing destination should error in replace mode");
        assert!(err.contains("does not exist"), "unexpected error: {err}");
    }

    #[test]
    fn doc_move_moves_markdown_and_sidecar_pair() {
        let workspace = TempWorkspace::new("move-pair");
        write_file(&workspace.path.join("a.md"), "# A\n");
        write_file(&workspace.path.join(".a.doxmind"), r#"{"id":"a"}"#);

        let doc = move_document_pair(&workspace.root(), "a.md", "folder/b.md").expect("move pair");

        assert_eq!(doc.path, "folder/b.md");
        assert!(workspace.path.join("folder/b.md").exists());
        assert!(workspace.path.join("folder/.b.doxmind").exists());
        assert!(!workspace.path.join("a.md").exists());
        assert!(!workspace.path.join(".a.doxmind").exists());
    }

    #[test]
    fn doc_move_moves_folder_with_nested_pairs_atomically() {
        // Mirrors `doc_move_moves_markdown_and_sidecar_pair` but for the
        // folder branch added in #66. The OS-level directory rename moves
        // every nested `.md` + `.doxmind` pair as part of the same operation;
        // this test guards the contract surfaced through `doc_move`.
        let workspace = TempWorkspace::new("move-folder");
        std::fs::create_dir_all(workspace.path.join("notes/inbox")).expect("create subfolders");
        write_file(&workspace.path.join("notes/a.md"), "# A\n");
        write_file(&workspace.path.join("notes/.a.doxmind"), r#"{"id":"a"}"#);
        write_file(&workspace.path.join("notes/inbox/b.md"), "# B\n");
        write_file(
            &workspace.path.join("notes/inbox/.b.doxmind"),
            r#"{"id":"b"}"#,
        );

        let result = doc_move(workspace.root(), "notes".into(), "archive/notes".into())
            .expect("move folder");

        match result {
            MoveResultDto::Folder { path } => assert_eq!(path, "archive/notes"),
            MoveResultDto::Document(_) => panic!("expected Folder result"),
        }

        // Old subtree gone.
        assert!(!workspace.path.join("notes").exists());

        // New subtree has every nested document AND its sidecar — pair atomicity per ADR 0005.
        assert!(workspace.path.join("archive/notes/a.md").exists());
        assert!(workspace.path.join("archive/notes/.a.doxmind").exists());
        assert!(workspace.path.join("archive/notes/inbox/b.md").exists());
        assert!(workspace
            .path
            .join("archive/notes/inbox/.b.doxmind")
            .exists());
    }

    #[test]
    fn doc_move_rejects_folder_destination_collision() {
        let workspace = TempWorkspace::new("move-folder-collision");
        std::fs::create_dir_all(workspace.path.join("a")).expect("create a");
        std::fs::create_dir_all(workspace.path.join("b")).expect("create b");

        let err = doc_move(workspace.root(), "a".into(), "b".into())
            .expect_err("destination collision must reject");

        assert!(
            err.contains("destination already exists"),
            "unexpected error: {err}"
        );
        // Both folders still present — no partial state.
        assert!(workspace.path.join("a").is_dir());
        assert!(workspace.path.join("b").is_dir());
    }

    #[test]
    fn doc_delete_removes_markdown_and_sidecar_pair_from_workspace() {
        let workspace = TempWorkspace::new("delete-pair");
        write_file(&workspace.path.join("a.md"), "# A\n");
        write_file(&workspace.path.join(".a.doxmind"), r#"{"id":"a"}"#);

        let deleted = doc_delete(workspace.root(), "a.md".into()).expect("delete pair");

        assert_eq!(deleted.path, "a.md");
        assert_eq!(deleted.sidecar_path.as_deref(), Some(".a.doxmind"));
        // Both files leave the workspace. In production the OS trash receives
        // them as two separate entries; under the test cfg the shim hard-deletes
        // them — what matters here is the workspace contract.
        assert!(!workspace.path.join("a.md").exists());
        assert!(!workspace.path.join(".a.doxmind").exists());
        // No workspace-internal `.trash/` directory should be created any more.
        assert!(!workspace.path.join(".trash").exists());
    }

    #[test]
    fn doc_delete_without_sidecar_succeeds() {
        let workspace = TempWorkspace::new("delete-no-sidecar");
        write_file(&workspace.path.join("solo.md"), "# Solo\n");

        let deleted = doc_delete(workspace.root(), "solo.md".into()).expect("delete solo");

        assert_eq!(deleted.path, "solo.md");
        assert!(deleted.sidecar_path.is_none());
        assert!(!workspace.path.join("solo.md").exists());
        assert!(!workspace.path.join(".trash").exists());
    }

    #[test]
    fn workspace_delete_folder_removes_subtree_from_workspace() {
        let workspace = TempWorkspace::new("delete-folder");
        std::fs::create_dir_all(workspace.path.join("notes")).expect("create notes");
        write_file(&workspace.path.join("notes/a.md"), "# A\n");
        write_file(&workspace.path.join("notes/.a.doxmind"), r#"{"id":"a"}"#);

        let deleted =
            workspace_delete_folder(workspace.root(), "notes".into()).expect("delete folder");

        assert_eq!(deleted.path, "notes");
        assert!(deleted.sidecar_path.is_none());
        assert!(!workspace.path.join("notes").exists());
        assert!(!workspace.path.join(".trash").exists());
    }

    #[test]
    fn doc_delete_pdf_removes_pair_from_workspace() {
        let workspace = TempWorkspace::new("delete-pdf");
        write_file(&workspace.path.join("Spec.pdf"), "%PDF-1.4\n%%EOF\n");
        write_file(&workspace.path.join(".Spec.pdf.doxmind"), r#"{"id":"pdf"}"#);

        let deleted = doc_delete(workspace.root(), "Spec.pdf".into()).expect("delete pdf");

        assert_eq!(deleted.path, "Spec.pdf");
        assert_eq!(deleted.sidecar_path.as_deref(), Some(".Spec.pdf.doxmind"));
        assert!(!workspace.path.join("Spec.pdf").exists());
        assert!(!workspace.path.join(".Spec.pdf.doxmind").exists());
        assert!(!workspace.path.join(".trash").exists());
    }

    #[test]
    fn doc_delete_xlsx_removes_pair_from_workspace() {
        let workspace = TempWorkspace::new("delete-xlsx");
        write_file(&workspace.path.join("Budget.xlsx"), "PK\x03\x04");
        write_file(
            &workspace.path.join(".Budget.xlsx.doxmind"),
            r#"{"id":"xlsx"}"#,
        );

        let deleted = doc_delete(workspace.root(), "Budget.xlsx".into()).expect("delete xlsx");

        assert_eq!(deleted.path, "Budget.xlsx");
        assert_eq!(
            deleted.sidecar_path.as_deref(),
            Some(".Budget.xlsx.doxmind")
        );
        assert!(!workspace.path.join("Budget.xlsx").exists());
        assert!(!workspace.path.join(".Budget.xlsx.doxmind").exists());
        assert!(!workspace.path.join(".trash").exists());
    }

    #[test]
    fn excel_read_migrates_legacy_sidecar_into_block_slot() {
        let _lock = MIGRATE_ENV_LOCK.lock().unwrap_or_else(|err| err.into_inner());
        let workspace = TempWorkspace::new("excel-migrate-legacy");
        let workbook_path = workspace.path.join("Budget.xlsx");
        let workbook_bytes = b"PK\x03\x04workbook";
        fs::write(&workbook_path, workbook_bytes).expect("write workbook");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&workbook_path);
        let legacy = serde_json::json!({
            "version": 1,
            "id": "path:legacy-budget",
            "source_path": "Budget.xlsx",
            "updated_at_unix_nanos": "1",
            "excel_editor": { "version": 1, "activeSheetId": "Sheet1" },
            "excel_parsed_cache": {
                "sourceHash": "abc",
                "parsed": { "sheets": [] }
            },
            "extras": { "unrelated": { "kept": true } }
        });
        let legacy_bytes = serde_json::to_vec_pretty(&legacy).expect("legacy bytes");
        fs::write(&sidecar_path, &legacy_bytes).expect("write legacy sidecar");

        let editor = workspace_read_excel_editor_state(workspace.root(), "Budget.xlsx".into())
            .expect("read migrated editor")
            .expect("editor state");

        assert_eq!(editor["activeSheetId"], "Sheet1");
        assert_eq!(fs::read(&workbook_path).expect("workbook"), workbook_bytes);
        assert_eq!(
            fs::read(sidecar_bak_path(&sidecar_path)).expect("backup"),
            legacy_bytes
        );

        let migrated = read_json_file(&sidecar_path);
        assert!(migrated.get(EXCEL_LEGACY_EDITOR_KEY).is_none());
        assert!(migrated.get(EXCEL_LEGACY_PARSED_CACHE_KEY).is_none());
        assert!(migrated.get("source_path").is_none());
        assert_eq!(migrated["id"], "path:legacy-budget");
        assert_eq!(migrated["extras"]["unrelated"]["kept"], true);
        let (_block_id, slot) = only_excel_slot(&migrated);
        assert_eq!(slot["editor"]["activeSheetId"], "Sheet1");
        assert_eq!(slot["parsedCache"]["sourceHash"], "abc");
        assert!(migrated["html"]
            .as_str()
            .expect("html")
            .contains(EXCEL_BLOCK_TYPE));
        assert_eq!(
            migrated["markdown_hash"]
                .as_str()
                .expect("markdown hash")
                .len(),
            64
        );
    }

    #[test]
    fn excel_read_uses_already_migrated_block_slot_without_backup() {
        let workspace = TempWorkspace::new("excel-read-migrated");
        let workbook_path = workspace.path.join("Budget.xlsx");
        write_file(&workbook_path, "PK\x03\x04");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&workbook_path);
        // v1 markdown-shape sidecar emitted by an older Python runtime; read
        // must tolerate it, and the next explicit write must rewrite to v2.
        fs::write(
            &sidecar_path,
            serde_json::to_vec_pretty(&serde_json::json!({
                "version": 1,
                "id": "doc-1",
                "html": excel_placeholder("excel-1", "Budget.xlsx"),
                "markdown_hash": "stale-but-not-checked-here",
                "updated_at": "2026-05-12T00:00:00Z",
                "extras": {
                    "blocks": {
                        "excel-1": {
                            "editor": { "version": 1, "activeSheetId": "Sheet2" }
                        }
                    }
                }
            }))
            .expect("sidecar bytes"),
        )
        .expect("write sidecar");

        let editor = workspace_read_excel_editor_state(workspace.root(), "Budget.xlsx".into())
            .expect("read editor")
            .expect("editor");

        assert_eq!(editor["activeSheetId"], "Sheet2");
        assert!(!sidecar_bak_path(&sidecar_path).exists());

        // Explicit editor write rewrites the sidecar in v2 shape.
        workspace_write_excel_editor_state(
            workspace.root(),
            "Budget.xlsx".into(),
            serde_json::json!({ "version": 1, "activeSheetId": "Sheet3" }),
        )
        .expect("write editor");

        let sidecar = read_json_file(&sidecar_path);
        assert_eq!(
            sidecar["version"],
            serde_json::json!(doxmind_sidecar::SIDECAR_VERSION)
        );
    }

    #[test]
    fn excel_sidecar_same_id_duplicate_placeholders_error_without_rewrite() {
        let workspace = TempWorkspace::new("excel-duplicate-placeholder");
        let workbook_path = workspace.path.join("Budget.xlsx");
        write_file(&workbook_path, "PK\x03\x04");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&workbook_path);
        fs::write(
            &sidecar_path,
            serde_json::to_vec_pretty(&serde_json::json!({
                "version": doxmind_sidecar::SIDECAR_VERSION,
                "id": "doc-1",
                "html": format!(
                    "{}\n{}",
                    excel_placeholder("excel-1", "Budget.xlsx"),
                    excel_placeholder("excel-1", "Budget.xlsx")
                ),
                "markdown_hash": "old",
                "updated_at": "2026-05-12T00:00:00Z",
                "extras": {
                    "blocks": {
                        "excel-1": {
                            "editor": { "version": 1, "activeSheetId": "Sheet2" }
                        }
                    }
                }
            }))
            .expect("sidecar bytes"),
        )
        .expect("write sidecar");
        let raw_before = fs::read(&sidecar_path).expect("read sidecar before");

        let err = workspace_read_excel_doc_state(workspace.root(), "Budget.xlsx".into())
            .expect_err("duplicate placeholders must fail visibly");

        assert!(
            err.contains("duplicate excel-block placeholder id(s): excel-1"),
            "{err}"
        );
        assert_eq!(
            fs::read(&sidecar_path).expect("read sidecar after"),
            raw_before
        );
    }

    #[test]
    fn excel_sidecar_different_id_duplicate_placeholders_error_without_rewrite() {
        let workspace = TempWorkspace::new("excel-multi-placeholder");
        let workbook_path = workspace.path.join("Budget.xlsx");
        write_file(&workbook_path, "PK\x03\x04");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&workbook_path);
        fs::write(
            &sidecar_path,
            serde_json::to_vec_pretty(&serde_json::json!({
                "version": doxmind_sidecar::SIDECAR_VERSION,
                "id": "doc-1",
                "html": format!(
                    "{}\n{}",
                    excel_placeholder("excel-A", "Budget.xlsx"),
                    excel_placeholder("excel-B", "Budget.xlsx")
                ),
                "markdown_hash": "old",
                "updated_at": "2026-05-12T00:00:00Z",
                "extras": {
                    "blocks": {
                        "excel-A": {},
                        "excel-B": {}
                    }
                }
            }))
            .expect("sidecar bytes"),
        )
        .expect("write sidecar");
        let raw_before = fs::read(&sidecar_path).expect("read sidecar before");

        let err = workspace_read_excel_doc_state(workspace.root(), "Budget.xlsx".into())
            .expect_err("multiple placeholders must fail visibly");

        assert!(
            err.contains(
                "multiple excel-block placeholders; Synthetic Documents require exactly one"
            ),
            "{err}"
        );
        assert!(!err.contains("duplicate"), "{err}");
        assert_eq!(
            fs::read(&sidecar_path).expect("read sidecar after"),
            raw_before
        );
    }

    #[test]
    fn excel_editor_write_prunes_orphan_extras_blocks_slots() {
        // Symmetric to `pdf_editor_write_prunes_orphan_extras_blocks_slots`
        // (issue #96).
        let workspace = TempWorkspace::new("excel-orphan-prune");
        let workbook_path = workspace.path.join("Budget.xlsx");
        write_file(&workbook_path, "PK\x03\x04");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&workbook_path);
        fs::write(
            &sidecar_path,
            serde_json::to_vec_pretty(&serde_json::json!({
                "version": doxmind_sidecar::SIDECAR_VERSION,
                "id": "doc-1",
                "html": excel_placeholder("keep", "Budget.xlsx"),
                "markdown_hash": "old",
                "updated_at": "2026-05-12T00:00:00Z",
                "extras": {
                    "blocks": {
                        "keep": { "editor": { "version": 1, "activeSheetId": "Sheet1" } },
                        "orphan": { "editor": { "version": 1, "activeSheetId": "Stale" } }
                    }
                }
            }))
            .expect("sidecar bytes"),
        )
        .expect("write sidecar");

        workspace_write_excel_editor_state(
            workspace.root(),
            "Budget.xlsx".into(),
            serde_json::json!({ "version": 1, "activeSheetId": "Sheet2" }),
        )
        .expect("write editor state");

        let after = read_json_file(&sidecar_path);
        let blocks = after["extras"]["blocks"]
            .as_object()
            .expect("extras.blocks object");
        assert_eq!(
            blocks.len(),
            1,
            "orphan slot must be pruned; got: {:?}",
            blocks.keys().collect::<Vec<_>>()
        );
        assert!(blocks.contains_key("keep"));
        assert!(!blocks.contains_key("orphan"));
    }

    #[test]
    fn excel_missing_sidecar_is_synthesized_with_empty_slot() {
        let workspace = TempWorkspace::new("excel-missing-sidecar");
        let workbook_path = workspace.path.join("Budget.xlsx");
        let workbook_bytes = b"PK\x03\x04missing";
        fs::write(&workbook_path, workbook_bytes).expect("write workbook");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&workbook_path);
        assert!(!sidecar_path.exists());

        let editor = workspace_read_excel_editor_state(workspace.root(), "Budget.xlsx".into())
            .expect("read synthesized sidecar");

        // Read paths must NOT touch disk; the sidecar only materializes on
        // the first explicit write.
        assert!(editor.is_none());
        assert_eq!(fs::read(&workbook_path).expect("workbook"), workbook_bytes);
        assert!(
            !sidecar_path.exists(),
            "missing-sidecar read must not write to disk"
        );

        // First explicit editor write materializes the sidecar in v2 shape.
        workspace_write_excel_editor_state(
            workspace.root(),
            "Budget.xlsx".into(),
            serde_json::json!({ "activeSheetId": "Sheet1" }),
        )
        .expect("write editor state");

        assert!(sidecar_path.exists(), "explicit write creates the sidecar");
        let sidecar = read_json_file(&sidecar_path);
        assert_eq!(
            sidecar["version"],
            serde_json::json!(doxmind_sidecar::SIDECAR_VERSION)
        );
        assert!(sidecar.get(EXCEL_LEGACY_EDITOR_KEY).is_none());
        assert!(sidecar.get(EXCEL_LEGACY_PARSED_CACHE_KEY).is_none());
        let (_block_id, _slot) = only_excel_slot(&sidecar);
    }

    #[test]
    fn excel_corrupt_sidecar_errors_and_writes_forensic_copy() {
        let workspace = TempWorkspace::new("excel-corrupt-sidecar");
        let workbook_path = workspace.path.join("Broken.xlsx");
        write_file(&workbook_path, "PK\x03\x04");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&workbook_path);
        let corrupt = b"{\"version\": 1";
        fs::write(&sidecar_path, corrupt).expect("write corrupt sidecar");

        let err = workspace_read_excel_editor_state(workspace.root(), "Broken.xlsx".into())
            .expect_err("corrupt sidecar should fail");

        assert!(err.contains("invalid Excel sidecar JSON"), "{err}");
        assert!(err.contains("forensic copy"), "{err}");
        assert_eq!(fs::read(&sidecar_path).expect("original sidecar"), corrupt);
        let copies = fs::read_dir(&workspace.path)
            .expect("read workspace")
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".Broken.xlsx.doxmind.corrupt-")
            })
            .collect::<Vec<_>>();
        assert_eq!(copies.len(), 1);
        assert_eq!(fs::read(copies[0].path()).expect("forensic copy"), corrupt);
    }

    #[test]
    fn excel_editor_write_preserves_existing_cache_and_unrelated_extras() {
        let workspace = TempWorkspace::new("excel-write-editor");
        let workbook_path = workspace.path.join("Budget.xlsx");
        write_file(&workbook_path, "PK\x03\x04");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&workbook_path);
        fs::write(
            &sidecar_path,
            serde_json::to_vec_pretty(&serde_json::json!({
                "version": 1,
                "id": "doc-1",
                "html": excel_placeholder("excel-1", "Budget.xlsx"),
                "markdown_hash": "old",
                "updated_at": "2026-05-12T00:00:00Z",
                "extras": {
                    "theme": { "name": "quiet" },
                    "blocks": {
                        "excel-1": {
                            "parsedCache": {
                                "sourceHash": "abc",
                                "parsed": { "sheets": [] }
                            }
                        }
                    }
                }
            }))
            .expect("sidecar bytes"),
        )
        .expect("write sidecar");

        workspace_write_excel_editor_state(
            workspace.root(),
            "Budget.xlsx".into(),
            serde_json::json!({ "version": 1, "activeSheetId": "Sheet3" }),
        )
        .expect("write editor");

        let sidecar = read_json_file(&sidecar_path);
        assert!(sidecar.get(EXCEL_LEGACY_EDITOR_KEY).is_none());
        assert!(sidecar.get(EXCEL_LEGACY_PARSED_CACHE_KEY).is_none());
        assert_eq!(sidecar["extras"]["theme"]["name"], "quiet");
        let (_block_id, slot) = only_excel_slot(&sidecar);
        assert_eq!(slot["editor"]["activeSheetId"], "Sheet3");
        assert_eq!(slot["parsedCache"]["sourceHash"], "abc");
    }

    #[test]
    fn excel_editor_write_does_not_create_parsed_cache() {
        let workspace = TempWorkspace::new("excel-write-editor-no-cache");
        let workbook_path = workspace.path.join("Budget.xlsx");
        write_file(&workbook_path, "PK\x03\x04");

        workspace_write_excel_editor_state(
            workspace.root(),
            "Budget.xlsx".into(),
            serde_json::json!({ "version": 1, "activeSheetId": "Sheet1" }),
        )
        .expect("write editor");

        let sidecar = read_json_file(&doxmind_sidecar::sidecar_path_for(&workbook_path));
        let (_block_id, slot) = only_excel_slot(&sidecar);
        assert_eq!(slot["editor"]["activeSheetId"], "Sheet1");
        assert!(slot.get("parsedCache").is_none());
    }

    #[test]
    fn excel_editor_read_skips_large_parsed_cache_slot() {
        let workspace = TempWorkspace::new("excel-read-editor-light");
        let workbook_path = workspace.path.join("Budget.xlsx");
        write_file(&workbook_path, "PK\x03\x04");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&workbook_path);
        let large_cache = "x".repeat(1024 * 1024);
        fs::write(
            &sidecar_path,
            serde_json::to_vec_pretty(&serde_json::json!({
                "version": 1,
                "id": "doc-1",
                "html": excel_placeholder("excel-1", "Budget.xlsx"),
                "markdown_hash": "old",
                "updated_at": "2026-05-12T00:00:00Z",
                "extras": {
                    "blocks": {
                        "excel-1": {
                            "editor": { "version": 1, "activeSheetId": "Sheet1" },
                            "parsedCache": {
                                "sourceHash": "abc",
                                "parsed": { "blob": large_cache }
                            }
                        }
                    }
                }
            }))
            .expect("sidecar bytes"),
        )
        .expect("write sidecar");

        let editor = workspace_read_excel_editor_state(workspace.root(), "Budget.xlsx".into())
            .expect("read editor")
            .expect("editor state");

        assert_eq!(editor["activeSheetId"], "Sheet1");
        assert!(editor.get("parsedCache").is_none());
    }

    #[test]
    fn excel_parsed_cache_write_preserves_editor_and_unrelated_extras() {
        let workspace = TempWorkspace::new("excel-write-cache");
        let workbook_path = workspace.path.join("Budget.xlsx");
        write_file(&workbook_path, "PK\x03\x04");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&workbook_path);
        fs::write(
            &sidecar_path,
            serde_json::to_vec_pretty(&serde_json::json!({
                "version": 1,
                "id": "doc-1",
                "html": excel_placeholder("excel-1", "Budget.xlsx"),
                "markdown_hash": "old",
                "updated_at": "2026-05-12T00:00:00Z",
                "extras": {
                    "view": { "zoom": 0.9 },
                    "blocks": {
                        "excel-1": {
                            "editor": { "version": 1, "activeSheetId": "Sheet1" }
                        }
                    }
                }
            }))
            .expect("sidecar bytes"),
        )
        .expect("write sidecar");

        workspace_write_excel_parsed_cache(
            workspace.root(),
            "Budget.xlsx".into(),
            "def".into(),
            serde_json::json!({ "sheets": [{ "id": "Sheet1" }] }),
        )
        .expect("write parsed cache");

        let sidecar = read_json_file(&sidecar_path);
        assert!(sidecar.get(EXCEL_LEGACY_EDITOR_KEY).is_none());
        assert!(sidecar.get(EXCEL_LEGACY_PARSED_CACHE_KEY).is_none());
        assert_eq!(sidecar["extras"]["view"]["zoom"], 0.9);
        let (_block_id, slot) = only_excel_slot(&sidecar);
        assert_eq!(slot["editor"]["activeSheetId"], "Sheet1");
        assert_eq!(slot["parsedCache"]["sourceHash"], "def");
        assert_eq!(slot["parsedCache"]["parsed"]["sheets"][0]["id"], "Sheet1");
    }

    #[test]
    fn excel_cross_runtime_fixture_editor_and_cache_writes_match_contract() {
        let workspace = TempWorkspace::new("excel-cross-runtime-shape");
        let sidecar_path =
            install_compat_fixture(&workspace, "Budget.xlsx", EXCEL_MARKDOWN_SHAPE_FIXTURE);

        let initial = workspace_read_excel_doc_state(workspace.root(), "Budget.xlsx".into())
            .expect("read fixture")
            .expect("state");
        assert_eq!(initial["parsedCache"]["sourceHash"], "valid-excel-hash");

        let editor = serde_json::json!({
            "version": 1,
            "activeSheetId": "Sheet2",
            "sheets": [{"id": "Sheet2", "name": "Desktop"}]
        });
        workspace_write_excel_editor_state(workspace.root(), "Budget.xlsx".into(), editor.clone())
            .expect("write editor");
        let after_editor = workspace_read_excel_doc_state(workspace.root(), "Budget.xlsx".into())
            .expect("read after editor")
            .expect("state");
        assert_eq!(after_editor["editor"], editor);
        assert_eq!(after_editor["parsedCache"], initial["parsedCache"]);

        let parsed = serde_json::json!({"sheets": [{"id": "Sheet2", "rows": 4}]});
        workspace_write_excel_parsed_cache(
            workspace.root(),
            "Budget.xlsx".into(),
            "valid-excel-hash-2".into(),
            parsed.clone(),
        )
        .expect("write cache");

        let sidecar = read_json_file(&sidecar_path);
        assert_no_legacy_fields(
            &sidecar,
            &[EXCEL_LEGACY_EDITOR_KEY, EXCEL_LEGACY_PARSED_CACHE_KEY],
        );
        assert!(sidecar["html"]
            .as_str()
            .expect("html")
            .contains("id=\"fixture-excel-block\""));
        assert_eq!(sidecar["extras"]["unrelated"]["keep"], true);
        let slot = sidecar["extras"]["blocks"]["fixture-excel-block"]
            .as_object()
            .expect("slot");
        assert_eq!(slot["editor"], editor);
        assert_eq!(slot["parsedCache"]["sourceHash"], "valid-excel-hash-2");
        assert_eq!(slot["parsedCache"]["parsed"], parsed);
        assert_eq!(slot["slotExtra"]["keep"], "excel");
    }

    #[test]
    fn excel_cross_runtime_legacy_fixture_migrates_to_shared_shape() {
        let _lock = MIGRATE_ENV_LOCK.lock().unwrap_or_else(|err| err.into_inner());
        let workspace = TempWorkspace::new("excel-cross-runtime-legacy");
        let sidecar_path = install_compat_fixture(&workspace, "Budget.xlsx", EXCEL_LEGACY_FIXTURE);

        let migrated = workspace_read_excel_doc_state(workspace.root(), "Budget.xlsx".into())
            .expect("read migrated")
            .expect("state");
        assert_eq!(migrated["editor"]["activeSheetId"], "LegacySheet");
        assert_eq!(migrated["parsedCache"]["sourceHash"], "legacy-excel-hash");
        assert!(sidecar_bak_path(&sidecar_path).exists());

        let sidecar = read_json_file(&sidecar_path);
        assert_no_legacy_fields(
            &sidecar,
            &[EXCEL_LEGACY_EDITOR_KEY, EXCEL_LEGACY_PARSED_CACHE_KEY],
        );
        assert_eq!(sidecar["id"], "legacy-excel-doc");
        assert!(sidecar["html"]
            .as_str()
            .expect("html")
            .contains("id=\"legacy-excel-block\""));
        assert_eq!(sidecar["extras"]["unrelated"]["keep"], "legacy-excel");
        let slot = sidecar["extras"]["blocks"]["legacy-excel-block"]
            .as_object()
            .expect("slot");
        assert_eq!(slot["slotExtra"]["keep"], true);
        assert_eq!(slot["parsedCache"]["sourceHash"], "legacy-excel-hash");

        let post_editor = serde_json::json!({
            "version": 1,
            "activeSheetId": "PostSheet",
            "sheets": [{"id": "PostSheet"}]
        });
        workspace_write_excel_editor_state(
            workspace.root(),
            "Budget.xlsx".into(),
            post_editor.clone(),
        )
        .expect("post migration write");
        let post_write = read_json_file(&sidecar_path);
        assert_no_legacy_fields(
            &post_write,
            &[EXCEL_LEGACY_EDITOR_KEY, EXCEL_LEGACY_PARSED_CACHE_KEY],
        );
        assert_eq!(
            post_write["extras"]["blocks"]["legacy-excel-block"]["editor"],
            post_editor
        );
    }

    #[test]
    fn excel_legacy_migration_merges_top_level_cache_without_overwriting_slot_editor() {
        let _lock = MIGRATE_ENV_LOCK.lock().unwrap_or_else(|err| err.into_inner());
        let workspace = TempWorkspace::new("excel-migrate-merge");
        let workbook_path = workspace.path.join("Budget.xlsx");
        write_file(&workbook_path, "PK\x03\x04");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&workbook_path);
        fs::write(
            &sidecar_path,
            serde_json::to_vec_pretty(&serde_json::json!({
                "version": 1,
                "id": "doc-1",
                "html": excel_placeholder("excel-1", "Budget.xlsx"),
                "markdown_hash": "old",
                "updated_at": "2026-05-12T00:00:00Z",
                "excel_editor": { "version": 1, "activeSheetId": "LegacySheet" },
                "excel_parsed_cache": {
                    "sourceHash": "legacy-cache",
                    "parsed": { "sheets": [] }
                },
                "extras": {
                    "blocks": {
                        "excel-1": {
                            "editor": { "version": 1, "activeSheetId": "SlotSheet" }
                        }
                    }
                }
            }))
            .expect("sidecar bytes"),
        )
        .expect("write mixed sidecar");

        let editor = workspace_read_excel_editor_state(workspace.root(), "Budget.xlsx".into())
            .expect("read migrated mixed sidecar")
            .expect("editor");

        assert_eq!(editor["activeSheetId"], "SlotSheet");
        let sidecar = read_json_file(&sidecar_path);
        assert!(sidecar.get(EXCEL_LEGACY_EDITOR_KEY).is_none());
        assert!(sidecar.get(EXCEL_LEGACY_PARSED_CACHE_KEY).is_none());
        let (_block_id, slot) = only_excel_slot(&sidecar);
        assert_eq!(slot["editor"]["activeSheetId"], "SlotSheet");
        assert_eq!(slot["parsedCache"]["sourceHash"], "legacy-cache");
        assert!(sidecar_bak_path(&sidecar_path).exists());
    }

    #[test]
    fn excel_legacy_migration_prunes_orphan_extras_blocks_slots() {
        // Issue #96 for the Excel legacy → markdown-shape migration path.
        // `build_excel_synthetic_from_legacy` previously rebuilt
        // `extras.blocks` by re-inserting only the canonical slot but
        // letting any other legacy entry ride through. That made the
        // migrated v2 sidecar carry orphans that Python's read path
        // would then prune on first open, producing a different on-disk
        // shape between Rust-migrated and Python-read sidecars.
        let _lock = MIGRATE_ENV_LOCK.lock().unwrap_or_else(|err| err.into_inner());
        let workspace = TempWorkspace::new("excel-legacy-orphan-prune");
        let workbook_path = workspace.path.join("Budget.xlsx");
        write_file(&workbook_path, "PK\x03\x04");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&workbook_path);
        let legacy = serde_json::to_vec_pretty(&serde_json::json!({
            "version": 1,
            "id": "legacy-doc",
            "html": excel_placeholder("keep", "Budget.xlsx"),
            "excel_editor": { "version": 1, "activeSheetId": "LegacySheet" },
            "extras": {
                "blocks": {
                    "keep": { "editor": { "version": 1, "activeSheetId": "Sheet1" } },
                    "orphan": { "editor": { "version": 1, "activeSheetId": "Stale" } }
                },
                "unrelated": { "preserve": true }
            }
        }))
        .expect("legacy bytes");
        fs::write(&sidecar_path, legacy).expect("write legacy sidecar");

        workspace_read_excel_doc_state(workspace.root(), "Budget.xlsx".into())
            .expect("migrate legacy sidecar")
            .expect("state");

        let after = read_json_file(&sidecar_path);
        let blocks = after["extras"]["blocks"]
            .as_object()
            .expect("extras.blocks object");
        assert_eq!(
            blocks.len(),
            1,
            "legacy migration must drop orphan slots; got: {:?}",
            blocks.keys().collect::<Vec<_>>()
        );
        assert!(blocks.contains_key("keep"));
        assert!(!blocks.contains_key("orphan"));
        assert_eq!(after["extras"]["unrelated"]["preserve"], true);
    }

    /// Regression for the Excel legacy duplicate-placeholder path:
    /// `build_excel_synthetic_from_legacy` must propagate the
    /// "multiple placeholders" error from `excel_block_id_from_sidecar`
    /// rather than swallowing it and generating a fresh block id (which
    /// would silently lose the user's slot data).
    ///
    /// Covers both the `MIGRATE=on` (default migration) path and the
    /// `MIGRATE=off` (read-only synthesis) path — the bug was in shared
    /// helper code so both paths were affected.
    #[test]
    fn excel_legacy_sidecar_with_duplicate_placeholders_surfaces_error() {
        let _lock = MIGRATE_ENV_LOCK.lock().unwrap_or_else(|err| err.into_inner());

        let duplicate_html = format!(
            "{}\n{}",
            excel_placeholder("excel-A", "Budget.xlsx"),
            excel_placeholder("excel-B", "Budget.xlsx"),
        );
        let legacy_bytes = serde_json::to_vec_pretty(&serde_json::json!({
            "version": 1,
            "id": "doc-1",
            "html": duplicate_html,
            "markdown_hash": "old",
            "updated_at": "2026-05-12T00:00:00Z",
            "excel_editor": { "version": 1, "activeSheetId": "LegacySheet" },
        }))
        .expect("sidecar bytes");

        // MIGRATE=on (default): migration path must error.
        {
            let _guard = MigrateEnvGuard::new();
            let workspace = TempWorkspace::new("excel-legacy-duplicate-default");
            let workbook_path = workspace.path.join("Budget.xlsx");
            write_file(&workbook_path, "PK\x03\x04");
            let sidecar_path = doxmind_sidecar::sidecar_path_for(&workbook_path);
            fs::write(&sidecar_path, &legacy_bytes).expect("write duplicate sidecar");

            let err = workspace_read_excel_editor_state(workspace.root(), "Budget.xlsx".into())
                .expect_err("duplicate placeholders must surface an error, not synthesize a fresh block id");
            assert!(
                err.contains("multiple"),
                "error must mention 'multiple' placeholders; got: {err}"
            );
        }

        // MIGRATE=off: read-only synthesis path must also error.
        {
            let _guard = MigrateEnvGuard::new();
            MigrateEnvGuard::set("off");
            let workspace = TempWorkspace::new("excel-legacy-duplicate-readonly");
            let workbook_path = workspace.path.join("Budget.xlsx");
            write_file(&workbook_path, "PK\x03\x04");
            let sidecar_path = doxmind_sidecar::sidecar_path_for(&workbook_path);
            fs::write(&sidecar_path, &legacy_bytes).expect("write duplicate sidecar");

            let err = workspace_read_excel_editor_state(workspace.root(), "Budget.xlsx".into())
                .expect_err("duplicate placeholders must surface an error in MIGRATE=off path too");
            assert!(
                err.contains("multiple"),
                "MIGRATE=off error must mention 'multiple' placeholders; got: {err}"
            );
        }
    }

    /// Round-trip a freshly-emitted sidecar between the Rust workspace
    /// commands and the Python `SyntheticDocumentFactory` and assert
    /// neither runtime silently rewrites the other's output.
    ///
    /// Existing cross-runtime tests load *hand-crafted* fixtures from
    /// `tests/fixtures/sidecar_compat/`; they never observe what one
    /// runtime actually emits being parsed by the other. That gap is
    /// what allowed the v1 markdown-shape mismatch (Blocker #1) to
    /// ship in commit 32a2fd2: Python writes `version: 2` but the
    /// Rust read path tolerated v1 only as a legacy/migration trigger,
    /// so the very first Python-written sidecar would have been
    /// treated as legacy and rewritten — burning a `.bak` and
    /// mutating bytes on every cross-runtime open.
    ///
    /// This test asserts four invariants per direction (Rust→Python
    /// and Python→Rust) for both PDF and Excel:
    ///
    ///   1. Subprocess exits 0 (the reading runtime accepts the
    ///      sidecar without raising).
    ///   2. No `<sidecar>.bak` is created (the reader did not trigger
    ///      legacy migration).
    ///   3. Sidecar bytes are byte-identical before vs after the
    ///      cross-runtime open (no write-on-read).
    ///   4. The sidecar declares `"version": SIDECAR_VERSION` (2).
    ///
    /// Expected failure mode on commit 32a2fd2 (pre-T1): Direction B
    /// fails invariant (3) — Python emits a v2 sidecar, Rust opens
    /// it, and (depending on which Blocker is still live) Rust either
    /// rewrites it via the legacy-migration path or via the
    /// synthesize-on-missing write-back path. Once T1 lands this test
    /// must pass cleanly.
    ///
    /// Gated behind the `cross-runtime-tests` feature so the
    /// default `cargo test` keeps passing without `python3` on PATH
    /// and without the `server/` checkout being reachable.
    #[test]
    #[cfg_attr(not(feature = "cross-runtime-tests"), ignore)]
    fn cross_runtime_emitted_sidecars_open_without_remigration() {
        // --- Direction A: Rust emits → Python opens ----------------
        run_direction_a_pdf();
        run_direction_a_excel();

        // --- Direction B: Python emits → Rust opens ----------------
        run_direction_b_pdf();
        run_direction_b_excel();
    }

    fn resolve_python_executable() -> String {
        if let Ok(explicit) = std::env::var("DOXMIND_PYTHON") {
            if !explicit.trim().is_empty() {
                return explicit;
            }
        }
        // Windows ships `python` (often a py-launcher shim); POSIX distros
        // typically expose `python3` and leave bare `python` to point at 2.x.
        #[cfg(target_os = "windows")]
        {
            "python".to_string()
        }
        #[cfg(not(target_os = "windows"))]
        {
            "python3".to_string()
        }
    }

    fn server_dir() -> PathBuf {
        // CARGO_MANIFEST_DIR points at src-tauri/; server/ is the
        // sibling that hosts the Python sidecar service.
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        manifest
            .parent()
            .expect("src-tauri has a parent")
            .join("server")
    }

    fn run_python_snippet(snippet: &str) -> std::process::Output {
        let python = resolve_python_executable();
        let server = server_dir();
        assert!(
            server.is_dir(),
            "expected server/ directory at {server:?} — set DOXMIND_PYTHON or run from a checkout that has server/"
        );
        std::process::Command::new(&python)
            .arg("-c")
            .arg(snippet)
            .env("PYTHONPATH", &server)
            // Migration must remain enabled (default) so any legacy
            // shape would in fact get migrated — that is precisely the
            // wrong-version path we want to catch.
            .env_remove("DOXMIND_SIDECAR_MIGRATE")
            .output()
            .unwrap_or_else(|err| {
                panic!(
                    "failed to spawn python interpreter {python:?}: {err}; \
                     set DOXMIND_PYTHON or install python3 on PATH"
                )
            })
    }

    fn assert_python_ok(output: &std::process::Output, context: &str) {
        if !output.status.success() {
            panic!(
                "python subprocess failed during {context}:\n--- stdout ---\n{}\n--- stderr ---\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr),
            );
        }
    }

    fn assert_v2_sidecar_invariants(
        sidecar_path: &Path,
        before: &[u8],
        after: &[u8],
        context: &str,
    ) {
        assert!(
            !sidecar_bak_path(sidecar_path).exists(),
            "{context}: .bak file appeared at {:?} — reader triggered legacy migration on a freshly emitted sidecar",
            sidecar_bak_path(sidecar_path),
        );
        assert_eq!(
            before, after,
            "{context}: sidecar bytes changed across the cross-runtime open at {:?}",
            sidecar_path,
        );
        let parsed: serde_json::Value = serde_json::from_slice(after)
            .unwrap_or_else(|err| panic!("{context}: sidecar at {sidecar_path:?} is not JSON: {err}"));
        assert_eq!(
            parsed["version"],
            serde_json::json!(doxmind_sidecar::SIDECAR_VERSION),
            "{context}: emitted sidecar must declare version={}",
            doxmind_sidecar::SIDECAR_VERSION,
        );
    }

    fn run_direction_a_pdf() {
        let workspace = TempWorkspace::new("xrt-rust-emits-pdf");
        let pdf_path = workspace.path.join("app.pdf");
        fs::write(&pdf_path, b"%PDF-1.4\n%%EOF\n").expect("write pdf stub");

        let editor =
            serde_json::json!({"version": 1, "edits": {"1:0": {"text": "from-rust"}}});
        workspace_write_pdf_editor_state(workspace.root(), "app.pdf".into(), editor)
            .expect("rust write pdf editor state");

        let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);
        let before = fs::read(&sidecar_path).expect("read pdf sidecar after rust write");

        let snippet = format!(
            "from pathlib import Path\n\
             from services.synthetic_document import SyntheticDocumentFactory\n\
             SyntheticDocumentFactory().open_pdf(Path({path:?}))\n",
            path = pdf_path.to_string_lossy().to_string(),
        );
        let output = run_python_snippet(&snippet);
        assert_python_ok(&output, "direction A (Rust emits PDF → Python opens)");

        let after = fs::read(&sidecar_path).expect("read pdf sidecar after python open");
        assert_v2_sidecar_invariants(
            &sidecar_path,
            &before,
            &after,
            "direction A PDF (Rust→Python)",
        );
    }

    fn run_direction_a_excel() {
        let workspace = TempWorkspace::new("xrt-rust-emits-excel");
        let xlsx_path = workspace.path.join("book.xlsx");
        fs::write(&xlsx_path, b"PK\x03\x04\x00\x00\x00\x00").expect("write xlsx stub");

        let editor = serde_json::json!({
            "version": 1,
            "activeSheetId": "Sheet1",
            "sheets": [{"id": "Sheet1", "name": "From Rust"}]
        });
        workspace_write_excel_editor_state(workspace.root(), "book.xlsx".into(), editor)
            .expect("rust write excel editor state");

        let sidecar_path = doxmind_sidecar::sidecar_path_for(&xlsx_path);
        let before = fs::read(&sidecar_path).expect("read excel sidecar after rust write");

        let snippet = format!(
            "from pathlib import Path\n\
             from services.synthetic_document import SyntheticDocumentFactory\n\
             SyntheticDocumentFactory().open_excel(Path({path:?}))\n",
            path = xlsx_path.to_string_lossy().to_string(),
        );
        let output = run_python_snippet(&snippet);
        assert_python_ok(&output, "direction A (Rust emits Excel → Python opens)");

        let after = fs::read(&sidecar_path).expect("read excel sidecar after python open");
        assert_v2_sidecar_invariants(
            &sidecar_path,
            &before,
            &after,
            "direction A Excel (Rust→Python)",
        );
    }

    fn run_direction_b_pdf() {
        let workspace = TempWorkspace::new("xrt-python-emits-pdf");
        let pdf_path = workspace.path.join("app.pdf");
        fs::write(&pdf_path, b"%PDF-1.4\n%%EOF\n").expect("write pdf stub");

        // Python synthesizes the v2 sidecar in memory (open returns a
        // Document without touching disk after T1), then persists it
        // with an explicit write_full call.
        let snippet = format!(
            "from pathlib import Path\n\
             from services.synthetic_document import SyntheticDocumentFactory\n\
             factory = SyntheticDocumentFactory()\n\
             doc = factory.open_pdf(Path({path:?}))\n\
             factory.write_full(doc, doc.snapshot)\n",
            path = pdf_path.to_string_lossy().to_string(),
        );
        let output = run_python_snippet(&snippet);
        assert_python_ok(&output, "direction B (Python emits PDF)");

        let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);
        let before = fs::read(&sidecar_path).expect("read pdf sidecar after python write");

        let state = workspace_read_pdf_doc_state(workspace.root(), "app.pdf".into())
            .expect("rust read pdf doc state from python-emitted sidecar")
            .expect("doc state present");
        // The slot may be empty (no editor saved yet); the contract is
        // that the read succeeds and exposes editor/parsedCache keys.
        assert!(state.get("editor").is_some());
        assert!(state.get("parsedCache").is_some());

        let after = fs::read(&sidecar_path).expect("read pdf sidecar after rust read");
        assert_v2_sidecar_invariants(
            &sidecar_path,
            &before,
            &after,
            "direction B PDF (Python→Rust)",
        );
    }

    fn run_direction_b_excel() {
        let workspace = TempWorkspace::new("xrt-python-emits-excel");
        let xlsx_path = workspace.path.join("book.xlsx");
        fs::write(&xlsx_path, b"PK\x03\x04\x00\x00\x00\x00").expect("write xlsx stub");

        let snippet = format!(
            "from pathlib import Path\n\
             from services.synthetic_document import SyntheticDocumentFactory\n\
             factory = SyntheticDocumentFactory()\n\
             doc = factory.open_excel(Path({path:?}))\n\
             factory.write_full(doc, doc.snapshot)\n",
            path = xlsx_path.to_string_lossy().to_string(),
        );
        let output = run_python_snippet(&snippet);
        assert_python_ok(&output, "direction B (Python emits Excel)");

        let sidecar_path = doxmind_sidecar::sidecar_path_for(&xlsx_path);
        let before = fs::read(&sidecar_path).expect("read excel sidecar after python write");

        let state = workspace_read_excel_doc_state(workspace.root(), "book.xlsx".into())
            .expect("rust read excel doc state from python-emitted sidecar")
            .expect("doc state present");
        assert!(state.get("editor").is_some());
        assert!(state.get("parsedCache").is_some());

        let after = fs::read(&sidecar_path).expect("read excel sidecar after rust read");
        assert_v2_sidecar_invariants(
            &sidecar_path,
            &before,
            &after,
            "direction B Excel (Python→Rust)",
        );
    }

    /// Regression net for Blocker #1: a `version: 1` markdown-shape
    /// sidecar already on disk (left over from a pre-v2 install) must
    /// open cross-runtime without crashing and must be upgraded to
    /// v2 on the next explicit write through Rust.
    ///
    /// Today (commit `c6562f3` / `32a2fd2` base) this test FAILS in
    /// two ways:
    ///   * Direction A: Python's `_read_markdown_shape` does a strict
    ///     `sidecar["version"] != SIDECAR_VERSION` check and raises
    ///     `ValueError`, so the subprocess exits non-zero.
    ///   * Direction B: Rust's `ensure_pdf_block_slot` /
    ///     Excel-equivalent only inserts `version` when it is
    ///     *absent*; it never upgrades a present-but-stale value. So
    ///     after a v1-markdown-shape sidecar is read and re-written
    ///     by a write path, `version` stays at 1 on disk.
    ///
    /// Both failure modes are exactly what T1 (sidecar-version-fixer)
    /// fixes:
    ///   * Python accepts `version in {1, SIDECAR_VERSION}`.
    ///   * Rust rewrites `version` when absent OR below `SIDECAR_VERSION`.
    ///
    /// The test is `#[ignore]`'d on top of the feature gate so it
    /// does not break CI today. The team lead removes the `#[ignore]`
    /// after T1 merges to confirm the regression net catches a
    /// future re-introduction. The `#[ignore]` reason is verbose on
    /// purpose so the next reader knows exactly when to remove it.
    ///
    /// Critically: the seeded sidecar has NO legacy `pdf_editor` /
    /// `excel_editor` top-level keys. It is a *v1 markdown-shape*
    /// sidecar, not a legacy-shape one. If it had legacy keys, the
    /// migration path would fire and a `.bak` file would be written
    /// — which is not what we are testing here.
    #[test]
    #[cfg_attr(not(feature = "cross-runtime-tests"), ignore)]
    fn v1_markdown_shape_on_disk_opens_cross_runtime_after_t1() {
        run_v1_markdown_shape_pdf();
        run_v1_markdown_shape_excel();
    }

    fn seed_v1_markdown_shape_pdf_sidecar(pdf_path: &Path, block_id: &str) -> PathBuf {
        let src = pdf_path
            .file_name()
            .and_then(|name| name.to_str())
            .expect("pdf filename");
        let html = format!("<!-- pdf-block id=\"{block_id}\" src=\"{src}\" -->");
        let sidecar = serde_json::json!({
            "version": 1,
            "id": "v1-pdf-doc",
            "html": html,
            "markdown_hash": "v1-fixture-hash-pdf",
            "updated_at": "2026-05-14T00:00:00Z",
            "extras": { "blocks": { block_id: {} } }
        });
        let sidecar_path = doxmind_sidecar::sidecar_path_for(pdf_path);
        fs::write(
            &sidecar_path,
            serde_json::to_vec_pretty(&sidecar).expect("serialize seeded pdf sidecar"),
        )
        .expect("write seeded v1 pdf sidecar");
        sidecar_path
    }

    fn seed_v1_markdown_shape_excel_sidecar(xlsx_path: &Path, block_id: &str) -> PathBuf {
        let src = xlsx_path
            .file_name()
            .and_then(|name| name.to_str())
            .expect("xlsx filename");
        let html = format!("<!-- excel-block id=\"{block_id}\" src=\"{src}\" -->");
        let sidecar = serde_json::json!({
            "version": 1,
            "id": "v1-excel-doc",
            "html": html,
            "markdown_hash": "v1-fixture-hash-excel",
            "updated_at": "2026-05-14T00:00:00Z",
            "extras": { "blocks": { block_id: {} } }
        });
        let sidecar_path = doxmind_sidecar::sidecar_path_for(xlsx_path);
        fs::write(
            &sidecar_path,
            serde_json::to_vec_pretty(&sidecar).expect("serialize seeded excel sidecar"),
        )
        .expect("write seeded v1 excel sidecar");
        sidecar_path
    }

    fn run_v1_markdown_shape_pdf() {
        let workspace = TempWorkspace::new("xrt-v1-pdf");
        let pdf_path = workspace.path.join("app.pdf");
        fs::write(&pdf_path, b"%PDF-1.4\n%%EOF\n").expect("write pdf stub");
        let sidecar_path =
            seed_v1_markdown_shape_pdf_sidecar(&pdf_path, "v1-pdf-block");

        // Direction A: Python must accept v1 markdown-shape after T1.
        let snippet = format!(
            "from pathlib import Path\n\
             from services.synthetic_document import SyntheticDocumentFactory\n\
             SyntheticDocumentFactory().open_pdf(Path({path:?}))\n",
            path = pdf_path.to_string_lossy().to_string(),
        );
        let output = run_python_snippet(&snippet);
        assert_python_ok(
            &output,
            "v1 markdown-shape PDF (Python must tolerate version=1 after T1)",
        );
        // No legacy fields → no `.bak` should ever be written by the
        // Python read path.
        assert!(
            !sidecar_bak_path(&sidecar_path).exists(),
            "Python read of v1 markdown-shape PDF sidecar must not write a .bak (no legacy fields present)"
        );

        // Direction B: Rust must upgrade `version` to SIDECAR_VERSION
        // on the next explicit write.
        let editor =
            serde_json::json!({"version": 1, "edits": {"1:0": {"text": "after-t1"}}});
        workspace_write_pdf_editor_state(workspace.root(), "app.pdf".into(), editor)
            .expect("rust write pdf editor state against v1 sidecar");

        let on_disk: serde_json::Value =
            serde_json::from_slice(&fs::read(&sidecar_path).expect("read sidecar after rust write"))
                .expect("parse sidecar after rust write");
        assert_eq!(
            on_disk["version"],
            serde_json::json!(doxmind_sidecar::SIDECAR_VERSION),
            "Rust must rewrite v1 markdown-shape PDF sidecar version to SIDECAR_VERSION on explicit write; got {:?}",
            on_disk["version"],
        );
        // Still no `.bak` — there were no legacy fields, so no
        // migration should have run.
        assert!(
            !sidecar_bak_path(&sidecar_path).exists(),
            "Rust write of v1 markdown-shape PDF sidecar must not write a .bak (no legacy fields present)"
        );
    }

    fn run_v1_markdown_shape_excel() {
        let workspace = TempWorkspace::new("xrt-v1-excel");
        let xlsx_path = workspace.path.join("book.xlsx");
        fs::write(&xlsx_path, b"PK\x03\x04\x00\x00\x00\x00").expect("write xlsx stub");
        let sidecar_path =
            seed_v1_markdown_shape_excel_sidecar(&xlsx_path, "v1-excel-block");

        let snippet = format!(
            "from pathlib import Path\n\
             from services.synthetic_document import SyntheticDocumentFactory\n\
             SyntheticDocumentFactory().open_excel(Path({path:?}))\n",
            path = xlsx_path.to_string_lossy().to_string(),
        );
        let output = run_python_snippet(&snippet);
        assert_python_ok(
            &output,
            "v1 markdown-shape Excel (Python must tolerate version=1 after T1)",
        );
        assert!(
            !sidecar_bak_path(&sidecar_path).exists(),
            "Python read of v1 markdown-shape Excel sidecar must not write a .bak (no legacy fields present)"
        );

        let editor = serde_json::json!({
            "version": 1,
            "activeSheetId": "Sheet1",
            "sheets": [{"id": "Sheet1", "name": "After T1"}]
        });
        workspace_write_excel_editor_state(workspace.root(), "book.xlsx".into(), editor)
            .expect("rust write excel editor state against v1 sidecar");

        let on_disk: serde_json::Value =
            serde_json::from_slice(&fs::read(&sidecar_path).expect("read sidecar after rust write"))
                .expect("parse sidecar after rust write");
        assert_eq!(
            on_disk["version"],
            serde_json::json!(doxmind_sidecar::SIDECAR_VERSION),
            "Rust must rewrite v1 markdown-shape Excel sidecar version to SIDECAR_VERSION on explicit write; got {:?}",
            on_disk["version"],
        );
        assert!(
            !sidecar_bak_path(&sidecar_path).exists(),
            "Rust write of v1 markdown-shape Excel sidecar must not write a .bak (no legacy fields present)"
        );
    }

    /// Guard against parallel tests racing on the
    /// `DOXMIND_SIDECAR_MIGRATE` env var. Cargo runs unit tests
    /// multi-threaded by default; any test that mutates a process-global
    /// must serialise itself against every other env-var-sensitive test.
    /// We keep this private and use it from the single
    /// `migrate_off_*` test below — adding more env-var tests requires
    /// holding the same lock.
    static MIGRATE_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// RAII guard that snapshots and restores the env var, with
    /// best-effort restore on panic. Required because rustc currently
    /// poisons the mutex on panic; the guard restores state even when
    /// the test is about to abort.
    struct MigrateEnvGuard {
        original: Option<std::ffi::OsString>,
    }

    impl MigrateEnvGuard {
        fn new() -> Self {
            let original = std::env::var_os(MIGRATE_ENV_VAR);
            std::env::remove_var(MIGRATE_ENV_VAR);
            Self { original }
        }

        fn set(value: &str) {
            std::env::set_var(MIGRATE_ENV_VAR, value);
        }

        fn unset() {
            std::env::remove_var(MIGRATE_ENV_VAR);
        }
    }

    impl Drop for MigrateEnvGuard {
        fn drop(&mut self) {
            match self.original.take() {
                Some(value) => std::env::set_var(MIGRATE_ENV_VAR, value),
                None => std::env::remove_var(MIGRATE_ENV_VAR),
            }
        }
    }

    fn write_legacy_pdf_fixture(sidecar_path: &Path) -> Vec<u8> {
        let legacy = br#"{
  "version": 1,
  "id": "legacy-doc",
  "pdf_editor": {"textEdits": [{"id": "t1"}]},
  "pdf_parsed_cache": {"sourceHash": "abc", "parsed": {"pages": [1]}},
  "extras": {"keep": {"x": 1}}
}"#
        .to_vec();
        fs::write(sidecar_path, &legacy).expect("write legacy pdf sidecar");
        legacy
    }

    fn write_legacy_excel_fixture(sidecar_path: &Path) -> Vec<u8> {
        let legacy = br#"{
  "version": 1,
  "id": "legacy-xlsx",
  "excel_editor": {"version": 1, "activeSheetId": "LegacySheet"},
  "excel_parsed_cache": {"sourceHash": "legacy-cache", "parsed": {"sheets": []}}
}"#
        .to_vec();
        fs::write(sidecar_path, &legacy).expect("write legacy excel sidecar");
        legacy
    }

    /// Exhaustive coverage of the `DOXMIND_SIDECAR_MIGRATE=off` gate
    /// added in T5. Single test function so the env-var mutation is
    /// serialised against itself — we deliberately do NOT pull in
    /// `serial_test` since it isn't a dependency and the contract here
    /// is small enough to encode in one body.
    ///
    /// Scenarios covered (mirroring Python's
    /// `_synthesize_read_only_from_legacy` contract):
    ///   1. PDF legacy + `MIGRATE=off` — read exposes editor/parsedCache,
    ///      no `.bak`, sidecar bytes unchanged, subsequent write fails
    ///      with `"read-only"`.
    ///   2. Excel legacy + `MIGRATE=off` — same invariants.
    ///   3. PDF legacy with env var unset — legacy migration still runs
    ///      (`.bak` exists, on-disk sidecar rewritten to v2). This pins
    ///      the default-behaviour contract; without it the gate could
    ///      regress to "always disabled" and pass cases 1+2.
    ///   4. PDF legacy with `MIGRATE=1` — same as unset (migration runs).
    #[test]
    fn migrate_off_gates_legacy_sidecar_migration() {
        let _lock = MIGRATE_ENV_LOCK.lock().unwrap_or_else(|err| err.into_inner());
        let _guard = MigrateEnvGuard::new();

        // --- Scenario 1: PDF legacy + MIGRATE=off ----------------------
        {
            MigrateEnvGuard::set("off");
            let workspace = TempWorkspace::new("migrate-off-pdf-legacy");
            let pdf_path = workspace.path.join("Spec.pdf");
            fs::write(&pdf_path, b"%PDF-1.4\n%%EOF\n").expect("write pdf");
            let sidecar_path = workspace.path.join(".Spec.pdf.doxmind");
            let legacy_bytes = write_legacy_pdf_fixture(&sidecar_path);

            let state = workspace_read_pdf_doc_state(workspace.root(), "Spec.pdf".into())
                .expect("read should succeed read-only")
                .expect("doc state present");

            // Legacy editor/parsedCache content reaches the caller.
            assert_eq!(state["editor"]["textEdits"][0]["id"], "t1");
            assert_eq!(state["parsedCache"]["sourceHash"], "abc");

            // No `.bak` written, on-disk sidecar untouched.
            assert!(
                !sidecar_bak_path(&sidecar_path).exists(),
                "MIGRATE=off must not write a .bak alongside legacy PDF sidecar"
            );
            assert_eq!(
                fs::read(&sidecar_path).expect("read sidecar after"),
                legacy_bytes,
                "MIGRATE=off must not rewrite the on-disk PDF sidecar"
            );

            // Write attempts surface a read-only error.
            let err = workspace_write_pdf_editor_state(
                workspace.root(),
                "Spec.pdf".into(),
                serde_json::json!({"textEdits": []}),
            )
            .expect_err("write must fail on read-only synthetic PDF doc");
            assert!(
                err.contains("read-only"),
                "PDF write error must mention 'read-only'; got: {err}"
            );

            let err = workspace_write_pdf_parsed_cache(
                workspace.root(),
                "Spec.pdf".into(),
                "fresh-hash".into(),
                serde_json::json!({"pages": []}),
            )
            .expect_err("parsed-cache write must fail on read-only synthetic PDF doc");
            assert!(err.contains("read-only"), "{err}");

            // After failed writes, sidecar is still untouched.
            assert!(!sidecar_bak_path(&sidecar_path).exists());
            assert_eq!(
                fs::read(&sidecar_path).expect("read sidecar after failed writes"),
                legacy_bytes
            );
        }

        // --- Scenario 2: Excel legacy + MIGRATE=off --------------------
        {
            MigrateEnvGuard::set("off");
            let workspace = TempWorkspace::new("migrate-off-excel-legacy");
            let xlsx_path = workspace.path.join("Budget.xlsx");
            fs::write(&xlsx_path, b"PK\x03\x04").expect("write xlsx");
            let sidecar_path = doxmind_sidecar::sidecar_path_for(&xlsx_path);
            let legacy_bytes = write_legacy_excel_fixture(&sidecar_path);

            let state = workspace_read_excel_doc_state(workspace.root(), "Budget.xlsx".into())
                .expect("read should succeed read-only")
                .expect("doc state present");

            assert_eq!(state["editor"]["activeSheetId"], "LegacySheet");
            assert_eq!(state["parsedCache"]["sourceHash"], "legacy-cache");

            assert!(
                !sidecar_bak_path(&sidecar_path).exists(),
                "MIGRATE=off must not write a .bak alongside legacy Excel sidecar"
            );
            assert_eq!(
                fs::read(&sidecar_path).expect("read sidecar after"),
                legacy_bytes,
                "MIGRATE=off must not rewrite the on-disk Excel sidecar"
            );

            let err = workspace_write_excel_editor_state(
                workspace.root(),
                "Budget.xlsx".into(),
                serde_json::json!({"version": 1, "activeSheetId": "Whatever"}),
            )
            .expect_err("write must fail on read-only synthetic Excel doc");
            assert!(
                err.contains("read-only"),
                "Excel write error must mention 'read-only'; got: {err}"
            );

            let err = workspace_write_excel_parsed_cache(
                workspace.root(),
                "Budget.xlsx".into(),
                "fresh-hash".into(),
                serde_json::json!({"sheets": []}),
            )
            .expect_err("parsed-cache write must fail on read-only synthetic Excel doc");
            assert!(err.contains("read-only"), "{err}");

            assert!(!sidecar_bak_path(&sidecar_path).exists());
            assert_eq!(
                fs::read(&sidecar_path).expect("read sidecar after failed writes"),
                legacy_bytes
            );
        }

        // --- Scenario 3: env var unset → default migration runs --------
        {
            MigrateEnvGuard::unset();
            let workspace = TempWorkspace::new("migrate-default-pdf-legacy");
            let pdf_path = workspace.path.join("Spec.pdf");
            fs::write(&pdf_path, b"%PDF-1.4\n%%EOF\n").expect("write pdf");
            let sidecar_path = workspace.path.join(".Spec.pdf.doxmind");
            let legacy_bytes = write_legacy_pdf_fixture(&sidecar_path);

            workspace_read_pdf_doc_state(workspace.root(), "Spec.pdf".into())
                .expect("read should migrate by default")
                .expect("state");

            assert!(
                sidecar_bak_path(&sidecar_path).exists(),
                "default behaviour must write `.bak` during legacy migration"
            );
            assert_eq!(
                fs::read(sidecar_bak_path(&sidecar_path)).expect("read bak"),
                legacy_bytes,
                "the `.bak` must contain the original legacy bytes"
            );
            let migrated = read_json(&sidecar_path);
            assert_eq!(
                migrated["version"],
                serde_json::json!(doxmind_sidecar::SIDECAR_VERSION),
                "default behaviour rewrites sidecar to v2"
            );
            assert!(migrated.get(PDF_LEGACY_EDITOR_KEY).is_none());
        }

        // --- Scenario 4: MIGRATE=1 → default migration runs ------------
        {
            MigrateEnvGuard::set("1");
            let workspace = TempWorkspace::new("migrate-on-pdf-legacy");
            let pdf_path = workspace.path.join("Spec.pdf");
            fs::write(&pdf_path, b"%PDF-1.4\n%%EOF\n").expect("write pdf");
            let sidecar_path = workspace.path.join(".Spec.pdf.doxmind");
            write_legacy_pdf_fixture(&sidecar_path);

            workspace_read_pdf_doc_state(workspace.root(), "Spec.pdf".into())
                .expect("read should migrate when MIGRATE=1")
                .expect("state");

            assert!(
                sidecar_bak_path(&sidecar_path).exists(),
                "MIGRATE=1 is explicit opt-in to migration; .bak must exist"
            );
        }
    }

    /// `migration_disabled()` mirrors Python's parser one-for-one.
    /// Spelled-out exhaustive coverage of accepted spellings + the
    /// invalid-value error path.
    #[test]
    fn migration_disabled_parses_documented_values() {
        let _lock = MIGRATE_ENV_LOCK.lock().unwrap_or_else(|err| err.into_inner());
        let _guard = MigrateEnvGuard::new();

        MigrateEnvGuard::unset();
        assert!(!migration_disabled().expect("unset → false"));

        for value in ["0", "false", "no", "off", "OFF", " off ", "False"] {
            MigrateEnvGuard::set(value);
            assert!(
                migration_disabled().expect("disabled value must parse"),
                "{value:?} should disable migration"
            );
        }

        for value in ["1", "true", "yes", "on", "ON", " on ", "True"] {
            MigrateEnvGuard::set(value);
            assert!(
                !migration_disabled().expect("enabled value must parse"),
                "{value:?} should enable migration"
            );
        }

        MigrateEnvGuard::set("maybe");
        let err = migration_disabled().expect_err("invalid value must error");
        assert!(err.contains("DOXMIND_SIDECAR_MIGRATE"), "{err}");
        assert!(err.contains("maybe"), "{err}");
    }

    #[test]
    fn doc_delete_rejects_unknown_extension() {
        let workspace = TempWorkspace::new("delete-unknown");
        write_file(&workspace.path.join("notes.txt"), "hi");

        let err = doc_delete(workspace.root(), "notes.txt".into()).expect_err("expected rejection");
        assert!(err.contains("must end in .md"), "unexpected error: {err}");
        // Source untouched.
        assert!(workspace.path.join("notes.txt").exists());
    }
}
