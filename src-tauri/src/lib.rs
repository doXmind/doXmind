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
use std::net::TcpListener;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use std::{cmp, collections::BTreeMap};

use doxmind_sidecar::{DocMeta, DocPayload, ReadResult, Source};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

#[cfg(target_os = "macos")]
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter,
};

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
    has_sidecar: bool,
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
    trash_path: String,
    sidecar_trash_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetImportResultDto {
    path: String,
}

#[tauri::command]
fn get_backend_url(state: tauri::State<'_, BackendUrl>) -> String {
    state.0.clone()
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
    payload: DocWritePayloadDto,
) -> Result<(), String> {
    let root = canonical_workspace_root(&root)?;
    ensure_markdown_path(&path)?;
    let path = resolve_workspace_path_for_write(&root, &path)?;
    doxmind_sidecar::write_doc(path, &DocPayload::from(payload))
        .await
        .map_err(|err| err.to_string())
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
    ensure_markdown_path(&path)?;
    let source = resolve_existing_workspace_path(&root, &path)?;
    if !source.is_file() {
        return Err(format!("document is not a file: {path}"));
    }

    let source_sidecar = doxmind_sidecar::sidecar_path_for(&source);
    let trash_path = unique_trash_path(&root, &path)?;
    if let Some(parent) = trash_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create trash directory: {err}"))?;
    }
    fs::rename(&source, &trash_path)
        .map_err(|err| format!("failed to move document to workspace trash: {err}"))?;

    let mut sidecar_path = None;
    let mut sidecar_trash_path = None;
    if source_sidecar.exists() {
        let trash_sidecar = doxmind_sidecar::sidecar_path_for(&trash_path);
        fs::rename(&source_sidecar, &trash_sidecar)
            .map_err(|err| format!("failed to move sidecar to workspace trash: {err}"))?;
        sidecar_path = Some(relative_path_string(&root, &source_sidecar)?);
        sidecar_trash_path = Some(relative_path_string(&root, &trash_sidecar)?);
    }

    Ok(DeleteResultDto {
        path,
        sidecar_path,
        trash_path: relative_path_string(&root, &trash_path)?,
        sidecar_trash_path,
    })
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
    let trash_path = unique_trash_dir_path(&root, &path)?;
    if let Some(parent) = trash_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create trash directory: {err}"))?;
    }
    fs::rename(&source, &trash_path)
        .map_err(|err| format!("failed to move folder to workspace trash: {err}"))?;
    Ok(DeleteResultDto {
        path,
        sidecar_path: None,
        trash_path: relative_path_string(&root, &trash_path)?,
        sidecar_trash_path: None,
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
    if clean
        .components()
        .next()
        .is_some_and(|component| component.as_os_str() == ".trash")
    {
        return Err("document path may not target workspace trash".into());
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

        if !file_type.is_file() || is_hidden_sidecar_name(&file_name) || !is_markdown_file(&path) {
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
            ".git" | "node_modules" | "target" | ".next" | "out" | "dist" | "build" | ".trash"
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

fn document_dto_for_path(
    path: &Path,
    relative_path: String,
) -> Result<WorkspaceDocumentDto, String> {
    let raw = fs::read_to_string(path)
        .map_err(|err| format!("failed to read markdown document for scan: {err}"))?;
    let (frontmatter_id, title) = parse_frontmatter_scan_fields(&raw);
    let (id, id_source) = match frontmatter_id {
        Some(id) => (id, "frontmatter".to_string()),
        None => (stable_path_id(&relative_path), "path".to_string()),
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
        has_sidecar: doxmind_sidecar::sidecar_path_for(path).exists(),
    })
}

fn parse_frontmatter_scan_fields(raw: &str) -> (Option<String>, Option<String>) {
    let mut lines = raw.lines();
    if !matches!(lines.next().map(str::trim), Some("---")) {
        return (None, None);
    }

    let mut id = None;
    let mut title = None;
    for line in lines {
        if line.trim() == "---" {
            break;
        }
        if id.is_none() {
            id = parse_yaml_scalar(line, "id");
        }
        if title.is_none() {
            title = parse_yaml_scalar(line, "title");
        }
    }

    (id, title)
}

fn parse_yaml_scalar(line: &str, key: &str) -> Option<String> {
    let trimmed = line.trim_start();
    let value = trimmed.strip_prefix(key)?.strip_prefix(':')?.trim();
    if value.is_empty() {
        return None;
    }
    Some(
        value
            .trim_matches('"')
            .trim_matches('\'')
            .trim()
            .to_string(),
    )
    .filter(|value| !value.is_empty())
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
        let (frontmatter_id, _) = parse_frontmatter_scan_fields(&raw);
        if let Some(id) = frontmatter_id {
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
        let (_, title) = parse_frontmatter_scan_fields(&raw);
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

fn unique_trash_path(root: &Path, path: &str) -> Result<PathBuf, String> {
    let relative = validate_relative_path(path)?;
    let base = root.join(".trash").join(&relative);
    let sidecar = doxmind_sidecar::sidecar_path_for(&base);
    if !base.exists() && !sidecar.exists() {
        return Ok(base);
    }

    let parent = base
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| root.join(".trash"));
    let stem = base
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("document");
    let extension = base
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("md");
    let nonce = unix_nanos();

    for counter in 0..1000 {
        let candidate = parent.join(format!("{stem}.{nonce}.{counter}.{extension}"));
        let candidate_sidecar = doxmind_sidecar::sidecar_path_for(&candidate);
        if !candidate.exists() && !candidate_sidecar.exists() {
            return Ok(candidate);
        }
    }

    Err("failed to allocate workspace trash path".into())
}

fn unique_trash_dir_path(root: &Path, path: &str) -> Result<PathBuf, String> {
    let relative = validate_relative_path(path)?;
    let base = root.join(".trash").join(&relative);
    if !base.exists() {
        return Ok(base);
    }

    let parent = base
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| root.join(".trash"));
    let name = base
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("folder");
    let nonce = unix_nanos();

    for counter in 0..1000 {
        let candidate = parent.join(format!("{name}.{nonce}.{counter}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err("failed to allocate workspace trash path".into())
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

pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .try_init()
        .ok();

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
        .invoke_handler(tauri::generate_handler![
            get_backend_url,
            workspace_default_root,
            doc_read,
            doc_write,
            doc_write_workspace,
            workspace_scan,
            workspace_index_rebuild,
            workspace_index_read,
            workspace_markdown_search,
            doc_create,
            doc_rename,
            doc_move,
            doc_delete,
            workspace_create_folder,
            workspace_rename_folder,
            workspace_delete_folder,
            workspace_import_asset
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

            // Build the main window with the backend URL pre-injected. On
            // macOS, hide the title bar background and the title text so the
            // app's own header takes over — the traffic-light buttons stay
            // floating at the top-left and the in-page header gets enough
            // left padding (see .is-tauri-macos in the frontend) to clear
            // them.
            // Load the editor shell directly. The marketing/home surface was
            // removed, so desktop should boot into the local workspace rather
            // than flashing "/" and waiting for a client redirect.
            //
            // Use a trailing slash so the URL resolves to the editor index in
            // both modes:
            //   dev:  http://localhost:3000/editor/ (Next dev server)
            //   prod: tauri://localhost/editor/     (static editor route)
            let mut builder =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("editor/".into()))
                    .title("doXmind")
                    .inner_size(1400.0, 900.0)
                    .min_inner_size(900.0, 600.0)
                    .resizable(true)
                    .initialization_script(&init_script);

            #[cfg(target_os = "macos")]
            {
                // Center the traffic lights vertically inside the 44px
                // chrome header so they align with the icon buttons that
                // sit immediately to the right of them. Tauri positions
                // the cluster at this offset from the window's top-left;
                // y is tuned visually rather than mathematically because
                // macOS adds extra padding around the cluster.
                builder = builder
                    .title_bar_style(tauri::TitleBarStyle::Overlay)
                    .traffic_light_position(tauri::LogicalPosition::new(14.0, 24.0))
                    .hidden_title(true)
                    .transparent(true);
            }

            let window = builder.build()?;
            #[cfg(target_os = "macos")]
            {
                // corner_radius=None lets NSVisualEffectView fill the entire
                // window; passing Some(...) clips the vibrancy view to a
                // smaller rounded rect that may not cover the full sidebar.
                if let Err(err) = apply_vibrancy(
                    &window,
                    NSVisualEffectMaterial::Sidebar,
                    Some(NSVisualEffectState::Active),
                    None,
                ) {
                    log::warn!("[window] failed to apply macOS vibrancy: {err}");
                }
            }
            // Show & focus once the WebView is ready (avoids the brief blank
            // flash you get with the default config).
            let _ = window.show();
            let _ = window.set_focus();

            #[cfg(target_os = "macos")]
            {
                if let Err(err) = install_macos_tray(app.handle()) {
                    log::warn!("[tray] failed to install: {err}");
                }
            }

            Ok(())
        });

    let app = builder
        .build(tauri::generate_context!())
        .expect("failed to build tauri app");

    app.run(|handle, event| {
        if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
            shutdown_backend(handle);
        }
    });
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
/// in Rust).
#[cfg(target_os = "macos")]
fn install_macos_tray(app: &AppHandle) -> tauri::Result<()> {
    let icon_bytes = include_bytes!("../icons/tray-icon-template.png");
    let icon = Image::from_bytes(icon_bytes)?;

    let new_file = MenuItemBuilder::with_id("tray-new-file", "New Document")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let show = MenuItemBuilder::with_id("tray-show", "Open doXmind").build(app)?;
    let settings = MenuItemBuilder::with_id("tray-settings", "Settings…").build(app)?;
    let quit = PredefinedMenuItem::quit(app, Some("Quit doXmind"))?;

    let menu = MenuBuilder::new(app)
        .item(&new_file)
        .separator()
        .item(&show)
        .item(&settings)
        .separator()
        .item(&quit)
        .build()?;

    TrayIconBuilder::with_id("doxmind-tray")
        .icon(icon)
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("doXmind")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-new-file" => {
                focus_main_window(app);
                let _ = app.emit("tray://new-file", ());
            }
            "tray-show" => {
                focus_main_window(app);
            }
            "tray-settings" => {
                focus_main_window(app);
                let _ = app.emit("tray://settings", ());
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
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
            &workspace.path.join(".trash/Deleted.md"),
            "---\nid: deleted\n---\n",
        );
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
    fn doc_delete_moves_markdown_and_sidecar_to_workspace_trash() {
        let workspace = TempWorkspace::new("delete-pair");
        write_file(&workspace.path.join("a.md"), "# A\n");
        write_file(&workspace.path.join(".a.doxmind"), r#"{"id":"a"}"#);

        let deleted = doc_delete(workspace.root(), "a.md".into()).expect("delete pair");

        assert_eq!(deleted.path, "a.md");
        assert_eq!(deleted.sidecar_path.as_deref(), Some(".a.doxmind"));
        assert_eq!(deleted.trash_path, ".trash/a.md");
        assert_eq!(
            deleted.sidecar_trash_path.as_deref(),
            Some(".trash/.a.doxmind")
        );
        assert!(workspace.path.join(".trash/a.md").exists());
        assert!(workspace.path.join(".trash/.a.doxmind").exists());
        assert!(!workspace.path.join("a.md").exists());
        assert!(!workspace.path.join(".a.doxmind").exists());
    }
}
