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

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use gray_matter::{engine::YAML, Matter};
use pulldown_cmark::{
    html as cmark_html, CowStr, Event as CmarkEvent, HeadingLevel, Options as CmarkOptions,
    Parser as CmarkParser, Tag as CmarkTag,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const SIDECAR_VERSION: u32 = 2;

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
    /// Backward-compatible alias for `editor_html`.
    pub html: String,
    pub editor_html: String,
    pub browsing_html: String,
    pub markdown: String,
    pub meta: DocMeta,
    pub extras: Option<serde_json::Value>,
    pub correlation: Option<serde_json::Value>,
    pub source: Source,
    pub source_state: SourceState,
    pub outline: Vec<DocumentOutlineItem>,
    pub browsing_renderer_version: String,
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

/// Precise storage state for the read model.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceState {
    SidecarFresh,
    SidecarStale,
    SidecarMissing,
    SidecarCorrupt,
    Empty,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DocumentOutlineItem {
    pub id: String,
    pub depth: u8,
    pub text: String,
}

pub const BROWSING_RENDERER_VERSION: &str = "browsing-html/v1";

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
    let events = wrap_raw_html_blocks(parser);
    let mut html = String::with_capacity(body.len());
    cmark_html::push_html(&mut html, events.into_iter());
    html
}

/// Wrap each raw-HTML block in a `<div data-raw-html="…">` sentinel so the
/// editor imports it as a single rawHtml atom node (preserved byte-identical
/// by source preservation) instead of flattening it into images/links. Block
/// raw HTML arrives as a run of consecutive `Event::Html`; inline HTML
/// (`Event::InlineHtml`) is left untouched. The original markup is stored,
/// HTML-attribute-escaped, in the attribute. See `src/extensions/raw-html.ts`.
/// Raw-HTML blocks owned by other editor blocks, which must pass through
/// untouched: HTML-comment placeholders (pdf-block / excel-block / database),
/// `<details>` (toggle), and `<div data-column(s)>` (columns).
fn is_claimed_raw_html(raw: &str) -> bool {
    let head = raw.trim_start();
    let lower = head.to_ascii_lowercase();
    head.starts_with("<!--")
        || head.starts_with("</") // structural closing tag (e.g. columns/toggle close)
        || lower.starts_with("<details")
        || lower.starts_with("<pre") // fenced code block — a CodeBlock node, not raw HTML
        || raw.contains("data-column")
        // Any editor-owned node marker (task lists, etc.) is claimed by its own
        // parseHTML and must not be swallowed as a rawHtml passthrough.
        || raw.contains("data-type=")
}

fn wrap_raw_html_blocks<'a>(
    parser: impl Iterator<Item = CmarkEvent<'a>>,
) -> Vec<CmarkEvent<'a>> {
    let mut out: Vec<CmarkEvent<'a>> = Vec::new();
    let mut buffer = String::new();
    let flush = |buffer: &mut String, out: &mut Vec<CmarkEvent<'a>>| {
        if buffer.is_empty() {
            return;
        }
        let raw = buffer.trim_end_matches('\n');
        if is_claimed_raw_html(raw) {
            // Owned by another block (comment placeholders, toggle, columns) —
            // pass through verbatim so those importers still see it.
            out.push(CmarkEvent::Html(CowStr::Boxed(
                buffer.clone().into_boxed_str(),
            )));
            buffer.clear();
            return;
        }
        let escaped = raw
            .replace('&', "&amp;")
            .replace('"', "&quot;")
            .replace('<', "&lt;")
            .replace('>', "&gt;");
        let sentinel = format!("<div data-raw-html=\"{escaped}\" data-type=\"raw-html\"></div>\n");
        out.push(CmarkEvent::Html(CowStr::Boxed(sentinel.into_boxed_str())));
        buffer.clear();
    };
    for event in parser {
        match event {
            CmarkEvent::Html(text) => buffer.push_str(&text),
            other => {
                flush(&mut buffer, &mut out);
                out.push(other);
            }
        }
    }
    flush(&mut buffer, &mut out);
    out
}

#[derive(Clone, Debug, PartialEq)]
pub struct BrowsingRender {
    pub html: String,
    pub outline: Vec<DocumentOutlineItem>,
    pub renderer_version: String,
}

/// Render the current Markdown body for the Browsing Runtime.
///
/// This deliberately does not use Sidecar HTML. Raw HTML events are dropped so
/// the output can be injected as a static read view without executing scripts or
/// event handler attributes. Later slices can deepen Custom Block placeholders
/// without changing the read-model contract.
pub fn render_browsing_markdown(body: &str) -> BrowsingRender {
    if body.trim().is_empty() {
        return BrowsingRender {
            html: String::new(),
            outline: Vec::new(),
            renderer_version: BROWSING_RENDERER_VERSION.to_string(),
        };
    }

    let outline = extract_outline(body);
    let mut heading_index = 0usize;
    let events = markdown_parser(body).filter_map(|event| match event {
        CmarkEvent::Start(CmarkTag::Heading {
            level,
            id: _,
            classes,
            attrs,
        }) => {
            let id = outline.get(heading_index).map(|item| item.id.clone());
            heading_index += 1;
            Some(CmarkEvent::Start(CmarkTag::Heading {
                level,
                id: id.map(|id| CowStr::Boxed(id.into_boxed_str())),
                classes,
                attrs,
            }))
        }
        CmarkEvent::Html(_) | CmarkEvent::InlineHtml(_) => None,
        other => Some(other),
    });

    let mut html = String::with_capacity(body.len());
    cmark_html::push_html(&mut html, events);
    BrowsingRender {
        html,
        outline,
        renderer_version: BROWSING_RENDERER_VERSION.to_string(),
    }
}

fn markdown_parser(body: &str) -> CmarkParser<'_> {
    let mut opts = CmarkOptions::empty();
    opts.insert(CmarkOptions::ENABLE_TABLES);
    opts.insert(CmarkOptions::ENABLE_STRIKETHROUGH);
    opts.insert(CmarkOptions::ENABLE_TASKLISTS);
    opts.insert(CmarkOptions::ENABLE_HEADING_ATTRIBUTES);
    CmarkParser::new_ext(body, opts)
}

fn extract_outline(body: &str) -> Vec<DocumentOutlineItem> {
    #[derive(Default)]
    struct PendingHeading {
        depth: u8,
        explicit_id: Option<String>,
        text: String,
    }

    let mut outline = Vec::new();
    let mut seen_ids: HashMap<String, usize> = HashMap::new();
    let mut current: Option<PendingHeading> = None;

    for event in markdown_parser(body) {
        match event {
            CmarkEvent::Start(CmarkTag::Heading { level, id, .. }) => {
                current = Some(PendingHeading {
                    depth: heading_depth(level),
                    explicit_id: id
                        .map(|id| id.to_string())
                        .filter(|id| !id.trim().is_empty()),
                    text: String::new(),
                });
            }
            CmarkEvent::Text(text)
            | CmarkEvent::Code(text)
            | CmarkEvent::InlineMath(text)
            | CmarkEvent::DisplayMath(text) => {
                if let Some(heading) = current.as_mut() {
                    heading.text.push_str(&text);
                }
            }
            CmarkEvent::End(pulldown_cmark::TagEnd::Heading(_)) => {
                if let Some(heading) = current.take() {
                    let text = heading.text.trim().to_string();
                    let base_id = heading
                        .explicit_id
                        .unwrap_or_else(|| slugify_heading(&text));
                    let id = unique_id(base_id, &mut seen_ids);
                    outline.push(DocumentOutlineItem {
                        id,
                        depth: heading.depth,
                        text,
                    });
                }
            }
            _ => {}
        }
    }

    outline
}

fn heading_depth(level: HeadingLevel) -> u8 {
    match level {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

fn slugify_heading(text: &str) -> String {
    let mut slug = String::new();
    let mut last_was_dash = false;

    for ch in text.chars().flat_map(char::to_lowercase) {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            last_was_dash = false;
        } else if (ch.is_whitespace() || ch == '-' || ch == '_')
            && !slug.is_empty()
            && !last_was_dash
        {
            slug.push('-');
            last_was_dash = true;
        }
    }

    while slug.ends_with('-') {
        slug.pop();
    }

    if slug.is_empty() {
        "section".to_string()
    } else {
        slug
    }
}

fn unique_id(base: String, seen_ids: &mut HashMap<String, usize>) -> String {
    let count = seen_ids.entry(base.clone()).or_insert(0);
    *count += 1;
    if *count == 1 {
        base
    } else {
        format!("{base}-{}", *count)
    }
}

/// Read a `.md` file plus optional sibling sidecar; return what the editor
/// should display.
pub async fn read_doc(md_path: impl AsRef<Path>) -> Result<ReadResult> {
    let md_path = md_path.as_ref();
    let raw = tokio::fs::read_to_string(md_path)
        .await
        .map_err(|e| Error::ReadFailed(md_path.to_path_buf(), e))?;

    let (mut meta, body) = parse_frontmatter(&raw)?;

    let current_hash = hash_markdown(&raw);
    let sidecar_path = sidecar_path_for(md_path);

    let browsing = render_browsing_markdown(&body);

    match read_sidecar(&sidecar_path).await? {
        SidecarRead::Loaded(side)
            if side.version == SIDECAR_VERSION && side.markdown_hash == current_hash =>
        {
            // Trust the sidecar id over a missing/mismatched frontmatter id —
            // the sidecar was written by us and is authoritative for this pairing.
            if meta.id != side.id {
                meta.id = side.id.clone();
            }
            let editor_html = side.html;
            return Ok(ReadResult {
                html: editor_html.clone(),
                editor_html,
                browsing_html: browsing.html,
                markdown: body,
                meta,
                extras: side.extras,
                correlation: None,
                source: Source::Sidecar,
                source_state: SourceState::SidecarFresh,
                outline: browsing.outline,
                browsing_renderer_version: browsing.renderer_version,
            });
        }
        SidecarRead::Loaded(_) => {
            let editor_html = markdown_to_html(&body);
            let is_empty = browsing.html.is_empty();
            return Ok(ReadResult {
                html: editor_html.clone(),
                editor_html,
                browsing_html: browsing.html,
                markdown: if body.trim().is_empty() {
                    String::new()
                } else {
                    body
                },
                meta,
                extras: None,
                correlation: None,
                source: if is_empty {
                    Source::Empty
                } else {
                    Source::Markdown
                },
                source_state: if is_empty {
                    SourceState::Empty
                } else {
                    SourceState::SidecarStale
                },
                outline: browsing.outline,
                browsing_renderer_version: browsing.renderer_version,
            });
        }
        SidecarRead::Corrupt => {
            let editor_html = markdown_to_html(&body);
            let is_empty = browsing.html.is_empty();
            return Ok(ReadResult {
                html: editor_html.clone(),
                editor_html,
                browsing_html: browsing.html,
                markdown: if body.trim().is_empty() {
                    String::new()
                } else {
                    body
                },
                meta,
                extras: None,
                correlation: None,
                source: if is_empty {
                    Source::Empty
                } else {
                    Source::Markdown
                },
                source_state: if is_empty {
                    SourceState::Empty
                } else {
                    SourceState::SidecarCorrupt
                },
                outline: browsing.outline,
                browsing_renderer_version: browsing.renderer_version,
            });
        }
        SidecarRead::Missing => {}
    }

    if body.trim().is_empty() {
        return Ok(ReadResult {
            html: String::new(),
            editor_html: String::new(),
            browsing_html: String::new(),
            markdown: String::new(),
            meta,
            extras: None,
            correlation: None,
            source: Source::Empty,
            source_state: SourceState::Empty,
            outline: Vec::new(),
            browsing_renderer_version: BROWSING_RENDERER_VERSION.to_string(),
        });
    }

    let html = markdown_to_html(&body);
    Ok(ReadResult {
        html: html.clone(),
        editor_html: html,
        browsing_html: browsing.html,
        markdown: body,
        meta,
        extras: None,
        correlation: None,
        source: Source::Markdown,
        source_state: SourceState::SidecarMissing,
        outline: browsing.outline,
        browsing_renderer_version: browsing.renderer_version,
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
    let sidecar_json = serde_json::to_vec_pretty(&sidecar).map_err(Error::SidecarSerialize)?;
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
            let json: serde_json::Value = pod.deserialize().map_err(Error::FrontmatterParse)?;
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
    serde_json::from_value(serde_json::Value::Object(map))
        .unwrap_or_else(|_| DocMeta::new(new_id()))
}

fn build_md_with_frontmatter(meta: &DocMeta, body: &str) -> Result<String> {
    let yaml = serde_yaml::to_string(meta).map_err(Error::FrontmatterSerialize)?;
    let yaml = yaml.trim_end_matches('\n');
    // Always write a trailing newline after the body for POSIX-friendliness.
    let trimmed_body = body.trim_end_matches('\n');
    Ok(format!("---\n{yaml}\n---\n\n{trimmed_body}\n"))
}

enum SidecarRead {
    Missing,
    Corrupt,
    Loaded(SidecarFile),
}

async fn read_sidecar(path: &Path) -> Result<SidecarRead> {
    match tokio::fs::read(path).await {
        Ok(bytes) => match serde_json::from_slice::<SidecarFile>(&bytes) {
            Ok(s) => Ok(SidecarRead::Loaded(s)),
            // Corrupt sidecar: treat as absent so reads don't break the user.
            Err(_) => Ok(SidecarRead::Corrupt),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(SidecarRead::Missing),
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

pub fn now_iso8601() -> String {
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
        assert_eq!(r.source_state, SourceState::SidecarMissing);
        assert!(r.html.contains("<h1>Hello</h1>"));
        assert!(r.browsing_html.contains("<h1 id=\"hello\">Hello</h1>"));
        assert_eq!(
            r.outline,
            vec![DocumentOutlineItem {
                id: "hello".into(),
                depth: 1,
                text: "Hello".into(),
            }]
        );
        assert_eq!(r.meta.id, "abc");
        assert_eq!(r.correlation, None);
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
        assert_eq!(r.source_state, SourceState::Empty);
        assert!(r.html.is_empty());
        assert!(r.editor_html.is_empty());
        assert!(r.browsing_html.is_empty());
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
    async fn fresh_sidecar_wins_even_when_markdown_body_is_empty() {
        let dir = td();
        let p = dir.path().join("rich-only.md");
        write_doc(
            &p,
            &DocPayload {
                html: "<div data-type=\"database-block\" data-database-id=\"d1\"></div>".into(),
                markdown: String::new(),
                meta: DocMeta::new("doc-1"),
                extras: Some(serde_json::json!({"databases": {"d1": {"rows": []}}})),
            },
        )
        .await
        .unwrap();

        let r = read_doc(&p).await.unwrap();
        assert_eq!(r.source, Source::Sidecar);
        assert_eq!(r.source_state, SourceState::SidecarFresh);
        assert!(r.html.contains("database-block"));
        assert_eq!(r.html, r.editor_html);
        assert_eq!(
            r.extras.unwrap()["databases"]["d1"]["rows"],
            serde_json::json!([])
        );
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
        assert_eq!(r.source_state, SourceState::SidecarFresh);
        assert_eq!(r.html, "<p>rich <strong>html</strong></p>");
        assert_eq!(r.editor_html, "<p>rich <strong>html</strong></p>");
        assert_eq!(r.browsing_html.trim(), "<p>rich <strong>html</strong></p>");
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
        assert_eq!(r.source_state, SourceState::SidecarStale);
        assert!(r.html.contains("<h1>Edited externally</h1>"));
        assert!(r
            .browsing_html
            .contains("<h1 id=\"edited-externally\">Edited externally</h1>"));
    }

    #[tokio::test]
    async fn corrupt_sidecar_is_treated_as_absent() {
        let dir = td();
        let p = dir.path().join("doc.md");
        std::fs::write(&p, "---\nid: x\n---\n\nbody\n").unwrap();
        std::fs::write(sidecar_path_for(&p), b"not json {{").unwrap();

        let r = read_doc(&p).await.unwrap();
        assert_eq!(r.source, Source::Markdown);
        assert_eq!(r.source_state, SourceState::SidecarCorrupt);
    }

    #[tokio::test]
    async fn browsing_html_is_derived_from_markdown_not_sidecar_html() {
        let dir = td();
        let p = dir.path().join("doc.md");
        write_doc(
            &p,
            &DocPayload {
                html: "<h1>Editor Only</h1>".into(),
                markdown: "# Markdown Source".into(),
                meta: DocMeta::new("doc-1"),
                extras: None,
            },
        )
        .await
        .unwrap();

        let r = read_doc(&p).await.unwrap();
        assert_eq!(r.source_state, SourceState::SidecarFresh);
        assert_eq!(r.editor_html, "<h1>Editor Only</h1>");
        assert!(r
            .browsing_html
            .contains("<h1 id=\"markdown-source\">Markdown Source</h1>"));
        assert!(!r.browsing_html.contains("Editor Only"));
    }

    #[tokio::test]
    async fn browsing_renderer_strips_raw_html_and_uniquifies_outline_ids() {
        let rendered = render_browsing_markdown(
            "# Intro\n\n<script>alert(1)</script>\n\n## Intro\n\n# Intro!\n",
        );

        assert!(!rendered.html.contains("<script>"));
        assert!(rendered.html.contains("<h1 id=\"intro\">Intro</h1>"));
        assert!(rendered.html.contains("<h2 id=\"intro-2\">Intro</h2>"));
        assert!(rendered.html.contains("<h1 id=\"intro-3\">Intro!</h1>"));
        assert_eq!(
            rendered.outline,
            vec![
                DocumentOutlineItem {
                    id: "intro".into(),
                    depth: 1,
                    text: "Intro".into(),
                },
                DocumentOutlineItem {
                    id: "intro-2".into(),
                    depth: 2,
                    text: "Intro".into(),
                },
                DocumentOutlineItem {
                    id: "intro-3".into(),
                    depth: 1,
                    text: "Intro!".into(),
                },
            ]
        );
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
            assert!(!name.contains(".tmp-"), "leaked tmp file in dir: {name}");
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

    #[test]
    fn markdown_to_html_wraps_raw_html_block_in_sentinel() {
        let html = markdown_to_html("Intro\n\n<div align=\"center\">\n  <img src=\"x.png\">\n</div>\n\nAfter\n");
        // The raw-HTML block becomes a single sentinel div carrying the escaped
        // original markup; the surrounding paragraphs are untouched.
        assert!(html.contains("data-raw-html=\""), "expected sentinel: {html}");
        assert!(html.contains("&lt;div align=&quot;center&quot;&gt;"), "escaped markup: {html}");
        assert!(html.contains("<p>Intro</p>"));
        assert!(html.contains("<p>After</p>"));
        // Exactly one sentinel for one raw-HTML block.
        assert_eq!(html.matches("data-raw-html=").count(), 1);
    }

    #[test]
    fn markdown_to_html_leaves_plain_markdown_without_sentinel() {
        let html = markdown_to_html("# Title\n\nA paragraph with *emphasis*.\n");
        assert!(!html.contains("data-raw-html"));
    }

    #[test]
    fn markdown_to_html_does_not_wrap_claimed_raw_html() {
        // Comment placeholders (pdf/excel/database), toggle, and columns are
        // owned by other blocks and must pass through unwrapped.
        let comment = markdown_to_html("<!-- pdf-block id=\"a\" src=\"s.pdf\" -->\n");
        assert!(!comment.contains("data-raw-html"));
        assert!(comment.contains("<!-- pdf-block"));

        let toggle = markdown_to_html("<details>\n<summary>S</summary>\n\nbody\n\n</details>\n");
        assert!(!toggle.contains("data-raw-html"));

        let columns = markdown_to_html("<div data-columns=\"2\">\n\nx\n\n</div>\n");
        assert!(!columns.contains("data-raw-html"));
        assert!(columns.contains("data-columns"));
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
