// Mirrors the canonical convention enforced by `crates/sidecar/src/lib.rs`
// `sidecar_path_for` and `services/sidecar_io.py` `sidecar_path_for`. Strips
// `.md` / `.markdown` (case-insensitive); other extensions stay so the sidecar
// never collides with the original basename. Used by ConfirmModal copy to
// surface the hidden companion file ahead of an OS-trash delete.
export function sidecarFilenameFor(documentFilename: string): string {
  const lower = documentFilename.toLowerCase();
  let stem = documentFilename;
  if (lower.endsWith(".md")) {
    stem = documentFilename.slice(0, -3);
  } else if (lower.endsWith(".markdown")) {
    stem = documentFilename.slice(0, -9);
  }
  return `.${stem}.doxmind`;
}
