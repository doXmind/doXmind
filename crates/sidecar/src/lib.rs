//! doxmind sidecar storage: pure functions for reading and writing
//! markdown documents paired with a hidden `.<name>.doxmind` JSON sidecar.
//!
//! # Model
//!
//! Each document is a pair on disk:
//!
//! - `foo.md`         clean markdown for portability (git, VS Code, iCloud)
//! - `.foo.doxmind`   hidden sidecar with full-fidelity HTML and rich features
//!
//! The TipTap editor stays HTML-based; this crate is the boundary between
//! editor (HTML) and disk (markdown). Callers convert HTML <-> markdown
//! externally (the editor produces both via `getHTML()` / `getMarkdown()`)
//! and pass markdown into [`write_doc`].
//!
//! # Freshness
//!
//! The sidecar embeds `markdown_hash` = sha256 of the full md file content
//! when the sidecar was last written. On read, if the current md hash matches,
//! the sidecar's HTML is used (no re-parse). If it doesn't match, the user
//! edited the .md externally and we fall back to converting markdown -> HTML.

mod error;

pub use error::{Error, Result};

use std::path::{Path, PathBuf};

use gray_matter::{engine::YAML, Matter};
use pulldown_cmark::{html as cmark_html, Options as CmarkOptions, Parser as CmarkParser};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const SIDECAR_VERSION: u32 = 1;

/// Document metadata, sourced from the markdown file's YAML frontmatter.
///
/// The `id` is the canonical document identity; all other fields are
/// preserved as-is including unknown frontmatter keys (via `extras`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DocMeta {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub favorite: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated: Option<String>,
    #[serde(flatten)]
    pub extras: serde_json::Map<String, serde_json::Value>,
}

impl DocMeta {
    pub fn new(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            title: None,
            icon: None,
            favorite: None,
            cover: None,
            created: None,
            updated: None,
            extras: serde_json::Map::new(),
        }
    }
}

/// What the editor needs to display a document.
#[derive(Clone, Debug, PartialEq)]
pub struct ReadResult {
    pub html: String,
    pub markdown: String,
    pub meta: DocMeta,
    pub extras: Option<serde_json::Value>,
    pub source: Source,
}

/// Where the HTML in [`ReadResult`] came from.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    /// Sidecar was present and fresh; its `html` was used directly.
    Sidecar,
    /// No fresh sidecar; HTML was derived from markdown via [`markdown_to_html`].
    Markdown,
    /// File body was empty; both `html` and `markdown` are empty strings.
    Empty,
}

/// Payload accepted by [`write_doc`]. Caller has already converted the editor
/// state to both HTML and markdown.
#[derive(Clone, Debug)]
pub struct DocPayload {
    pub html: String,
    pub markdown: String,
    pub meta: DocMeta,
    pub extras: Option<serde_json::Value>,
}

/// On-disk JSON shape of `.<name>.doxmind`.
#[derive(Clone, Debug, Serialize, Deserialize)]
struct SidecarFile {
    version: u32,
    id: String,
    html: String,
    markdown_hash: String,
    updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    extras: Option<serde_json::Value>,
}

/// Compute the sibling sidecar path for a given markdown path.
///
/// `/a/b/foo.md`        -> `/a/b/.foo.doxmind`
/// `foo.md`             -> `.foo.doxmind`
/// `./foo.md`           -> `./.foo.doxmind`
/// `foo.MD` / `foo.markdown` (case-insensitive) -> same scheme
/// `项目计划.md`         -> `.项目计划.doxmind`
///
/// Files without a recognized markdown extension keep their full filename:
/// `notes.txt` -> `.notes.txt.doxmind` (so the sidecar never clobbers the
/// original file's basename).
pub fn sidecar_path_for(md_path: impl AsRef<Path>) -> PathBuf {
    let md_path = md_path.as_ref();
    let parent = md_path.parent().map(Path::to_path_buf).unwrap_or_default();
    let file = md_path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| String::from("untitled"));

    let stem = strip_md_extension(&file).unwrap_or(file.as_str());
    let sidecar_name = format!(".{stem}.doxmind");
    parent.join(sidecar_name)
}

fn strip_md_extension(file: &str) -> Option<&str> {
    let lower = file.to_ascii_lowercase();
    if let Some(stem) = lower.strip_suffix(".md") {
        return Some(&file[..stem.len()]);
    }
    if let Some(stem) = lower.strip_suffix(".markdown") {
        return Some(&file[..stem.len()]);
    }
    None
}

/// Stable sha256 hex of the given content (treated as utf-8 bytes).
pub fn hash_markdown(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    let digest = hasher.finalize();
    hex_lower(&digest)
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

/// Convert markdown body (without frontmatter) to HTML using pulldown-cmark
/// with tables, footnotes, strikethrough, task lists, and smart-punctuation
/// disabled (we want output that round-trips back through markdownify cleanly).
pub fn markdown_to_html(body: &str) -> String {
    if body.trim().is_empty() {
        return String::new();
    }
    let mut opts = CmarkOptions::empty();
    opts.insert(CmarkOptions::ENABLE_TABLES);
    opts.insert(CmarkOptions::ENABLE_STRIKETHROUGH);
    opts.insert(CmarkOptions::ENABLE_TASKLISTS);
    opts.insert(CmarkOptions::ENABLE_HEADING_ATTRIBUTES);
    let parser = CmarkParser::new_ext(body, opts);
    let mut html = String::with_capacity(body.len());
    cmark_html::push_html(&mut html, parser);
    html
}

/// Read a `.md` file plus optional sibling sidecar; return what the editor
/// should display.
pub async fn read_doc(md_path: impl AsRef<Path>) -> Result<ReadResult> {
    let md_path = md_path.as_ref();
    let raw = tokio::fs::read_to_string(md_path)
        .await
        .map_err(|e| Error::ReadFailed(md_path.to_path_buf(), e))?;

    let (mut meta, body) = parse_frontmatter(&raw)?;

    if body.trim().is_empty() {
        return Ok(ReadResult {
            html: String::new(),
            markdown: String::new(),
            meta,
            extras: None,
            source: Source::Empty,
        });
    }

    let current_hash = hash_markdown(&raw);
    let sidecar_path = sidecar_path_for(md_path);

    if let Some(side) = read_sidecar(&sidecar_path).await? {
        if side.version == SIDECAR_VERSION && side.markdown_hash == current_hash {
            // Trust the sidecar id over a missing/mismatched frontmatter id —
            // the sidecar was written by us and is authoritative for this pairing.
            if meta.id != side.id {
                meta.id = side.id.clone();
            }
            return Ok(ReadResult {
                html: side.html,
                markdown: body,
                meta,
                extras: side.extras,
                source: Source::Sidecar,
            });
        }
        // Stale sidecar: ignore and fall through to markdown path.
    }

    let html = markdown_to_html(&body);
    Ok(ReadResult {
        html,
        markdown: body,
        meta,
        extras: None,
        source: Source::Markdown,
    })
}

/// Write a `.md` + sidecar pair. Always writes the `.md` first, then the
/// sidecar. If the sidecar write fails, the `.md` is left in its updated
/// state and the error is bubbled — callers can retry the sidecar; a stale
/// sidecar will simply be detected and ignored on next read.
pub async fn write_doc(md_path: impl AsRef<Path>, payload: &DocPayload) -> Result<()> {
    if payload.meta.id.trim().is_empty() {
        return Err(Error::MissingId);
    }
    let md_path = md_path.as_ref();
    let md_content = build_md_with_frontmatter(&payload.meta, &payload.markdown)?;

    atomic_write(md_path, md_content.as_bytes()).await?;

    let sidecar = SidecarFile {
        version: SIDECAR_VERSION,
        id: payload.meta.id.clone(),
        html: payload.html.clone(),
        markdown_hash: hash_markdown(&md_content),
        updated_at: now_iso8601(),
        extras: payload.extras.clone(),
    };
    let sidecar_json =
        serde_json::to_vec_pretty(&sidecar).map_err(Error::SidecarSerialize)?;
    atomic_write(&sidecar_path_for(md_path), &sidecar_json).await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

fn parse_frontmatter(raw: &str) -> Result<(DocMeta, String)> {
    let matter = Matter::<YAML>::new();
    let parsed = matter.parse(raw);
    let body = parsed.content.clone();

    let meta = match parsed.data {
        Some(pod) => {
            // gray_matter's Pod -> serde_json::Value via its Deserialize impl.
            let json: serde_json::Value =
                pod.deserialize().map_err(Error::FrontmatterParse)?;
            value_to_meta(json)
        }
        None => DocMeta::new(new_id()),
    };

    Ok((meta, body))
}

fn value_to_meta(value: serde_json::Value) -> DocMeta {
    // Accept any top-level shape; coerce to DocMeta with a generated id when
    // missing. Unknown keys flow into `extras` via `#[serde(flatten)]`.
    let mut map = match value {
        serde_json::Value::Object(map) => map,
        _ => serde_json::Map::new(),
    };
    if !map.contains_key("id")
        || !matches!(map.get("id"), Some(serde_json::Value::String(s)) if !s.is_empty())
    {
        map.insert("id".into(), serde_json::Value::String(new_id()));
    }
    serde_json::from_value(serde_json::Value::Object(map)).unwrap_or_else(|_| DocMeta::new(new_id()))
}

fn build_md_with_frontmatter(meta: &DocMeta, body: &str) -> Result<String> {
    let yaml = serde_yaml::to_string(meta).map_err(Error::FrontmatterSerialize)?;
    let yaml = yaml.trim_end_matches('\n');
    // Always write a trailing newline after the body for POSIX-friendliness.
    let trimmed_body = body.trim_end_matches('\n');
    Ok(format!("---\n{yaml}\n---\n\n{trimmed_body}\n"))
}

async fn read_sidecar(path: &Path) -> Result<Option<SidecarFile>> {
    match tokio::fs::read(path).await {
        Ok(bytes) => match serde_json::from_slice::<SidecarFile>(&bytes) {
            Ok(s) => Ok(Some(s)),
            // Corrupt sidecar: treat as absent so reads don't break the user.
            Err(_) => Ok(None),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(Error::ReadFailed(path.to_path_buf(), e)),
    }
}

/// Atomic write via temp file + rename on the same fs (POSIX rename(2) is atomic).
async fn atomic_write(target: &Path, bytes: &[u8]) -> Result<()> {
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    if !parent.as_os_str().is_empty() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| Error::WriteFailed(parent.to_path_buf(), e))?;
    }
    let tmp = temp_sibling(target);
    tokio::fs::write(&tmp, bytes)
        .await
        .map_err(|e| Error::WriteFailed(tmp.clone(), e))?;
    if let Err(e) = tokio::fs::rename(&tmp, target).await {
        // Best-effort cleanup of the temp file before bubbling the error.
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(Error::WriteFailed(target.to_path_buf(), e));
    }
    Ok(())
}

fn temp_sibling(target: &Path) -> PathBuf {
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let name = target
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "untitled".into());
    let nonce = uuid::Uuid::new_v4().simple().to_string();
    parent.join(format!(".{name}.tmp-{nonce}"))
}

fn now_iso8601() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    // RFC 3339 / ISO 8601 in UTC, second precision. Avoids pulling chrono.
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    format_unix_seconds_utc(secs)
}

/// Tiny date formatter so we don't depend on chrono just for an ISO string.
/// Handles years 1970..2262; clamps outside that range.
fn format_unix_seconds_utc(secs: i64) -> String {
    let secs = secs.clamp(0, 9_223_372_036);
    let days_since_epoch = secs / 86_400;
    let secs_of_day = secs % 86_400;
    let h = secs_of_day / 3600;
    let m = (secs_of_day % 3600) / 60;
    let s = secs_of_day % 60;

    // Civil-from-days (Howard Hinnant's algorithm).
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };

    format!(
        "{year:04}-{month:02}-{d:02}T{h:02}:{m:02}:{s:02}Z",
        year = year,
        month = month,
        d = d,
        h = h,
        m = m,
        s = s
    )
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::tempdir;

    fn td() -> tempfile::TempDir {
        tempdir().expect("tempdir")
    }

    fn write_md(dir: &Path, name: &str, body: &str) -> PathBuf {
        let p = dir.join(name);
        std::fs::write(&p, body).unwrap();
        p
    }

    // ---- sidecar_path_for ----

    #[test]
    fn sidecar_path_basic() {
        assert_eq!(
            sidecar_path_for("/a/b/foo.md"),
            PathBuf::from("/a/b/.foo.doxmind")
        );
    }

    #[test]
    fn sidecar_path_no_dir() {
        assert_eq!(sidecar_path_for("foo.md"), PathBuf::from(".foo.doxmind"));
    }

    #[test]
    fn sidecar_path_dot_prefixed_dir() {
        assert_eq!(
            sidecar_path_for("./foo.md"),
            PathBuf::from("./.foo.doxmind")
        );
    }

    #[test]
    fn sidecar_path_uppercase_extension() {
        assert_eq!(sidecar_path_for("foo.MD"), PathBuf::from(".foo.doxmind"));
    }

    #[test]
    fn sidecar_path_dot_markdown() {
        assert_eq!(
            sidecar_path_for("/x/foo.markdown"),
            PathBuf::from("/x/.foo.doxmind")
        );
    }

    #[test]
    fn sidecar_path_unicode_filename() {
        assert_eq!(
            sidecar_path_for("项目计划.md"),
            PathBuf::from(".项目计划.doxmind")
        );
    }

    #[test]
    fn sidecar_path_unrecognized_extension_keeps_full_name() {
        assert_eq!(
            sidecar_path_for("notes.txt"),
            PathBuf::from(".notes.txt.doxmind")
        );
    }

    // ---- hash_markdown ----

    #[test]
    fn hash_is_stable() {
        let a = hash_markdown("hello");
        let b = hash_markdown("hello");
        assert_eq!(a, b);
        assert_eq!(a.len(), 64); // sha256 hex
    }

    #[test]
    fn hash_differs_for_different_input() {
        assert_ne!(hash_markdown("hello"), hash_markdown("hello!"));
    }

    // ---- read_doc ----

    #[tokio::test]
    async fn read_foreign_md_no_sidecar_uses_markdown_source() {
        let dir = td();
        let p = write_md(
            dir.path(),
            "foreign.md",
            "---\nid: abc\n---\n\n# Hello\n\nworld\n",
        );
        let r = read_doc(&p).await.unwrap();
        assert_eq!(r.source, Source::Markdown);
        assert!(r.html.contains("<h1>Hello</h1>"));
        assert_eq!(r.meta.id, "abc");
    }

    #[tokio::test]
    async fn read_md_missing_id_generates_uuid() {
        let dir = td();
        let p = write_md(dir.path(), "noid.md", "---\ntitle: T\n---\n\nbody\n");
        let r = read_doc(&p).await.unwrap();
        assert_eq!(r.source, Source::Markdown);
        assert_eq!(r.markdown.trim(), "body");
        assert!(!r.meta.id.is_empty());
        // looks like a uuid (36 chars with hyphens)
        assert_eq!(r.meta.id.len(), 36);
    }

    #[tokio::test]
    async fn read_empty_file_returns_empty_source() {
        let dir = td();
        let p = write_md(dir.path(), "empty.md", "");
        let r = read_doc(&p).await.unwrap();
        assert_eq!(r.source, Source::Empty);
        assert!(r.html.is_empty());
        assert!(r.markdown.is_empty());
    }

    #[tokio::test]
    async fn read_only_frontmatter_is_empty_source() {
        let dir = td();
        let p = write_md(dir.path(), "fmonly.md", "---\nid: x\n---\n\n");
        let r = read_doc(&p).await.unwrap();
        assert_eq!(r.source, Source::Empty);
    }

    #[tokio::test]
    async fn write_then_read_uses_sidecar_html() {
        let dir = td();
        let p = dir.path().join("doc.md");
        let payload = DocPayload {
            html: "<p>rich <strong>html</strong></p>".into(),
            markdown: "rich **html**".into(),
            meta: DocMeta {
                id: "doc-1".into(),
                title: Some("Doc 1".into()),
                ..DocMeta::new("doc-1")
            },
            extras: Some(serde_json::json!({"databases": {"d1": {"rows": []}}})),
        };
        write_doc(&p, &payload).await.unwrap();

        let r = read_doc(&p).await.unwrap();
        assert_eq!(r.source, Source::Sidecar);
        assert_eq!(r.html, "<p>rich <strong>html</strong></p>");
        assert_eq!(r.markdown.trim(), "rich **html**");
        assert_eq!(r.meta.id, "doc-1");
        assert_eq!(r.meta.title.as_deref(), Some("Doc 1"));
        assert_eq!(
            r.extras.unwrap()["databases"]["d1"]["rows"],
            serde_json::json!([])
        );
    }

    #[tokio::test]
    async fn external_edit_invalidates_sidecar() {
        let dir = td();
        let p = dir.path().join("doc.md");
        let payload = DocPayload {
            html: "<p>old</p>".into(),
            markdown: "old".into(),
            meta: DocMeta::new("doc-1"),
            extras: None,
        };
        write_doc(&p, &payload).await.unwrap();
        // Simulate external edit: rewrite the .md so its hash no longer matches sidecar.
        std::fs::write(&p, "---\nid: doc-1\n---\n\n# Edited externally\n").unwrap();

        let r = read_doc(&p).await.unwrap();
        assert_eq!(r.source, Source::Markdown);
        assert!(r.html.contains("<h1>Edited externally</h1>"));
    }

    #[tokio::test]
    async fn corrupt_sidecar_is_treated_as_absent() {
        let dir = td();
        let p = dir.path().join("doc.md");
        std::fs::write(&p, "---\nid: x\n---\n\nbody\n").unwrap();
        std::fs::write(sidecar_path_for(&p), b"not json {{").unwrap();

        let r = read_doc(&p).await.unwrap();
        assert_eq!(r.source, Source::Markdown);
    }

    #[tokio::test]
    async fn write_doc_overwrites_existing_pair() {
        let dir = td();
        let p = dir.path().join("doc.md");

        write_doc(
            &p,
            &DocPayload {
                html: "<p>v1</p>".into(),
                markdown: "v1".into(),
                meta: DocMeta::new("doc-1"),
                extras: None,
            },
        )
        .await
        .unwrap();

        write_doc(
            &p,
            &DocPayload {
                html: "<p>v2</p>".into(),
                markdown: "v2".into(),
                meta: DocMeta::new("doc-1"),
                extras: None,
            },
        )
        .await
        .unwrap();

        let md = std::fs::read_to_string(&p).unwrap();
        assert!(md.contains("v2"));
        assert!(!md.contains("v1"));

        let side_bytes = std::fs::read(sidecar_path_for(&p)).unwrap();
        let side: SidecarFile = serde_json::from_slice(&side_bytes).unwrap();
        assert_eq!(side.html, "<p>v2</p>");
        assert_eq!(side.markdown_hash, hash_markdown(&md));
    }

    #[tokio::test]
    async fn write_doc_rejects_empty_id() {
        let dir = td();
        let p = dir.path().join("doc.md");
        let r = write_doc(
            &p,
            &DocPayload {
                html: "<p></p>".into(),
                markdown: "".into(),
                meta: DocMeta::new(""),
                extras: None,
            },
        )
        .await;
        assert!(matches!(r, Err(Error::MissingId)));
    }

    #[tokio::test]
    async fn write_doc_atomic_no_temp_files_left() {
        let dir = td();
        let p = dir.path().join("doc.md");
        write_doc(
            &p,
            &DocPayload {
                html: "<p>v1</p>".into(),
                markdown: "v1".into(),
                meta: DocMeta::new("doc-1"),
                extras: None,
            },
        )
        .await
        .unwrap();
        for entry in std::fs::read_dir(dir.path()).unwrap() {
            let name = entry.unwrap().file_name().into_string().unwrap();
            assert!(
                !name.contains(".tmp-"),
                "leaked tmp file in dir: {name}"
            );
        }
    }

    #[tokio::test]
    async fn round_trip_preserves_extras_and_unknown_meta_keys() {
        let dir = td();
        let p = dir.path().join("doc.md");
        let mut meta = DocMeta::new("doc-1");
        meta.title = Some("Hello".into());
        meta.extras
            .insert("custom_field".into(), serde_json::json!("yes"));

        write_doc(
            &p,
            &DocPayload {
                html: "<p>x</p>".into(),
                markdown: "x".into(),
                meta: meta.clone(),
                extras: Some(serde_json::json!({"k": 1})),
            },
        )
        .await
        .unwrap();

        let r = read_doc(&p).await.unwrap();
        assert_eq!(r.source, Source::Sidecar);
        assert_eq!(r.meta.title.as_deref(), Some("Hello"));
        assert_eq!(
            r.meta.extras.get("custom_field"),
            Some(&serde_json::json!("yes"))
        );
        assert_eq!(r.extras, Some(serde_json::json!({"k": 1})));
    }

    // ---- markdown_to_html ----

    #[test]
    fn markdown_to_html_handles_tables() {
        let html = markdown_to_html("|a|b|\n|-|-|\n|1|2|\n");
        assert!(html.contains("<table>"));
        assert!(html.contains("<td>1</td>"));
    }

    #[test]
    fn markdown_to_html_empty_string() {
        assert_eq!(markdown_to_html(""), "");
        assert_eq!(markdown_to_html("   \n  "), "");
    }

    // ---- date formatter ----

    #[test]
    fn iso_formatter_epoch() {
        assert_eq!(format_unix_seconds_utc(0), "1970-01-01T00:00:00Z");
    }

    #[test]
    fn iso_formatter_known_date() {
        // 2026-04-29 00:00:00 UTC = 1_777_420_800 (verified via `date -u -j -f
        // "%Y-%m-%d %H:%M:%S" "2026-04-29 00:00:00" +%s` on macOS).
        assert_eq!(
            format_unix_seconds_utc(1_777_420_800),
            "2026-04-29T00:00:00Z"
        );
        // Mid-day, leap year boundary 2024-02-29:
        assert_eq!(
            format_unix_seconds_utc(1_709_208_000),
            "2024-02-29T12:00:00Z"
        );
    }
}
