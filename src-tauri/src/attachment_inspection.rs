use std::fs;
use std::path::Path;

use serde::Serialize;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInspection {
    pub document_type: String,
    pub recovery_status: String,
    pub sidecar_status: String,
    pub sidecar_path: String,
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
    let backup_exists = legacy_editor_key.is_some()
        && sidecar_path
            .with_file_name(format!("{sidecar_name}.bak"))
            .exists();
    let raw = match fs::read(&sidecar_path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(AttachmentInspection {
                document_type: document_type.into(),
                recovery_status: if backup_exists { "unknown" } else { "none" }.into(),
                sidecar_status: "missing".into(),
                sidecar_path: sidecar_name,
            });
        }
        Err(error) => return Err(format!("failed to read attachment sidecar: {error}")),
    };
    let Some(legacy_editor_key) = legacy_editor_key else {
        return Ok(AttachmentInspection {
            document_type: document_type.into(),
            recovery_status: "none".into(),
            sidecar_status: "current".into(),
            sidecar_path: sidecar_name,
        });
    };
    let sidecar: serde_json::Value = match serde_json::from_slice(&raw) {
        Ok(serde_json::Value::Object(sidecar)) => serde_json::Value::Object(sidecar),
        Ok(_) | Err(_) => {
            return Ok(AttachmentInspection {
                document_type: document_type.into(),
                recovery_status: "unknown".into(),
                sidecar_status: "unreadable".into(),
                sidecar_path: sidecar_name,
            });
        }
    };
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
    if sidecar.get(legacy_editor_key).is_some() && has_current_editor {
        return Ok(AttachmentInspection {
            document_type: document_type.into(),
            recovery_status: "unknown".into(),
            sidecar_status: "unreadable".into(),
            sidecar_path: sidecar_name,
        });
    }
    let (mut sidecar_status, editor) = if let Some(editor) = sidecar.get(legacy_editor_key) {
        ("legacy", Some(editor))
    } else {
        if !matches!(
            sidecar.get("version").and_then(serde_json::Value::as_u64),
            Some(1 | 2)
        ) {
            return Ok(AttachmentInspection {
                document_type: document_type.into(),
                recovery_status: "unknown".into(),
                sidecar_status: "unreadable".into(),
                sidecar_path: sidecar_name,
            });
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
            return Ok(AttachmentInspection {
                document_type: document_type.into(),
                recovery_status: "unknown".into(),
                sidecar_status: "unreadable".into(),
                sidecar_path: sidecar_name,
            });
        };
        let Some(extras) = sidecar.get("extras").and_then(serde_json::Value::as_object) else {
            return Ok(AttachmentInspection {
                document_type: document_type.into(),
                recovery_status: "unknown".into(),
                sidecar_status: "unreadable".into(),
                sidecar_path: sidecar_name,
            });
        };
        let Some(blocks) = extras.get("blocks").and_then(serde_json::Value::as_object) else {
            return Ok(AttachmentInspection {
                document_type: document_type.into(),
                recovery_status: "unknown".into(),
                sidecar_status: "unreadable".into(),
                sidecar_path: sidecar_name,
            });
        };
        let Some(slot) = (blocks.len() == 1)
            .then(|| blocks.get(placeholder_id))
            .flatten()
            .and_then(serde_json::Value::as_object)
        else {
            return Ok(AttachmentInspection {
                document_type: document_type.into(),
                recovery_status: "unknown".into(),
                sidecar_status: "unreadable".into(),
                sidecar_path: sidecar_name,
            });
        };
        ("current", slot.get("editor"))
    };
    let editor_recovery_status = match document_type {
        "pdf" => editor.map_or("none", pdf_editor_recovery_status),
        "excel" => editor.map_or("none", excel_editor_recovery_status),
        _ => "none",
    };
    if editor_recovery_status == "unknown" {
        sidecar_status = "unreadable";
    }
    let recovery_status = if editor_recovery_status == "none" && backup_exists {
        "unknown"
    } else {
        editor_recovery_status
    };

    Ok(AttachmentInspection {
        document_type: document_type.into(),
        recovery_status: recovery_status.into(),
        sidecar_status: sidecar_status.into(),
        sidecar_path: sidecar_name,
    })
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

    use super::{inspect_attachment, AttachmentInspection};

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

    #[test]
    fn legacy_pdf_edits_are_available_without_writing() {
        let workspace = TestDir::new("legacy-pdf");
        let pdf_path = workspace.path().join("Spec.pdf");
        fs::write(&pdf_path, b"%PDF-1.4\n").expect("write PDF");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);
        let sidecar_bytes = br#"{
          "version": 1,
          "pdf_editor": {"version": 1, "edits": {"1:0": {"text": "changed"}}}
        }"#;
        fs::write(&sidecar_path, sidecar_bytes).expect("write sidecar");

        let inspection = inspect_attachment(&pdf_path).expect("inspect attachment");

        assert_eq!(
            inspection,
            AttachmentInspection {
                document_type: "pdf".into(),
                recovery_status: "available".into(),
                sidecar_status: "legacy".into(),
                sidecar_path: ".Spec.pdf.doxmind".into(),
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
    fn current_pdf_edits_are_available_without_writing() {
        let workspace = TestDir::new("current-pdf");
        let pdf_path = workspace.path().join("Marked.pdf");
        fs::write(&pdf_path, b"%PDF-1.4\n").expect("write PDF");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&pdf_path);
        let sidecar_bytes = br#"{
          "version": 2,
          "html": "<!-- pdf-block id=\"pdf-marked\" src=\"Marked.pdf\" -->",
          "extras": {"blocks": {"pdf-marked": {"editor": {
            "version": 2,
            "paragraphEdits": {"p0-b1": {"text": "changed"}}
          }}}}
        }"#;
        fs::write(&sidecar_path, sidecar_bytes).expect("write sidecar");

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
    fn legacy_excel_edits_are_available_without_writing() {
        let workspace = TestDir::new("legacy-excel");
        let excel_path = workspace.path().join("Budget.xlsx");
        fs::write(&excel_path, b"PK\x03\x04workbook").expect("write workbook");
        let sidecar_path = doxmind_sidecar::sidecar_path_for(&excel_path);
        let sidecar_bytes = br#"{
          "version": 1,
          "excel_editor": {
            "version": 1,
            "cells": {"Sheet1!0,0": {"value": "changed"}}
          }
        }"#;
        fs::write(&sidecar_path, sidecar_bytes).expect("write sidecar");

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
        assert!(!doxmind_sidecar::sidecar_path_for(&html_path).exists());
    }
}
