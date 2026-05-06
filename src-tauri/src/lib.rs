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
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use std::{cmp, collections::BTreeMap, collections::HashMap};

use doxmind_sidecar::{DocMeta, DocPayload, ReadResult, Source};
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_dialog::{DialogExt, FilePath};

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

/// Ask the kernel for a free port by binding to :0 and reading it back.
fn pick_free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("failed to bind probe socket")
        .local_addr()
        .expect("failed to read probe socket addr")
        .port()
}

/// In dev mode, find a usable Python interpreter — preferring the project
/// venv at `server/.venv/bin/python` so editable installs are picked up.
#[cfg(debug_assertions)]
fn resolve_python(server_dir: &std::path::Path) -> PathBuf {
    if let Ok(explicit) = std::env::var("DOXMIND_PYTHON") {
        return PathBuf::from(explicit);
    }
    let venv = server_dir.join(".venv").join("bin").join("python");
    if venv.exists() {
        return venv;
    }
    PathBuf::from("python3")
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
    html: String,
    markdown: String,
    meta: DocMeta,
    extras: Option<serde_json::Value>,
    source: String,
}

impl From<ReadResult> for ReadResultDto {
    fn from(result: ReadResult) -> Self {
        Self {
            html: result.html,
            markdown: result.markdown,
            meta: result.meta,
            extras: result.extras,
            source: match result.source {
                Source::Sidecar => "sidecar",
                Source::Markdown => "markdown",
                Source::Empty => "empty",
            }
            .to_string(),
        }
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
    path: String,
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
    doxmind_sidecar::read_doc(PathBuf::from(path))
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

    Ok(ReadResultDto {
        html,
        markdown,
        meta,
        extras,
        source: "sidecar".to_string(),
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
    let meta = fs::metadata(&path).map_err(|err| format!("failed to stat workspace file: {err}"))?;
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
    let sidecar_path = doxmind_sidecar::sidecar_path_for(&path);
    let raw = match fs::read_to_string(sidecar_path) {
        Ok(raw) => raw,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(format!("failed to read PDF sidecar: {err}")),
    };
    let sidecar: serde_json::Value =
        serde_json::from_str(&raw).map_err(|err| format!("invalid PDF sidecar JSON: {err}"))?;
    Ok(sidecar.get("pdf_editor").cloned())
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
    let sidecar_path = doxmind_sidecar::sidecar_path_for(&path);
    let rel_path = relative_path_string(&root, &path)?;
    let existing_cache = read_sidecar_field(&sidecar_path, "pdf_parsed_cache");
    let mut sidecar = serde_json::json!({
        "version": 1,
        "id": stable_path_id(&rel_path),
        "source_path": rel_path,
        "updated_at_unix_nanos": unix_nanos().to_string(),
        "pdf_editor": payload,
    });
    if let Some(cache) = existing_cache {
        sidecar
            .as_object_mut()
            .unwrap()
            .insert("pdf_parsed_cache".to_string(), cache);
    }
    fs::write(
        sidecar_path,
        serde_json::to_vec_pretty(&sidecar)
            .map_err(|err| format!("failed to encode PDF sidecar: {err}"))?,
    )
    .map_err(|err| format!("failed to write PDF sidecar: {err}"))
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
    let sidecar_path = doxmind_sidecar::sidecar_path_for(&path);
    let raw = match fs::read_to_string(&sidecar_path) {
        Ok(raw) => raw,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(format!("failed to read PDF sidecar: {err}")),
    };
    let sidecar: serde_json::Value =
        serde_json::from_str(&raw).map_err(|err| format!("invalid PDF sidecar JSON: {err}"))?;
    Ok(Some(serde_json::json!({
        "editor": sidecar.get("pdf_editor").cloned().unwrap_or(serde_json::Value::Null),
        "parsedCache": sidecar.get("pdf_parsed_cache").cloned().unwrap_or(serde_json::Value::Null),
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
    let sidecar_path = doxmind_sidecar::sidecar_path_for(&path);
    let rel_path = relative_path_string(&root, &path)?;
    let existing_editor = read_sidecar_field(&sidecar_path, "pdf_editor");
    let mut sidecar = serde_json::json!({
        "version": 1,
        "id": stable_path_id(&rel_path),
        "source_path": rel_path,
        "updated_at_unix_nanos": unix_nanos().to_string(),
        "pdf_parsed_cache": { "sourceHash": source_hash, "parsed": parsed },
    });
    if let Some(editor) = existing_editor {
        sidecar
            .as_object_mut()
            .unwrap()
            .insert("pdf_editor".to_string(), editor);
    }
    fs::write(
        sidecar_path,
        serde_json::to_vec_pretty(&sidecar)
            .map_err(|err| format!("failed to encode PDF sidecar: {err}"))?,
    )
    .map_err(|err| format!("failed to write PDF sidecar: {err}"))
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
    let sidecar_path = doxmind_sidecar::sidecar_path_for(&path);
    let raw = match fs::read_to_string(&sidecar_path) {
        Ok(raw) => raw,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(format!("failed to read Excel sidecar: {err}")),
    };
    let mut sidecar: serde_json::Value =
        serde_json::from_str(&raw).map_err(|err| format!("invalid Excel sidecar JSON: {err}"))?;
    // Opportunistic migration: if this sidecar still carries the legacy
    // `excel_parsed_cache` field (no longer written by us), strip it and
    // rewrite the sidecar slim. The first cold read of an old workbook
    // pays the full JSON parse once; every subsequent read sees a small
    // editor-only sidecar. Failure to write back is non-fatal — we still
    // return the editor state, the next read will just retry the strip.
    let stripped = sidecar
        .as_object_mut()
        .map(|obj| obj.remove("excel_parsed_cache").is_some())
        .unwrap_or(false);
    if stripped {
        if let Ok(bytes) = serde_json::to_vec_pretty(&sidecar) {
            // Atomic write: stale parsedCache strip used to use plain
            // fs::write, which truncates the file before writing. A crash
            // (or a kill -9 from a debugger) mid-write would leave the
            // user's editor state truncated. Slim-on-read is invoked on
            // every cold open of a legacy sidecar, so the exposure window
            // is much wider than for explicit save paths.
            let _ = atomic_write_bytes(&sidecar_path, &bytes);
        }
    }
    Ok(sidecar.get("excel_editor").cloned())
}

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
    Ok(())
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
    let sidecar_path = doxmind_sidecar::sidecar_path_for(&path);
    let rel_path = relative_path_string(&root, &path)?;
    // Deliberately drop any pre-existing `excel_parsed_cache` field. The
    // backend has its own process-local LRU and the frontend has a switch
    // cache; the on-disk parsedCache (which can run to ~18 MB for a single
    // workbook) was just bloat that slowed every cold read of this sidecar
    // by a second. The next `excel_parsed_cache` write would re-create it
    // if we ever decide to bring the on-disk shortcut back, so this is a
    // soft drop, not a schema deprecation.
    let sidecar = serde_json::json!({
        "version": 1,
        "id": stable_path_id(&rel_path),
        "source_path": rel_path,
        "updated_at_unix_nanos": unix_nanos().to_string(),
        "excel_editor": payload,
    });
    fs::write(
        sidecar_path,
        serde_json::to_vec_pretty(&sidecar)
            .map_err(|err| format!("failed to encode Excel sidecar: {err}"))?,
    )
    .map_err(|err| format!("failed to write Excel sidecar: {err}"))
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
    let sidecar_path = doxmind_sidecar::sidecar_path_for(&path);
    let raw = match fs::read_to_string(&sidecar_path) {
        Ok(raw) => raw,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(format!("failed to read Excel sidecar: {err}")),
    };
    let sidecar: serde_json::Value =
        serde_json::from_str(&raw).map_err(|err| format!("invalid Excel sidecar JSON: {err}"))?;
    Ok(Some(serde_json::json!({
        "editor": sidecar.get("excel_editor").cloned().unwrap_or(serde_json::Value::Null),
        "parsedCache": sidecar.get("excel_parsed_cache").cloned().unwrap_or(serde_json::Value::Null),
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
    let sidecar_path = doxmind_sidecar::sidecar_path_for(&path);
    let rel_path = relative_path_string(&root, &path)?;
    let existing_editor = read_sidecar_field(&sidecar_path, "excel_editor");
    let mut sidecar = serde_json::json!({
        "version": 1,
        "id": stable_path_id(&rel_path),
        "source_path": rel_path,
        "updated_at_unix_nanos": unix_nanos().to_string(),
        "excel_parsed_cache": { "sourceHash": source_hash, "parsed": parsed },
    });
    if let Some(editor) = existing_editor {
        sidecar
            .as_object_mut()
            .unwrap()
            .insert("excel_editor".to_string(), editor);
    }
    fs::write(
        sidecar_path,
        serde_json::to_vec_pretty(&sidecar)
            .map_err(|err| format!("failed to encode Excel sidecar: {err}"))?,
    )
    .map_err(|err| format!("failed to write Excel sidecar: {err}"))
}

fn read_sidecar_field(sidecar_path: &Path, key: &str) -> Option<serde_json::Value> {
    let raw = fs::read_to_string(sidecar_path).ok()?;
    let sidecar: serde_json::Value = serde_json::from_str(&raw).ok()?;
    sidecar.get(key).cloned()
}

#[tauri::command]
fn workspace_scan(root: String) -> Result<WorkspaceScanResultDto, String> {
    let root = canonical_workspace_root(&root)?;
    let mut documents = Vec::new();
    scan_workspace_dir(&root, &root, &mut documents)?;
    documents.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(WorkspaceScanResultDto {
        root: root.to_string_lossy().into_owned(),
        documents,
    })
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

#[tauri::command]
fn doc_rename(
    root: String,
    old_path: String,
    new_path: String,
) -> Result<WorkspaceDocumentDto, String> {
    move_document_pair(&root, &old_path, &new_path)
}

#[tauri::command]
fn doc_move(
    root: String,
    old_path: String,
    new_path: String,
) -> Result<WorkspaceDocumentDto, String> {
    move_document_pair(&root, &old_path, &new_path)
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
    let source = resolve_existing_workspace_path(&root, &old_path)?;
    if !source.is_dir() {
        return Err(format!("folder is not a directory: {old_path}"));
    }
    let destination = resolve_workspace_path_for_write(&root, &new_path)?;
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

fn is_workspace_document_file(path: &Path) -> bool {
    is_markdown_file(path) || is_pdf_file(path) || is_excel_file(path)
}

fn document_dto_for_path(
    path: &Path,
    relative_path: String,
) -> Result<WorkspaceDocumentDto, String> {
    let document_type = if is_pdf_file(path) {
        "pdf"
    } else if is_excel_file(path) {
        "excel"
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

fn workspace_index_path(root: &Path) -> PathBuf {
    root.join(".doxmind").join("index.json")
}

fn write_workspace_index(root: &Path, index: &WorkspaceIndexDto) -> Result<(), String> {
    let path = workspace_index_path(root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create workspace index directory: {err}"))?;
    }
    let raw = serde_json::to_string_pretty(index)
        .map_err(|err| format!("failed to serialize workspace index: {err}"))?;
    fs::write(path, raw).map_err(|err| format!("failed to write workspace index: {err}"))
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
        let title = parse_frontmatter_scan_fields(&raw).title;
        let matches = markdown_line_matches(&raw, &needle);
        if matches.is_empty() {
            continue;
        }

        results.push(MarkdownSearchResultDto {
            path: relative_path_string(root, &path)?,
            title,
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
    ensure_markdown_path(old_path)?;
    ensure_markdown_path(new_path)?;

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
            .traffic_light_position(tauri::LogicalPosition::new(14.0, 24.0))
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

    let owned_label = label.to_string();
    let close_handle = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            // Multi-window close model: only the last visible window minimizes
            // (preserves the macOS "stay resident" feel from before). Any
            // additional window closes for real, freeing its label so the same
            // folder can be reopened later.
            let visible_count = visible_window_count(&close_handle);
            if visible_count <= 1 {
                api.prevent_close();
                if let Some(window) = close_handle.get_webview_window(&owned_label) {
                    let _ = window.minimize();
                }
            } else {
                if let Some(registry) = close_handle.try_state::<WindowRegistry>() {
                    registry.clear(&owned_label);
                }
            }
        }
    });

    #[cfg(target_os = "macos")]
    apply_macos_window_chrome(&window);

    let _ = window.show();
    let _ = window.set_focus();

    Ok(window)
}

/// Count windows that are currently visible (not minimized / hidden). Used by
/// the close handler to decide between "minimize the last window" and "really
/// close this one".
fn visible_window_count(app: &AppHandle) -> usize {
    app.webview_windows()
        .values()
        .filter(|w| w.is_visible().unwrap_or(false))
        .count()
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
fn unregister_window_target(
    window: WebviewWindow,
    registry: tauri::State<'_, WindowRegistry>,
) {
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

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(BackendUrl(backend_url.clone()))
        .manage(backend_state)
        .manage(WindowRegistry::new())
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
            workspace_index_rebuild,
            workspace_index_read,
            workspace_markdown_search,
            doc_create,
            doc_create_pdf,
            doc_create_excel,
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
            save_window_pdf
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
            create_editor_window(&app.handle(), "main", None, &init_script)?;

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

    #[test]
    fn workspace_scan_uses_stable_path_id_without_writing() {
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
        assert_eq!(results[0].path, "Notes.md");
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
        write_file(
            &workspace.path.join(".Spec.pdf.doxmind"),
            r#"{"id":"pdf"}"#,
        );

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
    fn doc_delete_rejects_unknown_extension() {
        let workspace = TempWorkspace::new("delete-unknown");
        write_file(&workspace.path.join("notes.txt"), "hi");

        let err =
            doc_delete(workspace.root(), "notes.txt".into()).expect_err("expected rejection");
        assert!(
            err.contains("must end in .md"),
            "unexpected error: {err}"
        );
        // Source untouched.
        assert!(workspace.path.join("notes.txt").exists());
    }
}
