use std::path::PathBuf;

use thiserror::Error;

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, Error)]
pub enum Error {
    #[error("read failed: {0}: {1}")]
    ReadFailed(PathBuf, #[source] std::io::Error),

    #[error("write failed: {0}: {1}")]
    WriteFailed(PathBuf, #[source] std::io::Error),

    #[error("frontmatter parse failed: {0}")]
    FrontmatterParse(#[source] serde_json::Error),

    #[error("frontmatter serialize failed: {0}")]
    FrontmatterSerialize(#[source] serde_yaml::Error),

    #[error("sidecar serialize failed: {0}")]
    SidecarSerialize(#[source] serde_json::Error),

    #[error("DocMeta.id is required and must be non-empty")]
    MissingId,
}
