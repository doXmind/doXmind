use std::fs;
use std::path::Path;

use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverySourceInspection {
    pub source: String,
    pub recovery_status: String,
    pub sidecar_status: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInspection {
    pub document_type: String,
    pub recovery_status: String,
    pub sidecar_status: String,
    pub sidecar_path: String,
    pub recovery_sources: Vec<RecoverySourceInspection>,
    pub recommended_source: Option<String>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentRecovery {
    pub document_type: String,
    pub source: String,
    pub sidecar_status: String,
    pub editor_state: serde_json::Value,
    pub source_hash: String,
}

#[derive(Debug)]
struct ParsedRecoverySource {
    inspection: RecoverySourceInspection,
    editor_state: Option<serde_json::Value>,
    source_hash: Option<String>,
}

pub fn read_attachment_recovery(path: &Path, source: &str) -> Result<AttachmentRecovery, String> {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let (document_type, legacy_editor_key) = match extension.as_str() {
        "pdf" => ("pdf", "pdf_editor"),
        "xlsx" | "xlsm" | "csv" => ("excel", "excel_editor"),
        _ => return Err("attachment recovery requires PDF or spreadsheet".into()),
    };
    let sidecar_path = doxmind_sidecar::sidecar_path_for(path);
    let source_path = match source {
        "sidecar" => sidecar_path,
        "backup" => backup_path_for(&sidecar_path),
        _ => return Err("attachment recovery source must be sidecar or backup".into()),
    };
    let parsed = parse_recovery_source(&source_path, source, document_type, legacy_editor_key);
    if parsed.inspection.recovery_status != "available" {
        return Err(format!(
            "attachment recovery source is not available: {source}"
        ));
    }
    let editor_state = parsed
        .editor_state
        .ok_or_else(|| format!("attachment recovery source is not available: {source}"))?;
    let source_hash = parsed
        .source_hash
        .ok_or_else(|| format!("attachment recovery source is not available: {source}"))?;
    Ok(AttachmentRecovery {
        document_type: document_type.into(),
        source: source.into(),
        sidecar_status: parsed.inspection.sidecar_status,
        editor_state,
        source_hash,
    })
}

pub fn inspect_attachment(path: &Path) -> Result<AttachmentInspection, String> {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let (document_type, legacy_editor_key) = match extension.as_str() {
        "pdf" => ("pdf", Some("pdf_editor")),
        "xlsx" | "xlsm" | "csv" => ("excel", Some("excel_editor")),
        "html" | "htm" => ("html", None),
        _ => return Err("attachment inspection requires PDF, spreadsheet, or HTML".into()),
    };

    let sidecar_path = doxmind_sidecar::sidecar_path_for(path);
    let sidecar_name = sidecar_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_string();
    let Some(legacy_editor_key) = legacy_editor_key else {
        let (recovery_status, sidecar_status) = inspect_html_sidecar(&sidecar_path);
        return Ok(AttachmentInspection {
            document_type: document_type.into(),
            recovery_status: recovery_status.into(),
            sidecar_status: sidecar_status.into(),
            sidecar_path: sidecar_name,
            recovery_sources: Vec::new(),
            recommended_source: None,
        });
    };

    let backup_path = backup_path_for(&sidecar_path);
    let sidecar = parse_recovery_source(&sidecar_path, "sidecar", document_type, legacy_editor_key);
    let backup = parse_recovery_source(&backup_path, "backup", document_type, legacy_editor_key);
    let recovery_status = aggregate_recovery_status([&sidecar, &backup]);
    let recommended_source = recommended_source([&sidecar, &backup]);
    let sidecar_status = sidecar.inspection.sidecar_status.clone();

    Ok(AttachmentInspection {
        document_type: document_type.into(),
        recovery_status: recovery_status.into(),
        sidecar_status,
        sidecar_path: sidecar_name,
        recovery_sources: vec![sidecar.inspection, backup.inspection],
        recommended_source,
    })
}

fn inspect_html_sidecar(sidecar_path: &Path) -> (&'static str, &'static str) {
    let raw = match read_regular_file(sidecar_path) {
        FileRead::Readable(raw) => raw,
        FileRead::Missing => return ("none", "missing"),
        FileRead::Unreadable => return ("unknown", "unreadable"),
    };
    match serde_json::from_slice::<serde_json::Value>(&raw) {
        Ok(serde_json::Value::Object(_)) => ("none", "current"),
        Ok(_) | Err(_) => ("unknown", "unreadable"),
    }
}

fn backup_path_for(sidecar_path: &Path) -> std::path::PathBuf {
    let mut name = sidecar_path.file_name().unwrap_or_default().to_os_string();
    name.push(".bak");
    sidecar_path.with_file_name(name)
}

fn parse_recovery_source(
    path: &Path,
    source: &str,
    document_type: &str,
    legacy_editor_key: &str,
) -> ParsedRecoverySource {
    let raw = match read_regular_file(path) {
        FileRead::Readable(raw) => raw,
        FileRead::Missing => return parsed_source(source, "none", "missing", None, None),
        FileRead::Unreadable => {
            return parsed_source(source, "unknown", "unreadable", None, None);
        }
    };
    let sidecar: serde_json::Value = match serde_json::from_slice(&raw) {
        Ok(serde_json::Value::Object(sidecar)) => serde_json::Value::Object(sidecar),
        Ok(_) | Err(_) => return parsed_source(source, "unknown", "unreadable", None, None),
    };
    let version = sidecar.get("version");
    if version.is_some() && !version.is_some_and(known_sidecar_version) {
        return parsed_source(source, "unknown", "unreadable", None, None);
    }
    const LEGACY_FIELDS: [&str; 4] = [
        "pdf_editor",
        "pdf_parsed_cache",
        "excel_editor",
        "excel_parsed_cache",
    ];
    let legacy_cache_key = if legacy_editor_key == "pdf_editor" {
        "pdf_parsed_cache"
    } else {
        "excel_parsed_cache"
    };
    let present_legacy_fields = LEGACY_FIELDS
        .iter()
        .copied()
        .filter(|key| sidecar.get(*key).is_some())
        .collect::<Vec<_>>();
    if present_legacy_fields
        .iter()
        .any(|key| *key != legacy_editor_key && *key != legacy_cache_key)
    {
        return parsed_source(source, "unknown", "unreadable", None, None);
    }
    let has_current_editor = sidecar
        .get("extras")
        .and_then(|extras| extras.get("blocks"))
        .and_then(serde_json::Value::as_object)
        .is_some_and(|blocks| {
            blocks.values().any(|slot| {
                slot.as_object()
                    .is_some_and(|slot| slot.contains_key("editor"))
            })
        });
    if !present_legacy_fields.is_empty() && has_current_editor {
        return parsed_source(source, "unknown", "unreadable", None, None);
    }
    let (sidecar_status, editor, parsed_cache) = if !present_legacy_fields.is_empty() {
        (
            "legacy",
            sidecar.get(legacy_editor_key),
            sidecar.get(legacy_cache_key),
        )
    } else {
        if !version.is_some_and(known_sidecar_version) {
            return parsed_source(source, "unknown", "unreadable", None, None);
        }
        let block_type = if document_type == "pdf" {
            "pdf-block"
        } else {
            "excel-block"
        };
        let placeholder_ids = sidecar
            .get("html")
            .and_then(serde_json::Value::as_str)
            .map(|html| block_ids_in_html(html, block_type));
        let Some([placeholder_id]) = placeholder_ids.as_deref() else {
            return parsed_source(source, "unknown", "unreadable", None, None);
        };
        let Some(extras) = sidecar.get("extras").and_then(serde_json::Value::as_object) else {
            return parsed_source(source, "unknown", "unreadable", None, None);
        };
        let Some(blocks) = extras.get("blocks").and_then(serde_json::Value::as_object) else {
            return parsed_source(source, "unknown", "unreadable", None, None);
        };
        let Some(slot) = (blocks.len() == 1)
            .then(|| blocks.get(placeholder_id))
            .flatten()
            .and_then(serde_json::Value::as_object)
        else {
            return parsed_source(source, "unknown", "unreadable", None, None);
        };
        ("current", slot.get("editor"), slot.get("parsedCache"))
    };
    let mut editor_recovery_status = match document_type {
        "pdf" => editor.map_or("none", pdf_editor_recovery_status),
        "excel" => editor.map_or("none", excel_editor_recovery_status),
        _ => "none",
    };
    let source_hash = normalized_source_hash(parsed_cache);
    if editor_recovery_status == "available" && source_hash.is_none() {
        editor_recovery_status = "unknown";
    }
    let sidecar_status = if editor_recovery_status == "unknown" {
        "unreadable"
    } else {
        sidecar_status
    };
    let editor_state = (editor_recovery_status == "available")
        .then(|| editor.cloned())
        .flatten();
    let source_hash = (editor_recovery_status == "available")
        .then_some(source_hash)
        .flatten();
    parsed_source(
        source,
        editor_recovery_status,
        sidecar_status,
        editor_state,
        source_hash,
    )
}

enum FileRead {
    Readable(Vec<u8>),
    Missing,
    Unreadable,
}

fn read_regular_file(path: &Path) -> FileRead {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return FileRead::Missing,
        Err(_) => return FileRead::Unreadable,
    };
    if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
        return FileRead::Unreadable;
    }
    match fs::read(path) {
        Ok(raw) => FileRead::Readable(raw),
        Err(_) => FileRead::Unreadable,
    }
}

fn known_sidecar_version(version: &serde_json::Value) -> bool {
    matches!(version.as_u64(), Some(1 | 2))
}

fn parsed_source(
    source: &str,
    recovery_status: &str,
    sidecar_status: &str,
    editor_state: Option<serde_json::Value>,
    source_hash: Option<String>,
) -> ParsedRecoverySource {
    ParsedRecoverySource {
        inspection: RecoverySourceInspection {
            source: source.into(),
            recovery_status: recovery_status.into(),
            sidecar_status: sidecar_status.into(),
        },
        editor_state,
        source_hash,
    }
}

fn aggregate_recovery_status<const N: usize>(sources: [&ParsedRecoverySource; N]) -> &'static str {
    if sources
        .iter()
        .any(|source| source.inspection.recovery_status == "available")
    {
        "available"
    } else if sources
        .iter()
        .any(|source| source.inspection.recovery_status == "unknown")
    {
        "unknown"
    } else {
        "none"
    }
}

fn recommended_source<const N: usize>(sources: [&ParsedRecoverySource; N]) -> Option<String> {
    let available = sources
        .into_iter()
        .filter(|source| source.inspection.recovery_status == "available")
        .collect::<Vec<_>>();
    match available.as_slice() {
        [source] => Some(source.inspection.source.clone()),
        [first, second]
            if first.editor_state == second.editor_state
                && first.source_hash == second.source_hash =>
        {
            Some("sidecar".into())
        }
        _ => None,
    }
}

fn value_is_non_empty(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Null => false,
        serde_json::Value::Bool(value) => *value,
        serde_json::Value::Number(_) => true,
        serde_json::Value::String(value) => !value.is_empty(),
        serde_json::Value::Array(value) => !value.is_empty(),
        serde_json::Value::Object(value) => !value.is_empty(),
    }
}

fn normalized_source_hash(parsed_cache: Option<&serde_json::Value>) -> Option<String> {
    let source_hash = parsed_cache?.as_object()?.get("sourceHash")?.as_str()?;
    (source_hash.len() == 64 && source_hash.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| source_hash.to_ascii_lowercase())
}

fn block_ids_in_html(html: &str, block_type: &str) -> Vec<String> {
    let mut ids = Vec::new();
    let mut rest = html;
    while let Some(start) = rest.find("<!--") {
        let after_start = &rest[start + 4..];
        let Some(end) = after_start.find("-->") else {
            break;
        };
        let comment = after_start[..end].trim_start();
        if let Some(id) = canonical_placeholder_id(comment, block_type) {
            ids.push(id);
        }
        rest = &after_start[end + 3..];
    }
    ids
}

fn canonical_placeholder_id(comment: &str, block_type: &str) -> Option<String> {
    let attributes = comment.strip_prefix(block_type)?;
    if !attributes.chars().next().is_some_and(char::is_whitespace) {
        return None;
    }
    let after_id_prefix = attributes.trim_start().strip_prefix("id=\"")?;
    let id_end = after_id_prefix.find('"')?;
    let id = &after_id_prefix[..id_end];
    if id.is_empty() {
        return None;
    }
    let after_id = &after_id_prefix[id_end + 1..];
    if !after_id.chars().next().is_some_and(char::is_whitespace) {
        return None;
    }
    let after_src_prefix = after_id.trim_start().strip_prefix("src=\"")?;
    let src_end = after_src_prefix.find('"')?;
    if after_src_prefix[..src_end].is_empty() {
        return None;
    }
    Some(id.to_string())
}

fn pdf_editor_recovery_status(editor: &serde_json::Value) -> &'static str {
    const EDIT_FIELDS: [&str; 5] = [
        "edits",
        "textEdits",
        "paragraphEdits",
        "freeText",
        "highlights",
    ];
    const VIEW_FIELDS: [&str; 1] = ["version"];

    let Some(editor) = editor.as_object() else {
        return if editor.is_null() { "none" } else { "unknown" };
    };
    if !editor_version_is_supported(editor, &[1, 2]) {
        return "unknown";
    }
    if let Some(edits) = editor.get("edits") {
        let Some(edits) = edits.as_object() else {
            return "unknown";
        };
        if edits.keys().any(|edit_id| !pdf_item_edit_id(edit_id)) {
            return "unknown";
        }
    }
    if editor.iter().any(|(key, value)| {
        !EDIT_FIELDS.contains(&key.as_str())
            && !VIEW_FIELDS.contains(&key.as_str())
            && value_is_non_empty(value)
    }) {
        return "unknown";
    }
    if EDIT_FIELDS
        .iter()
        .any(|key| editor.get(*key).is_some_and(value_is_non_empty))
    {
        "available"
    } else {
        "none"
    }
}

fn pdf_item_edit_id(edit_id: &str) -> bool {
    let Some(rest) = edit_id.strip_prefix('p') else {
        return false;
    };
    let Some((page, item)) = rest.split_once("-t") else {
        return false;
    };
    !page.is_empty()
        && page.bytes().all(|byte| byte.is_ascii_digit())
        && !item.is_empty()
        && item.bytes().all(|byte| byte.is_ascii_digit())
}

fn editor_version_is_supported(
    editor: &serde_json::Map<String, serde_json::Value>,
    supported: &[u64],
) -> bool {
    match editor.get("version") {
        None => true,
        Some(version) => version
            .as_u64()
            .is_some_and(|version| supported.contains(&version)),
    }
}

fn excel_editor_recovery_status(editor: &serde_json::Value) -> &'static str {
    const EDIT_FIELDS: [&str; 11] = [
        "cells",
        "rowHeights",
        "colWidths",
        "ops",
        "workbookOps",
        "filters",
        "filterMode",
        "frozen",
        "validations",
        "comments",
        "conditionalFormats",
    ];
    const VIEW_FIELDS: [&str; 2] = ["version", "activeSheetId"];

    let Some(editor) = editor.as_object() else {
        return if editor.is_null() { "none" } else { "unknown" };
    };
    if !editor_version_is_supported(editor, &[1]) {
        return "unknown";
    }
    if ["filters", "filterMode"]
        .iter()
        .any(|key| editor.get(*key).is_some_and(value_is_non_empty))
    {
        return "unknown";
    }
    if editor.iter().any(|(key, value)| {
        !EDIT_FIELDS.contains(&key.as_str())
            && !VIEW_FIELDS.contains(&key.as_str())
            && value_is_non_empty(value)
    }) {
        return "unknown";
    }
    if EDIT_FIELDS
        .iter()
        .any(|key| editor.get(*key).is_some_and(value_is_non_empty))
    {
        "available"
    } else {
        "none"
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    use super::{inspect_attachment, read_attachment_recovery, AttachmentInspection};

    const SOURCE_HASH: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const BACKUP_SOURCE_HASH: &str =
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    struct TestDir(PathBuf);

    impl TestDir {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "doxmind-attachment-inspection-{label}-{}",
                uuid::Uuid::new_v4()
            ));
            fs::create_dir_all(&path).expect("create test workspace");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn workspace_snapshot(
        path: &Path,
    ) -> Vec<(std::ffi::OsString, Vec<u8>, std::time::SystemTime)> {
        let mut snapshot = fs::read_dir(path)
            .expect("read workspace")
            .map(|entry| {
                let entry = entry.expect("directory entry");
                let entry_path = entry.path();
                (
                    entry.file_name(),
                    fs::read(&entry_path).expect("read workspace file"),
                    fs::metadata(&entry_path)
                        .expect("workspace file metadata")
                        .modified()
                        .expect("workspace file modified time"),
                )
            })
            .collect::<Vec<_>>();
        snapshot.sort_by(|left, right| left.0.cmp(&right.0));
        snapshot
    }

    #[test]
    fn legacy_pdf_edits_are_available_without_writing() {
        let workspace = TestDir::new("legacy-pdf");
        let pdf_path = workspace.path().join("Spec.pdf");
        fs::write(&pdf_path, b"%PDF-1.4\n").expect("write PDF");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);
        let sidecar_bytes = serde_json::to_vec(&serde_json::json!({
            "version": 1,
            "pdf_editor": {"version": 1, "edits": {"p0-t0": {"text": "changed"}}},
            "pdf_parsed_cache": {"sourceHash": SOURCE_HASH, "parsed": {}},
        }))
        .expect("serialize sidecar");
        fs::write(&sidecar_path, &sidecar_bytes).expect("write sidecar");

        let inspection = inspect_attachment(&pdf_path).expect("inspect attachment");

        assert_eq!(
            inspection,
            AttachmentInspection {
                document_type: "pdf".into(),
                recovery_status: "available".into(),
                sidecar_status: "legacy".into(),
                sidecar_path: ".Spec.pdf.doxmind".into(),
                recovery_sources: vec![
                    super::RecoverySourceInspection {
                        source: "sidecar".into(),
                        recovery_status: "available".into(),
                        sidecar_status: "legacy".into(),
                    },
                    super::RecoverySourceInspection {
                        source: "backup".into(),
                        recovery_status: "none".into(),
                        sidecar_status: "missing".into(),
                    },
                ],
                recommended_source: Some("sidecar".into()),
            }
        );
        assert_eq!(
            fs::read(&sidecar_path).expect("read sidecar"),
            sidecar_bytes
        );
        assert!(!sidecar_path
            .with_file_name(".Spec.pdf.doxmind.bak")
            .exists());
        assert!(!sidecar_path
            .with_file_name(".Spec.pdf.doxmind.lock")
            .exists());
    }

    #[test]
    fn missing_sidecar_reports_no_recovery_and_stays_missing() {
        let workspace = TestDir::new("missing");
        let pdf_path = workspace.path().join("Plain.pdf");
        fs::write(&pdf_path, b"%PDF-1.4\n").expect("write PDF");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);

        let inspection = inspect_attachment(&pdf_path).expect("inspect attachment");

        assert_eq!(inspection.recovery_status, "none");
        assert_eq!(inspection.sidecar_status, "missing");
        assert_eq!(inspection.sidecar_path, ".Plain.pdf.doxmind");
        assert!(!sidecar_path.exists());
    }

    #[test]
    fn missing_sidecar_with_backup_reports_unknown_without_reading_or_writing_backup() {
        let workspace = TestDir::new("missing-with-backup");
        let pdf_path = workspace.path().join("Recovered.pdf");
        fs::write(&pdf_path, b"%PDF-1.4\n").expect("write PDF");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);
        let backup_path = sidecar_path.with_file_name(format!(
            "{}.bak",
            sidecar_path
                .file_name()
                .and_then(|name| name.to_str())
                .expect("sidecar file name")
        ));
        let backup_bytes = b"not parsed legacy recovery bytes";
        fs::write(&backup_path, backup_bytes).expect("write backup");
        let original_modified = fs::metadata(&backup_path)
            .expect("backup metadata")
            .modified()
            .expect("backup modified time");

        let inspection = inspect_attachment(&pdf_path).expect("inspect attachment");

        assert_eq!(inspection.recovery_status, "unknown");
        assert_eq!(inspection.sidecar_status, "missing");
        assert!(!sidecar_path.exists());
        assert_eq!(fs::read(&backup_path).expect("read backup"), backup_bytes);
        assert_eq!(
            fs::metadata(&backup_path)
                .expect("backup metadata")
                .modified()
                .expect("backup modified time"),
            original_modified
        );
        assert_eq!(
            fs::read_dir(workspace.path())
                .expect("read workspace")
                .count(),
            2,
            "inspection must not create a main sidecar or recovery artifacts"
        );
    }

    #[test]
    fn available_backup_is_reported_and_recommended_without_writing() {
        let workspace = TestDir::new("available-backup");
        let pdf_path = workspace.path().join("Recovered.pdf");
        fs::write(&pdf_path, b"%PDF-1.4\n").expect("write PDF");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);
        let backup_path = sidecar_path.with_file_name(".Recovered.pdf.doxmind.bak");
        let backup_bytes = serde_json::to_vec(&serde_json::json!({
            "version": 1,
            "pdf_editor": {"version": 1, "edits": {"p0-t0": {"text": "recovered"}}},
            "pdf_parsed_cache": {"sourceHash": SOURCE_HASH, "parsed": {}},
        }))
        .expect("serialize backup");
        fs::write(&backup_path, &backup_bytes).expect("write backup");
        let before_entries = fs::read_dir(workspace.path())
            .expect("read workspace")
            .map(|entry| entry.expect("directory entry").file_name())
            .collect::<Vec<_>>();
        let before_modified = fs::metadata(&backup_path)
            .expect("backup metadata")
            .modified()
            .expect("backup modified time");

        let inspection = inspect_attachment(&pdf_path).expect("inspect attachment");

        assert_eq!(inspection.recovery_status, "available");
        assert_eq!(inspection.recommended_source.as_deref(), Some("backup"));
        assert_eq!(inspection.recovery_sources.len(), 2);
        assert_eq!(inspection.recovery_sources[0].source, "sidecar");
        assert_eq!(inspection.recovery_sources[0].recovery_status, "none");
        assert_eq!(inspection.recovery_sources[0].sidecar_status, "missing");
        assert_eq!(inspection.recovery_sources[1].source, "backup");
        assert_eq!(inspection.recovery_sources[1].recovery_status, "available");
        assert_eq!(inspection.recovery_sources[1].sidecar_status, "legacy");
        assert_eq!(fs::read(&backup_path).expect("read backup"), backup_bytes);
        assert_eq!(
            fs::metadata(&backup_path)
                .expect("backup metadata")
                .modified()
                .expect("backup modified time"),
            before_modified
        );
        let after_entries = fs::read_dir(workspace.path())
            .expect("read workspace")
            .map(|entry| entry.expect("directory entry").file_name())
            .collect::<Vec<_>>();
        assert_eq!(after_entries, before_entries);
    }

    #[test]
    fn different_available_sources_are_not_automatically_recommended() {
        let workspace = TestDir::new("different-sources");
        let pdf_path = workspace.path().join("Conflicted.pdf");
        fs::write(&pdf_path, b"%PDF-1.4\n").expect("write PDF");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);
        let backup_path = sidecar_path.with_file_name(".Conflicted.pdf.doxmind.bak");
        fs::write(
            &sidecar_path,
            serde_json::to_vec(&serde_json::json!({
                "version": 1,
                "pdf_editor": {"edits": {"p0-t0": {"text": "main"}}},
                "pdf_parsed_cache": {"sourceHash": SOURCE_HASH, "parsed": {}},
            }))
            .expect("serialize sidecar"),
        )
        .expect("write sidecar");
        fs::write(
            &backup_path,
            serde_json::to_vec(&serde_json::json!({
                "version": 1,
                "pdf_editor": {"edits": {"p0-t0": {"text": "backup"}}},
                "pdf_parsed_cache": {"sourceHash": SOURCE_HASH, "parsed": {}},
            }))
            .expect("serialize backup"),
        )
        .expect("write backup");

        let inspection = inspect_attachment(&pdf_path).expect("inspect attachment");

        assert_eq!(inspection.recovery_status, "available");
        assert_eq!(inspection.recommended_source, None);
        assert!(inspection
            .recovery_sources
            .iter()
            .all(|source| source.recovery_status == "available"));
    }

    #[test]
    fn identical_available_sources_recommend_main_sidecar() {
        let workspace = TestDir::new("identical-sources");
        let pdf_path = workspace.path().join("Same.pdf");
        fs::write(&pdf_path, b"%PDF-1.4\n").expect("write PDF");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);
        let backup_path = sidecar_path.with_file_name(".Same.pdf.doxmind.bak");
        let state = serde_json::to_vec(&serde_json::json!({
            "version": 1,
            "pdf_editor": {"edits": {"p0-t0": {"text": "same"}}},
            "pdf_parsed_cache": {"sourceHash": SOURCE_HASH, "parsed": {}},
        }))
        .expect("serialize sidecar");
        fs::write(&sidecar_path, &state).expect("write sidecar");
        fs::write(&backup_path, &state).expect("write backup");

        let inspection = inspect_attachment(&pdf_path).expect("inspect attachment");

        assert_eq!(inspection.recovery_status, "available");
        assert_eq!(inspection.recommended_source.as_deref(), Some("sidecar"));
    }

    #[test]
    fn reads_exact_available_source_without_writing() {
        let workspace = TestDir::new("read-source");
        let excel_path = workspace.path().join("Budget.xlsx");
        fs::write(&excel_path, b"PK\x03\x04workbook").expect("write workbook");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&excel_path);
        let sidecar_bytes = serde_json::to_vec(&serde_json::json!({
            "version": 2,
            "html": "<!-- excel-block id=\"excel-a\" src=\"Budget.xlsx\" -->",
            "extras": {"blocks": {"excel-a": {
                "editor": {
                    "version": 1,
                    "cells": {"Sheet1!0,0": {"value": "changed"}},
                },
                "parsedCache": {"sourceHash": SOURCE_HASH, "parsed": {}},
            }}},
        }))
        .expect("serialize sidecar");
        fs::write(&sidecar_path, &sidecar_bytes).expect("write sidecar");
        let before_entries = fs::read_dir(workspace.path())
            .expect("read workspace")
            .map(|entry| entry.expect("directory entry").file_name())
            .collect::<Vec<_>>();
        let before_modified = fs::metadata(&sidecar_path)
            .expect("sidecar metadata")
            .modified()
            .expect("sidecar modified time");

        let recovery =
            read_attachment_recovery(&excel_path, "sidecar").expect("read recovery state");

        assert_eq!(recovery.document_type, "excel");
        assert_eq!(recovery.source, "sidecar");
        assert_eq!(recovery.sidecar_status, "current");
        assert_eq!(recovery.source_hash, SOURCE_HASH);
        assert_eq!(
            recovery.editor_state,
            serde_json::json!({
                "version": 1,
                "cells": {"Sheet1!0,0": {"value": "changed"}},
            })
        );
        assert_eq!(
            fs::read(&sidecar_path).expect("read sidecar"),
            sidecar_bytes
        );
        assert_eq!(
            fs::metadata(&sidecar_path)
                .expect("sidecar metadata")
                .modified()
                .expect("sidecar modified time"),
            before_modified
        );
        let after_entries = fs::read_dir(workspace.path())
            .expect("read workspace")
            .map(|entry| entry.expect("directory entry").file_name())
            .collect::<Vec<_>>();
        assert_eq!(after_entries, before_entries);
    }

    #[test]
    fn reads_source_hash_from_the_selected_main_or_backup_candidate() {
        let workspace = TestDir::new("candidate-source-hashes");
        let pdf_path = workspace.path().join("Candidate-hashes.pdf");
        fs::write(&pdf_path, b"%PDF-1.4\n").expect("write PDF");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);
        let backup_path = sidecar_path.with_file_name(".Candidate-hashes.pdf.doxmind.bak");
        let editor = serde_json::json!({
            "version": 1,
            "edits": {"p0-t0": {"text": "changed"}},
        });
        fs::write(
            &sidecar_path,
            serde_json::to_vec(&serde_json::json!({
                "version": 1,
                "pdf_editor": editor,
                "pdf_parsed_cache": {"sourceHash": SOURCE_HASH, "parsed": {}},
            }))
            .expect("serialize sidecar"),
        )
        .expect("write sidecar");
        fs::write(
            &backup_path,
            serde_json::to_vec(&serde_json::json!({
                "version": 1,
                "pdf_editor": editor,
                "pdf_parsed_cache": {"sourceHash": BACKUP_SOURCE_HASH, "parsed": {}},
            }))
            .expect("serialize backup"),
        )
        .expect("write backup");
        let before = workspace_snapshot(workspace.path());

        let inspection = inspect_attachment(&pdf_path).expect("inspect attachment");
        let main = read_attachment_recovery(&pdf_path, "sidecar").expect("read sidecar state");
        let backup = read_attachment_recovery(&pdf_path, "backup").expect("read backup state");

        assert_eq!(inspection.recommended_source, None);
        assert_eq!(main.source_hash, SOURCE_HASH);
        assert_eq!(backup.source_hash, BACKUP_SOURCE_HASH);
        assert_eq!(workspace_snapshot(workspace.path()), before);
    }

    #[test]
    fn reads_and_normalizes_source_hash_from_a_current_backup_slot() {
        let workspace = TestDir::new("current-backup-source-hash");
        let excel_path = workspace.path().join("Current-backup.xlsx");
        fs::write(&excel_path, b"PK\x03\x04workbook").expect("write workbook");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&excel_path);
        let backup_path = sidecar_path.with_file_name(".Current-backup.xlsx.doxmind.bak");
        fs::write(
            &backup_path,
            serde_json::to_vec(&serde_json::json!({
                "version": 2,
                "html": "<!-- excel-block id=\"excel-a\" src=\"Current-backup.xlsx\" -->",
                "extras": {"blocks": {"excel-a": {
                    "editor": {
                        "version": 1,
                        "cells": {"Sheet1!0,0": {"value": "changed"}},
                    },
                    "parsedCache": {
                        "sourceHash": BACKUP_SOURCE_HASH.to_uppercase(),
                        "parsed": {},
                    },
                }}},
            }))
            .expect("serialize backup"),
        )
        .expect("write backup");
        let before = workspace_snapshot(workspace.path());

        let recovery = read_attachment_recovery(&excel_path, "backup").expect("read backup state");

        assert_eq!(recovery.source_hash, BACKUP_SOURCE_HASH);
        assert_eq!(recovery.sidecar_status, "current");
        assert_eq!(workspace_snapshot(workspace.path()), before);
    }

    #[test]
    fn edited_recovery_requires_a_valid_source_hash_without_hiding_the_state() {
        let cache_cases = [
            ("missing", None),
            ("missing-hash", Some(serde_json::json!({}))),
            ("empty", Some(serde_json::json!({"sourceHash": ""}))),
            (
                "short",
                Some(serde_json::json!({"sourceHash": "not-a-sha256"})),
            ),
            ("non-string", Some(serde_json::json!({"sourceHash": 42}))),
            ("non-object", Some(serde_json::json!("not-an-object"))),
        ];
        for shape in ["legacy", "current"] {
            for (label, cache) in &cache_cases {
                let workspace = TestDir::new(&format!("invalid-cache-{shape}-{label}"));
                let excel_path = workspace.path().join("Invalid-cache.xlsx");
                fs::write(&excel_path, b"PK\x03\x04workbook").expect("write workbook");
                let sidecar_path = doxmind_sidecar::sidecar_path_for(&excel_path);
                let editor = serde_json::json!({
                    "version": 1,
                    "cells": {"Sheet1!0,0": {"value": "changed"}},
                });
                let mut sidecar = if shape == "legacy" {
                    serde_json::json!({"version": 1, "excel_editor": editor})
                } else {
                    serde_json::json!({
                        "version": 2,
                        "html": "<!-- excel-block id=\"excel-a\" src=\"Invalid-cache.xlsx\" -->",
                        "extras": {"blocks": {"excel-a": {"editor": editor}}},
                    })
                };
                if let Some(cache) = cache {
                    if shape == "legacy" {
                        sidecar
                            .as_object_mut()
                            .expect("sidecar object")
                            .insert("excel_parsed_cache".into(), cache.clone());
                    } else {
                        sidecar["extras"]["blocks"]["excel-a"]["parsedCache"] = cache.clone();
                    }
                }
                fs::write(
                    &sidecar_path,
                    serde_json::to_vec(&sidecar).expect("serialize sidecar"),
                )
                .expect("write sidecar");
                let before = workspace_snapshot(workspace.path());

                let inspection = inspect_attachment(&excel_path).expect("inspect attachment");

                assert_eq!(
                    inspection.recovery_status, "unknown",
                    "case: {shape}/{label}"
                );
                assert_eq!(
                    inspection.recovery_sources[0].recovery_status, "unknown",
                    "case: {shape}/{label}"
                );
                assert_eq!(
                    inspection.recovery_sources[0].sidecar_status, "unreadable",
                    "case: {shape}/{label}"
                );
                assert!(read_attachment_recovery(&excel_path, "sidecar").is_err());
                assert_eq!(workspace_snapshot(workspace.path()), before);
            }
        }
    }

    #[test]
    fn rejects_non_json_numeric_constants_in_main_and_backup_candidates() {
        for source in ["sidecar", "backup"] {
            for constant in ["NaN", "Infinity", "-Infinity"] {
                let workspace = TestDir::new(&format!("constant-{source}-{constant}"));
                let pdf_path = workspace.path().join("Constants.pdf");
                fs::write(&pdf_path, b"%PDF-1.4\n").expect("write PDF");
                let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);
                let candidate_path = if source == "sidecar" {
                    sidecar_path
                } else {
                    sidecar_path.with_file_name(".Constants.pdf.doxmind.bak")
                };
                let candidate_bytes = [
                    br#"{"version":1,"pdf_editor":{"version":1,"edits":{"p0-t0":{"text":"changed"}}},"pdf_parsed_cache":{"sourceHash":""#
                        .as_slice(),
                    SOURCE_HASH.as_bytes(),
                    br#"","parsed":{"constant":"#.as_slice(),
                    constant.as_bytes(),
                    br#"}}}"#.as_slice(),
                ]
                .concat();
                fs::write(&candidate_path, &candidate_bytes).expect("write candidate");
                let before = workspace_snapshot(workspace.path());

                let inspection = inspect_attachment(&pdf_path).expect("inspect attachment");
                let selected =
                    &inspection.recovery_sources[if source == "sidecar" { 0 } else { 1 }];

                assert_eq!(selected.recovery_status, "unknown");
                assert_eq!(selected.sidecar_status, "unreadable");
                assert!(read_attachment_recovery(&pdf_path, source).is_err());
                assert_eq!(workspace_snapshot(workspace.path()), before);
            }
        }
    }

    #[test]
    fn legacy_pdf_edits_require_exportable_pdfjs_item_ids() {
        let cases = [
            (
                "first-item",
                serde_json::json!({"p0-t0": {"text": "changed"}}),
                "available",
            ),
            (
                "later-item",
                serde_json::json!({"p12-t34": {"text": "changed"}}),
                "available",
            ),
            ("empty", serde_json::json!({}), "none"),
            (
                "storage-marker-one",
                serde_json::json!({"1:0": {"text": "unmappable"}}),
                "unknown",
            ),
            (
                "storage-marker-two",
                serde_json::json!({"2:0": {"text": "unmappable"}}),
                "unknown",
            ),
            (
                "negative-page",
                serde_json::json!({"p-1-t0": {"text": "unmappable"}}),
                "unknown",
            ),
            (
                "missing-item",
                serde_json::json!({"p0-t": {"text": "unmappable"}}),
                "unknown",
            ),
            ("null", serde_json::Value::Null, "unknown"),
            ("array", serde_json::json!([]), "unknown"),
        ];
        for (label, edits, expected_status) in cases {
            let workspace = TestDir::new(label);
            let pdf_path = workspace.path().join("Historical-ids.pdf");
            fs::write(&pdf_path, b"%PDF-1.4\n").expect("write PDF");
            let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);
            fs::write(
                &sidecar_path,
                serde_json::to_vec(&serde_json::json!({
                    "version": 1,
                    "pdf_editor": {"version": 1, "edits": edits},
                    "pdf_parsed_cache": {"sourceHash": SOURCE_HASH, "parsed": {}},
                }))
                .expect("serialize sidecar"),
            )
            .expect("write sidecar");
            let before = workspace_snapshot(workspace.path());

            let inspection = inspect_attachment(&pdf_path).expect("inspect attachment");

            assert_eq!(
                inspection.recovery_sources[0].recovery_status, expected_status,
                "case: {label}"
            );
            assert_eq!(
                inspection.recovery_sources[0].sidecar_status,
                if expected_status == "unknown" {
                    "unreadable"
                } else {
                    "legacy"
                },
                "case: {label}"
            );
            assert_eq!(workspace_snapshot(workspace.path()), before);
        }
    }

    #[cfg(unix)]
    #[test]
    fn rejects_existing_and_dangling_candidate_symlinks_without_following() {
        use std::os::unix::fs::symlink;

        for source in ["sidecar", "backup"] {
            for target_exists in [true, false] {
                let workspace = TestDir::new(&format!("symlink-{source}-{target_exists}"));
                let external = TestDir::new(&format!("external-{source}-{target_exists}"));
                let pdf_path = workspace.path().join("Linked.pdf");
                fs::write(&pdf_path, b"%PDF-1.4\n").expect("write PDF");
                let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);
                let candidate_path = if source == "sidecar" {
                    sidecar_path
                } else {
                    sidecar_path.with_file_name(".Linked.pdf.doxmind.bak")
                };
                let external_path = external.path().join("candidate.json");
                let external_bytes = serde_json::to_vec(&serde_json::json!({
                    "version": 1,
                    "pdf_editor": {
                        "version": 1,
                        "edits": {"p0-t0": {"text": "do-not-disclose"}},
                    },
                    "pdf_parsed_cache": {
                        "sourceHash": SOURCE_HASH,
                        "parsed": {},
                    },
                }))
                .expect("serialize external state");
                let external_modified = if target_exists {
                    fs::write(&external_path, &external_bytes).expect("write external state");
                    Some(
                        fs::metadata(&external_path)
                            .expect("external metadata")
                            .modified()
                            .expect("external modified time"),
                    )
                } else {
                    None
                };
                symlink(&external_path, &candidate_path).expect("create candidate symlink");
                let link_target = fs::read_link(&candidate_path).expect("read link target");
                let link_modified = fs::symlink_metadata(&candidate_path)
                    .expect("link metadata")
                    .modified()
                    .expect("link modified time");
                let before_names = fs::read_dir(workspace.path())
                    .expect("read workspace")
                    .map(|entry| entry.expect("directory entry").file_name())
                    .collect::<Vec<_>>();

                let inspection = inspect_attachment(&pdf_path).expect("inspect attachment");
                let selected =
                    &inspection.recovery_sources[if source == "sidecar" { 0 } else { 1 }];
                let error = read_attachment_recovery(&pdf_path, source)
                    .expect_err("symlinked source must not be readable");

                assert_eq!(selected.recovery_status, "unknown");
                assert_eq!(selected.sidecar_status, "unreadable");
                assert!(!format!("{inspection:?}").contains("do-not-disclose"));
                assert!(!error.contains("do-not-disclose"));
                assert_eq!(
                    fs::read_link(&candidate_path).expect("read link target"),
                    link_target
                );
                assert_eq!(
                    fs::symlink_metadata(&candidate_path)
                        .expect("link metadata")
                        .modified()
                        .expect("link modified time"),
                    link_modified
                );
                let after_names = fs::read_dir(workspace.path())
                    .expect("read workspace")
                    .map(|entry| entry.expect("directory entry").file_name())
                    .collect::<Vec<_>>();
                assert_eq!(after_names, before_names);
                if let Some(external_modified) = external_modified {
                    assert_eq!(
                        fs::read(&external_path).expect("read external state"),
                        external_bytes
                    );
                    assert_eq!(
                        fs::metadata(&external_path)
                            .expect("external metadata")
                            .modified()
                            .expect("external modified time"),
                        external_modified
                    );
                }
            }
        }
    }

    #[test]
    fn inspection_and_recovery_preserve_source_sidecar_backup_and_lock_exactly() {
        let workspace = TestDir::new("forensic-zero-write");
        let pdf_path = workspace.path().join("Forensic.pdf");
        fs::write(&pdf_path, b"%PDF-1.4\nsource-bytes").expect("write PDF");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);
        let backup_path = sidecar_path.with_file_name(".Forensic.pdf.doxmind.bak");
        let lock_path = sidecar_path.with_file_name(".Forensic.pdf.doxmind.lock");
        fs::write(
            &sidecar_path,
            serde_json::to_vec(&serde_json::json!({
                "version": 1,
                "pdf_editor": {"edits": {"p0-t0": {"text": "main"}}},
                "pdf_parsed_cache": {"sourceHash": SOURCE_HASH, "parsed": {}},
            }))
            .expect("serialize sidecar"),
        )
        .expect("write sidecar");
        fs::write(
            &backup_path,
            serde_json::to_vec(&serde_json::json!({
                "version": 1,
                "pdf_editor": {"edits": {"p0-t0": {"text": "backup"}}},
                "pdf_parsed_cache": {"sourceHash": SOURCE_HASH, "parsed": {}},
            }))
            .expect("serialize backup"),
        )
        .expect("write backup");
        fs::write(&lock_path, b"pre-existing-lock").expect("write lock");
        let before = workspace_snapshot(workspace.path());

        let inspection = inspect_attachment(&pdf_path).expect("inspect attachment");
        let main = read_attachment_recovery(&pdf_path, "sidecar").expect("read sidecar state");
        let backup = read_attachment_recovery(&pdf_path, "backup").expect("read backup state");

        assert_eq!(inspection.recovery_status, "available");
        assert_eq!(inspection.recommended_source, None);
        assert_ne!(main.editor_state, backup.editor_state);
        assert_eq!(workspace_snapshot(workspace.path()), before);
    }

    #[test]
    fn recovery_read_rejects_unavailable_invalid_and_html_sources_without_fallback() {
        let workspace = TestDir::new("read-rejections");
        let pdf_path = workspace.path().join("BackupOnly.pdf");
        fs::write(&pdf_path, b"%PDF-1.4\n").expect("write PDF");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);
        let backup_path = sidecar_path.with_file_name(".BackupOnly.pdf.doxmind.bak");
        fs::write(
            &backup_path,
            serde_json::to_vec(&serde_json::json!({
                "version": 1,
                "pdf_editor": {"edits": {"p0-t0": {"text": "backup"}}},
                "pdf_parsed_cache": {"sourceHash": SOURCE_HASH, "parsed": {}},
            }))
            .expect("serialize backup"),
        )
        .expect("write backup");
        let html_path = workspace.path().join("Reference.html");
        fs::write(&html_path, b"<h1>Reference</h1>").expect("write HTML");

        assert!(read_attachment_recovery(&pdf_path, "sidecar").is_err());
        assert!(read_attachment_recovery(&pdf_path, "other").is_err());
        assert!(read_attachment_recovery(&html_path, "sidecar").is_err());
        assert_eq!(
            read_attachment_recovery(&pdf_path, "backup")
                .expect("read backup")
                .source,
            "backup"
        );
        assert!(!sidecar_path.exists(), "read must not restore main sidecar");
    }

    #[test]
    fn corrupt_future_and_mixed_backups_remain_unknown_without_writing() {
        let cases = [
            ("corrupt", b"{not-json".to_vec()),
            (
                "future",
                serde_json::to_vec(&serde_json::json!({
                    "version": 3,
                    "html": "<!-- pdf-block id=\"pdf-a\" src=\"Recovered.pdf\" -->",
                    "extras": {"blocks": {"pdf-a": {"editor": {"edits": {"1:0": {"text": "future"}}}}}},
                }))
                .expect("serialize future backup"),
            ),
            (
                "mixed",
                serde_json::to_vec(&serde_json::json!({
                    "version": 2,
                    "pdf_editor": {"edits": {"1:0": {"text": "legacy"}}},
                    "html": "<!-- pdf-block id=\"pdf-a\" src=\"Recovered.pdf\" -->",
                    "extras": {"blocks": {"pdf-a": {"editor": {"edits": {"1:0": {"text": "current"}}}}}},
                }))
                .expect("serialize mixed backup"),
            ),
        ];
        for (label, backup_bytes) in cases {
            let workspace = TestDir::new(label);
            let pdf_path = workspace.path().join("Recovered.pdf");
            fs::write(&pdf_path, b"%PDF-1.4\n").expect("write PDF");
            let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);
            let backup_path = sidecar_path.with_file_name(".Recovered.pdf.doxmind.bak");
            fs::write(&backup_path, &backup_bytes).expect("write backup");
            let before_entries = fs::read_dir(workspace.path())
                .expect("read workspace")
                .map(|entry| entry.expect("directory entry").file_name())
                .collect::<Vec<_>>();
            let before_modified = fs::metadata(&backup_path)
                .expect("backup metadata")
                .modified()
                .expect("backup modified time");

            let inspection = inspect_attachment(&pdf_path).expect("inspect attachment");

            assert_eq!(inspection.recovery_status, "unknown", "case: {label}");
            assert_eq!(inspection.recommended_source, None, "case: {label}");
            assert_eq!(
                inspection.recovery_sources[1].sidecar_status, "unreadable",
                "case: {label}"
            );
            assert_eq!(
                inspection.recovery_sources[1].recovery_status, "unknown",
                "case: {label}"
            );
            assert!(read_attachment_recovery(&pdf_path, "backup").is_err());
            assert_eq!(
                fs::read(&backup_path).expect("read backup"),
                backup_bytes,
                "case: {label}"
            );
            assert_eq!(
                fs::metadata(&backup_path)
                    .expect("backup metadata")
                    .modified()
                    .expect("backup modified time"),
                before_modified,
                "case: {label}"
            );
            let after_entries = fs::read_dir(workspace.path())
                .expect("read workspace")
                .map(|entry| entry.expect("directory entry").file_name())
                .collect::<Vec<_>>();
            assert_eq!(after_entries, before_entries, "case: {label}");
        }
    }

    #[test]
    fn current_pdf_edits_are_available_without_writing() {
        let workspace = TestDir::new("current-pdf");
        let pdf_path = workspace.path().join("Marked.pdf");
        fs::write(&pdf_path, b"%PDF-1.4\n").expect("write PDF");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);
        let sidecar_bytes = serde_json::to_vec(&serde_json::json!({
            "version": 2,
            "html": "<!-- pdf-block id=\"pdf-marked\" src=\"Marked.pdf\" -->",
            "extras": {"blocks": {"pdf-marked": {
                "editor": {
                    "version": 2,
                    "paragraphEdits": {"p0-b1": {"text": "changed"}},
                },
                "parsedCache": {"sourceHash": SOURCE_HASH, "parsed": {}},
            }}},
        }))
        .expect("serialize sidecar");
        fs::write(&sidecar_path, &sidecar_bytes).expect("write sidecar");

        let inspection = inspect_attachment(&pdf_path).expect("inspect attachment");

        assert_eq!(inspection.recovery_status, "available");
        assert_eq!(inspection.sidecar_status, "current");
        assert_eq!(
            fs::read(&sidecar_path).expect("read sidecar"),
            sidecar_bytes
        );
    }

    #[test]
    fn unsupported_current_sidecar_version_is_unreadable_without_writing() {
        let workspace = TestDir::new("unsupported-version");
        let pdf_path = workspace.path().join("Future.pdf");
        fs::write(&pdf_path, b"%PDF-1.4\n").expect("write PDF");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);
        let sidecar_bytes = br#"{
          "version": 3,
          "html": "<!-- pdf-block id=\"pdf-future\" src=\"Future.pdf\" -->",
          "extras": {"blocks": {"pdf-future": {"editor": null}}}
        }"#;
        fs::write(&sidecar_path, sidecar_bytes).expect("write sidecar");

        let inspection = inspect_attachment(&pdf_path).expect("inspect attachment");

        assert_eq!(inspection.recovery_status, "unknown");
        assert_eq!(inspection.sidecar_status, "unreadable");
        assert_eq!(
            fs::read(&sidecar_path).expect("read sidecar"),
            sidecar_bytes
        );
        assert_eq!(
            fs::read_dir(workspace.path())
                .expect("read workspace")
                .count(),
            2,
            "inspection must not create recovery artifacts"
        );
    }

    #[test]
    fn malformed_current_extras_or_blocks_are_unreadable_without_writing() {
        for (label, extras) in [
            ("missing-extras", None),
            ("non-object-extras", Some(serde_json::json!([]))),
            ("missing-blocks", Some(serde_json::json!({}))),
            ("non-object-blocks", Some(serde_json::json!({"blocks": []}))),
        ] {
            let workspace = TestDir::new(label);
            let pdf_path = workspace.path().join("Malformed.pdf");
            fs::write(&pdf_path, b"%PDF-1.4\n").expect("write PDF");
            let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);
            let mut sidecar = serde_json::json!({
                "version": 2,
                "html": "<!-- pdf-block id=\"pdf-a\" src=\"Malformed.pdf\" -->",
            });
            if let Some(extras) = extras {
                sidecar
                    .as_object_mut()
                    .expect("sidecar object")
                    .insert("extras".into(), extras);
            }
            let sidecar_bytes = serde_json::to_vec(&sidecar).expect("serialize sidecar");
            fs::write(&sidecar_path, &sidecar_bytes).expect("write sidecar");

            let inspection = inspect_attachment(&pdf_path).expect("inspect attachment");

            assert_eq!(inspection.recovery_status, "unknown", "case: {label}");
            assert_eq!(inspection.sidecar_status, "unreadable", "case: {label}");
            assert_eq!(
                fs::read(&sidecar_path).expect("read sidecar"),
                sidecar_bytes
            );
            assert_eq!(
                fs::read_dir(workspace.path())
                    .expect("read workspace")
                    .count(),
                2,
                "inspection must not create recovery artifacts"
            );
        }
    }

    #[test]
    fn current_sidecar_requires_one_matching_type_placeholder_without_writing() {
        for (label, html) in [
            ("missing-placeholder", "<p>No attachment placeholder</p>"),
            (
                "missing-src",
                "<!-- pdf-block id=\"pdf-a\" -->",
            ),
            (
                "src-before-id",
                "<!-- pdf-block src=\"Marked.pdf\" id=\"pdf-a\" -->",
            ),
            (
                "duplicate-placeholder",
                "<!-- pdf-block id=\"pdf-a\" src=\"Marked.pdf\" -->\n<!-- pdf-block id=\"pdf-a\" src=\"Marked.pdf\" -->",
            ),
        ] {
            let workspace = TestDir::new(label);
            let pdf_path = workspace.path().join("Marked.pdf");
            fs::write(&pdf_path, b"%PDF-1.4\n").expect("write PDF");
            let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);
            let sidecar_bytes = serde_json::to_vec(&serde_json::json!({
                "version": 2,
                "html": html,
                "extras": {"blocks": {"pdf-a": {"editor": null}}},
            }))
            .expect("serialize sidecar");
            fs::write(&sidecar_path, &sidecar_bytes).expect("write sidecar");

            let inspection = inspect_attachment(&pdf_path).expect("inspect attachment");

            assert_eq!(inspection.recovery_status, "unknown", "case: {label}");
            assert_eq!(inspection.sidecar_status, "unreadable", "case: {label}");
            assert_eq!(
                fs::read(&sidecar_path).expect("read sidecar"),
                sidecar_bytes
            );
        }
    }

    #[test]
    fn current_placeholder_requires_one_matching_object_slot_without_writing() {
        for (label, blocks) in [
            ("missing-slot", serde_json::json!({})),
            (
                "mismatched-slot",
                serde_json::json!({"pdf-other": {"editor": {"version": 1, "edits": {"1:0": {"text": "changed"}}}}}),
            ),
            (
                "extra-slot",
                serde_json::json!({
                    "pdf-a": {},
                    "pdf-other": {"editor": {"version": 1, "edits": {"1:0": {"text": "changed"}}}}
                }),
            ),
            ("malformed-slot", serde_json::json!({"pdf-a": []})),
        ] {
            let workspace = TestDir::new(label);
            let pdf_path = workspace.path().join("Marked.pdf");
            fs::write(&pdf_path, b"%PDF-1.4\n").expect("write PDF");
            let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);
            let sidecar_bytes = serde_json::to_vec(&serde_json::json!({
                "version": 2,
                "html": "<!-- pdf-block id=\"pdf-a\" src=\"Marked.pdf\" -->",
                "extras": {"blocks": blocks},
            }))
            .expect("serialize sidecar");
            fs::write(&sidecar_path, &sidecar_bytes).expect("write sidecar");

            let inspection = inspect_attachment(&pdf_path).expect("inspect attachment");

            assert_eq!(inspection.recovery_status, "unknown", "case: {label}");
            assert_eq!(inspection.sidecar_status, "unreadable", "case: {label}");
            assert_eq!(
                fs::read(&sidecar_path).expect("read sidecar"),
                sidecar_bytes
            );
        }
    }

    #[test]
    fn valid_current_shape_without_editor_reports_no_recovery_without_writing() {
        for (file_name, version, block_type, block_id) in [
            ("Plain.pdf", 1, "pdf-block", "pdf-a"),
            ("Plain.xlsx", 2, "excel-block", "excel-a"),
        ] {
            let workspace = TestDir::new(block_type);
            let attachment_path = workspace.path().join(file_name);
            fs::write(&attachment_path, b"attachment").expect("write attachment");
            let sidecar_path = doxmind_sidecar::sidecar_path_for(&attachment_path);
            let sidecar_bytes = serde_json::to_vec(&serde_json::json!({
                "version": version,
                "html": format!("<!-- {block_type} id=\"{block_id}\" src=\"{file_name}\" -->"),
                "extras": {"blocks": {(block_id): {}}},
            }))
            .expect("serialize sidecar");
            fs::write(&sidecar_path, &sidecar_bytes).expect("write sidecar");

            let inspection = inspect_attachment(&attachment_path).expect("inspect attachment");

            assert_eq!(inspection.recovery_status, "none");
            assert_eq!(inspection.sidecar_status, "current");
            assert_eq!(
                fs::read(&sidecar_path).expect("read sidecar"),
                sidecar_bytes
            );
        }
    }

    #[test]
    fn backup_makes_valid_main_without_edits_unknown_without_reading_or_writing_backup() {
        for (file_name, expected_sidecar_status, sidecar) in [
            (
                "Legacy.pdf",
                "legacy",
                serde_json::json!({
                    "version": 1,
                    "pdf_editor": {"version": 1},
                }),
            ),
            (
                "Current.xlsx",
                "current",
                serde_json::json!({
                    "version": 2,
                    "html": "<!-- excel-block id=\"excel-a\" src=\"Current.xlsx\" -->",
                    "extras": {"blocks": {"excel-a": {"editor": {"version": 1}}}},
                }),
            ),
        ] {
            let workspace = TestDir::new(expected_sidecar_status);
            let attachment_path = workspace.path().join(file_name);
            fs::write(&attachment_path, b"attachment").expect("write attachment");
            let sidecar_path = doxmind_sidecar::sidecar_path_for(&attachment_path);
            let sidecar_bytes = serde_json::to_vec(&sidecar).expect("serialize sidecar");
            fs::write(&sidecar_path, &sidecar_bytes).expect("write sidecar");
            let backup_path = sidecar_path.with_file_name(format!(
                "{}.bak",
                sidecar_path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .expect("sidecar file name")
            ));
            let backup_bytes = b"not parsed backup bytes";
            fs::write(&backup_path, backup_bytes).expect("write backup");

            let inspection = inspect_attachment(&attachment_path).expect("inspect attachment");

            assert_eq!(inspection.recovery_status, "unknown");
            assert_eq!(inspection.sidecar_status, expected_sidecar_status);
            assert_eq!(
                fs::read(&sidecar_path).expect("read sidecar"),
                sidecar_bytes
            );
            assert_eq!(fs::read(&backup_path).expect("read backup"), backup_bytes);
            assert_eq!(
                fs::read_dir(workspace.path())
                    .expect("read workspace")
                    .count(),
                3,
                "inspection must not create recovery artifacts"
            );
        }
    }

    #[test]
    fn unknown_pdf_edit_fields_are_unreadable_without_writing() {
        for unknown_field in ["freeTextBoxes", "highlightBoxes"] {
            let workspace = TestDir::new(unknown_field);
            let pdf_path = workspace.path().join("Unknown.pdf");
            fs::write(&pdf_path, b"%PDF-1.4\n").expect("write PDF");
            let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);
            let sidecar_bytes = format!(
                r#"{{
                  "version": 1,
                  "pdf_editor": {{"version": 1, "{unknown_field}": [{{"text": "changed"}}]}}
                }}"#
            );
            fs::write(&sidecar_path, sidecar_bytes.as_bytes()).expect("write sidecar");
            let original_modified = fs::metadata(&sidecar_path)
                .expect("sidecar metadata")
                .modified()
                .expect("sidecar modified time");

            let inspection = inspect_attachment(&pdf_path).expect("inspect attachment");

            assert_eq!(inspection.recovery_status, "unknown");
            assert_eq!(inspection.sidecar_status, "unreadable");
            assert_eq!(
                fs::read(&sidecar_path).expect("read sidecar"),
                sidecar_bytes.as_bytes()
            );
            assert_eq!(
                fs::metadata(&sidecar_path)
                    .expect("sidecar metadata")
                    .modified()
                    .expect("sidecar modified time"),
                original_modified
            );
            assert_eq!(
                fs::read_dir(workspace.path())
                    .expect("read workspace")
                    .count(),
                2,
                "inspection must not create recovery artifacts"
            );
        }
    }

    #[test]
    fn pdf_editor_version_is_optional_but_explicit_values_must_be_integer_one_or_two() {
        let cases = [
            ("missing", None, "available", "legacy"),
            (
                "version-one",
                Some(serde_json::json!(1)),
                "available",
                "legacy",
            ),
            (
                "version-two",
                Some(serde_json::json!(2)),
                "available",
                "legacy",
            ),
            (
                "future",
                Some(serde_json::json!(99)),
                "unknown",
                "unreadable",
            ),
            (
                "null",
                Some(serde_json::Value::Null),
                "unknown",
                "unreadable",
            ),
            (
                "boolean",
                Some(serde_json::json!(true)),
                "unknown",
                "unreadable",
            ),
            (
                "string",
                Some(serde_json::json!("1")),
                "unknown",
                "unreadable",
            ),
            (
                "float",
                Some(serde_json::json!(1.0)),
                "unknown",
                "unreadable",
            ),
        ];
        for (label, version, expected_recovery, expected_sidecar) in cases {
            let workspace = TestDir::new(label);
            let pdf_path = workspace.path().join("Versioned.pdf");
            fs::write(&pdf_path, b"%PDF-1.4\n").expect("write PDF");
            let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);
            let mut editor = serde_json::json!({
                "edits": {"p0-t0": {"text": "changed"}},
            });
            if let Some(version) = version {
                editor
                    .as_object_mut()
                    .expect("editor object")
                    .insert("version".into(), version);
            }
            fs::write(
                &sidecar_path,
                serde_json::to_vec(&serde_json::json!({
                    "version": 1,
                    "pdf_editor": editor,
                    "pdf_parsed_cache": {"sourceHash": SOURCE_HASH, "parsed": {}},
                }))
                .expect("serialize sidecar"),
            )
            .expect("write sidecar");

            let inspection = inspect_attachment(&pdf_path).expect("inspect attachment");

            assert_eq!(
                inspection.recovery_status, expected_recovery,
                "case: {label}"
            );
            assert_eq!(inspection.sidecar_status, expected_sidecar, "case: {label}");
        }
    }

    #[test]
    fn non_object_non_null_editors_are_unreadable_without_writing() {
        for (file_name, editor_key, editor_value) in [
            ("Malformed.pdf", "pdf_editor", serde_json::json!("edits")),
            (
                "Malformed.xlsx",
                "excel_editor",
                serde_json::json!([{"cell": "A1"}]),
            ),
        ] {
            let workspace = TestDir::new(editor_key);
            let attachment_path = workspace.path().join(file_name);
            fs::write(&attachment_path, b"attachment").expect("write attachment");
            let sidecar_path = doxmind_sidecar::sidecar_path_for(&attachment_path);
            let sidecar_bytes = serde_json::to_vec(&serde_json::json!({
                "version": 1,
                (editor_key): editor_value,
            }))
            .expect("serialize sidecar");
            fs::write(&sidecar_path, &sidecar_bytes).expect("write sidecar");

            let inspection = inspect_attachment(&attachment_path).expect("inspect attachment");

            assert_eq!(inspection.recovery_status, "unknown");
            assert_eq!(inspection.sidecar_status, "unreadable");
            assert_eq!(
                fs::read(&sidecar_path).expect("read sidecar"),
                sidecar_bytes
            );
            assert_eq!(
                fs::read_dir(workspace.path())
                    .expect("read workspace")
                    .count(),
                2,
                "inspection must not create recovery artifacts"
            );
        }
    }

    #[test]
    fn legacy_and_current_editors_together_are_unreadable_without_writing() {
        for (file_name, block_type, block_id, legacy_key, legacy_editor) in [
            (
                "Ambiguous.pdf",
                "pdf-block",
                "pdf-a",
                "pdf_editor",
                serde_json::json!({"version": 1, "edits": {}}),
            ),
            (
                "Ambiguous.xlsx",
                "excel-block",
                "excel-a",
                "excel_editor",
                serde_json::json!({"version": 1, "cells": {}}),
            ),
        ] {
            let workspace = TestDir::new(legacy_key);
            let attachment_path = workspace.path().join(file_name);
            fs::write(&attachment_path, b"attachment").expect("write attachment");
            let sidecar_path = doxmind_sidecar::sidecar_path_for(&attachment_path);
            let sidecar_bytes = serde_json::to_vec(&serde_json::json!({
                "version": 2,
                "html": format!("<!-- {block_type} id=\"{block_id}\" src=\"{file_name}\" -->"),
                "extras": {"blocks": {
                    (block_id): {"editor": {"version": 1, "edits": {"1:0": {"text": "changed"}}}}
                }},
                (legacy_key): legacy_editor,
            }))
            .expect("serialize sidecar");
            fs::write(&sidecar_path, &sidecar_bytes).expect("write sidecar");

            let inspection = inspect_attachment(&attachment_path).expect("inspect attachment");

            assert_eq!(inspection.recovery_status, "unknown");
            assert_eq!(inspection.sidecar_status, "unreadable");
            assert_eq!(
                fs::read(&sidecar_path).expect("read sidecar"),
                sidecar_bytes
            );
            assert_eq!(
                fs::read_dir(workspace.path())
                    .expect("read workspace")
                    .count(),
                2,
                "inspection must not create recovery artifacts"
            );
        }
    }

    #[test]
    fn legacy_envelopes_reject_future_and_cross_document_fields() {
        for (label, payload) in [
            (
                "future-legacy",
                serde_json::json!({
                    "version": 3,
                    "pdf_editor": {"edits": {"1:0": {"text": "future"}}},
                }),
            ),
            (
                "cross-document",
                serde_json::json!({
                    "version": 1,
                    "pdf_editor": {"edits": {"1:0": {"text": "pdf"}}},
                    "excel_parsed_cache": {"sourceHash": "wrong"},
                }),
            ),
        ] {
            let workspace = TestDir::new(label);
            let pdf_path = workspace.path().join("Strict.pdf");
            fs::write(&pdf_path, b"%PDF-1.4\n").expect("write PDF");
            let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);
            fs::write(
                &sidecar_path,
                serde_json::to_vec(&payload).expect("serialize sidecar"),
            )
            .expect("write sidecar");

            let inspection = inspect_attachment(&pdf_path).expect("inspect attachment");

            assert_eq!(inspection.recovery_status, "unknown", "case: {label}");
            assert_eq!(inspection.sidecar_status, "unreadable", "case: {label}");
        }
    }

    #[test]
    fn matching_legacy_cache_without_editor_is_known_but_not_recoverable() {
        let workspace = TestDir::new("legacy-cache-only");
        let pdf_path = workspace.path().join("Cached.pdf");
        fs::write(&pdf_path, b"%PDF-1.4\n").expect("write PDF");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);
        fs::write(
            &sidecar_path,
            br#"{"version":1,"pdf_parsed_cache":{"sourceHash":"known"}}"#,
        )
        .expect("write sidecar");

        let inspection = inspect_attachment(&pdf_path).expect("inspect attachment");

        assert_eq!(inspection.recovery_status, "none");
        assert_eq!(inspection.sidecar_status, "legacy");
    }

    #[test]
    fn legacy_excel_edits_are_available_without_writing() {
        let workspace = TestDir::new("legacy-excel");
        let excel_path = workspace.path().join("Budget.xlsx");
        fs::write(&excel_path, b"PK\x03\x04workbook").expect("write workbook");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&excel_path);
        let sidecar_bytes = serde_json::to_vec(&serde_json::json!({
            "version": 1,
            "excel_editor": {
                "version": 1,
                "cells": {"Sheet1!0,0": {"value": "changed"}},
            },
            "excel_parsed_cache": {"sourceHash": SOURCE_HASH, "parsed": {}},
        }))
        .expect("serialize sidecar");
        fs::write(&sidecar_path, &sidecar_bytes).expect("write sidecar");

        let inspection = inspect_attachment(&excel_path).expect("inspect attachment");

        assert_eq!(inspection.document_type, "excel");
        assert_eq!(inspection.recovery_status, "available");
        assert_eq!(inspection.sidecar_status, "legacy");
        assert_eq!(
            fs::read(&sidecar_path).expect("read sidecar"),
            sidecar_bytes
        );
    }

    #[test]
    fn unknown_excel_schema_is_unreadable_without_writing() {
        let workspace = TestDir::new("unknown-excel");
        let excel_path = workspace.path().join("Unknown.xlsx");
        fs::write(&excel_path, b"PK\x03\x04workbook").expect("write workbook");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&excel_path);
        let sidecar_bytes = br#"{
          "version": 1,
          "excel_editor": {
            "version": 1,
            "mysteryEdits": {"Sheet1!0,0": {"value": "changed"}}
          }
        }"#;
        fs::write(&sidecar_path, sidecar_bytes).expect("write sidecar");
        let original_modified = fs::metadata(&sidecar_path)
            .expect("sidecar metadata")
            .modified()
            .expect("sidecar modified time");

        let inspection = inspect_attachment(&excel_path).expect("inspect attachment");

        assert_eq!(inspection.document_type, "excel");
        assert_eq!(inspection.recovery_status, "unknown");
        assert_eq!(inspection.sidecar_status, "unreadable");
        assert_eq!(
            fs::read(&sidecar_path).expect("read sidecar"),
            sidecar_bytes
        );
        assert_eq!(
            fs::metadata(&sidecar_path)
                .expect("sidecar metadata")
                .modified()
                .expect("sidecar modified time"),
            original_modified
        );
        let entries = fs::read_dir(workspace.path())
            .expect("read workspace")
            .map(|entry| entry.expect("directory entry").file_name())
            .collect::<Vec<_>>();
        assert_eq!(
            entries.len(),
            2,
            "inspection must not create recovery artifacts"
        );
    }

    #[test]
    fn excel_editor_version_is_optional_but_explicit_value_must_be_integer_one() {
        let cases = [
            ("missing", None, "available", "legacy"),
            (
                "version-one",
                Some(serde_json::json!(1)),
                "available",
                "legacy",
            ),
            (
                "future",
                Some(serde_json::json!(2)),
                "unknown",
                "unreadable",
            ),
            (
                "null",
                Some(serde_json::Value::Null),
                "unknown",
                "unreadable",
            ),
            (
                "boolean",
                Some(serde_json::json!(true)),
                "unknown",
                "unreadable",
            ),
            (
                "string",
                Some(serde_json::json!("1")),
                "unknown",
                "unreadable",
            ),
            (
                "float",
                Some(serde_json::json!(1.0)),
                "unknown",
                "unreadable",
            ),
        ];
        for (label, version, expected_recovery, expected_sidecar) in cases {
            let workspace = TestDir::new(label);
            let excel_path = workspace.path().join("Versioned.xlsx");
            fs::write(&excel_path, b"PK\x03\x04workbook").expect("write workbook");
            let sidecar_path = doxmind_sidecar::sidecar_path_for(&excel_path);
            let mut editor = serde_json::json!({
                "cells": {"Sheet1!0,0": {"value": "changed"}},
            });
            if let Some(version) = version {
                editor
                    .as_object_mut()
                    .expect("editor object")
                    .insert("version".into(), version);
            }
            fs::write(
                &sidecar_path,
                serde_json::to_vec(&serde_json::json!({
                    "version": 1,
                    "excel_editor": editor,
                    "excel_parsed_cache": {"sourceHash": SOURCE_HASH, "parsed": {}},
                }))
                .expect("serialize sidecar"),
            )
            .expect("write sidecar");

            let inspection = inspect_attachment(&excel_path).expect("inspect attachment");

            assert_eq!(
                inspection.recovery_status, expected_recovery,
                "case: {label}"
            );
            assert_eq!(inspection.sidecar_status, expected_sidecar, "case: {label}");
        }
    }

    #[test]
    fn excel_filters_are_unknown_and_cannot_be_read_for_recovery() {
        for (label, unsupported_state) in [
            ("filters", serde_json::json!({"filters": {"A": ["open"]}})),
            ("filter-mode", serde_json::json!({"filterMode": true})),
        ] {
            let workspace = TestDir::new(label);
            let excel_path = workspace.path().join("Filtered.xlsx");
            fs::write(&excel_path, b"PK\x03\x04workbook").expect("write workbook");
            let sidecar_path = doxmind_sidecar::sidecar_path_for(&excel_path);
            let mut editor = serde_json::json!({"version": 1});
            editor
                .as_object_mut()
                .expect("editor object")
                .extend(unsupported_state.as_object().expect("state object").clone());
            let sidecar_bytes = serde_json::to_vec(&serde_json::json!({
                "version": 1,
                "excel_editor": editor,
            }))
            .expect("serialize sidecar");
            fs::write(&sidecar_path, &sidecar_bytes).expect("write sidecar");

            let inspection = inspect_attachment(&excel_path).expect("inspect attachment");

            assert_eq!(inspection.recovery_status, "unknown", "case: {label}");
            assert_eq!(inspection.sidecar_status, "unreadable", "case: {label}");
            assert!(
                read_attachment_recovery(&excel_path, "sidecar").is_err(),
                "case: {label}"
            );
            assert_eq!(
                fs::read(&sidecar_path).expect("read sidecar"),
                sidecar_bytes
            );
        }
    }

    #[test]
    fn corrupt_sidecar_is_unknown_without_forensic_write() {
        let workspace = TestDir::new("corrupt");
        let pdf_path = workspace.path().join("Broken.pdf");
        fs::write(&pdf_path, b"%PDF-1.4\n").expect("write PDF");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);
        let corrupt_bytes = b"{not-json";
        fs::write(&sidecar_path, corrupt_bytes).expect("write sidecar");

        let inspection = inspect_attachment(&pdf_path).expect("inspect attachment");

        assert_eq!(inspection.recovery_status, "unknown");
        assert_eq!(inspection.sidecar_status, "unreadable");
        assert_eq!(
            fs::read(&sidecar_path).expect("read sidecar"),
            corrupt_bytes
        );
        let entries = fs::read_dir(workspace.path())
            .expect("read workspace")
            .map(|entry| entry.expect("directory entry").file_name())
            .collect::<Vec<_>>();
        assert_eq!(
            entries.len(),
            2,
            "inspection must not create forensic artifacts"
        );
    }

    #[test]
    fn ambiguous_editor_slots_are_unknown() {
        let workspace = TestDir::new("ambiguous");
        let pdf_path = workspace.path().join("Ambiguous.pdf");
        fs::write(&pdf_path, b"%PDF-1.4\n").expect("write PDF");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);
        let sidecar_bytes = br#"{
          "version": 2,
          "extras": {"blocks": {
            "pdf-a": {"editor": {"version": 1, "edits": {}}},
            "pdf-b": {"editor": {"version": 1, "edits": {"1:0": {"text": "x"}}}}
          }}
        }"#;
        fs::write(&sidecar_path, sidecar_bytes).expect("write sidecar");

        let inspection = inspect_attachment(&pdf_path).expect("inspect attachment");

        assert_eq!(inspection.recovery_status, "unknown");
        assert_eq!(inspection.sidecar_status, "unreadable");
        assert_eq!(
            fs::read(&sidecar_path).expect("read sidecar"),
            sidecar_bytes
        );
    }

    #[test]
    fn html_attachment_never_requires_recovery() {
        let workspace = TestDir::new("html");
        let html_path = workspace.path().join("reference.html");
        fs::write(&html_path, b"<h1>Reference</h1>").expect("write HTML");

        let inspection = inspect_attachment(&html_path).expect("inspect attachment");

        assert_eq!(inspection.document_type, "html");
        assert_eq!(inspection.recovery_status, "none");
        assert_eq!(inspection.sidecar_status, "missing");
        assert!(inspection.recovery_sources.is_empty());
        assert_eq!(inspection.recommended_source, None);
        assert!(!doxmind_sidecar::sidecar_path_for(&html_path).exists());
    }

    #[test]
    fn unreadable_html_sidecar_is_unknown_but_has_no_recovery_sources() {
        let workspace = TestDir::new("html-sidecar");
        let html_path = workspace.path().join("reference.html");
        fs::write(&html_path, b"<h1>Reference</h1>").expect("write HTML");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&html_path);
        let opaque_bytes = b"opaque attachment metadata";
        fs::write(&sidecar_path, opaque_bytes).expect("write sidecar");

        let inspection = inspect_attachment(&html_path).expect("inspect attachment");

        assert_eq!(inspection.recovery_status, "unknown");
        assert_eq!(inspection.sidecar_status, "unreadable");
        assert!(inspection.recovery_sources.is_empty());
        assert_eq!(inspection.recommended_source, None);
        assert_eq!(fs::read(&sidecar_path).expect("read sidecar"), opaque_bytes);
    }
}
