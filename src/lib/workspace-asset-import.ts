/**
 * Import an image the user supplied by paste / drop / file-picker into the
 * workspace, next to the document that will reference it.
 *
 * The `.md` is the portable artifact, so the src written into it has to be
 * resolvable by anything that reads the file — `resolveImageSrc`, an external
 * Markdown viewer, a future export. `./assets/<name>` is; the sidecar's
 * `/api/images/<uuid>` URL is not (it is root-relative to an HTTP origin the
 * webview never has), which is why every image path goes through
 * `workspace_import_asset`.
 */

import { useFileStore } from "@/stores/file-store";

const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|svg|avif|bmp|tiff?)$/i;

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
};

/**
 * Clipboard images frequently arrive with an empty name, or one whose trailing
 * `.something` is a version number rather than an extension. The backend keeps
 * whatever name it is given, and a file without an image extension won't be
 * recognised as one, so fall back to the MIME type.
 */
export function assetFilenameFor(file: File): string {
  const name = file.name?.trim() ?? "";
  if (IMAGE_EXTENSION.test(name)) return name;
  const extension = MIME_EXTENSIONS[file.type] ?? ".png";
  return `${name || "pasted-image"}${extension}`;
}

/** Alt text for an imported asset: the filename without its extension. */
export function assetAltTextFor(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

/**
 * Write `file` into the open document's sibling `assets/` folder and return
 * the workspace-relative reference to store in the Markdown.
 *
 * Throws when no document is open — there is nowhere to put the asset, and
 * inventing a path would leave the user's file referencing something that
 * does not exist.
 */
export async function importWorkspaceImageAsset(file: File): Promise<string> {
  const { rootPath, files, currentFileId } = useFileStore.getState();
  const currentFile = files.find((item) => item.id === currentFileId);
  const documentPath = currentFile?.storageHandle?.relPath ?? currentFile?.storageHandle?.path;
  if (!rootPath || !documentPath) {
    throw new Error("Save this document before adding images");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  const result = await invoke<{ path: string }>("workspace_import_asset", {
    root: rootPath,
    documentPath,
    filename: assetFilenameFor(file),
    bytes,
  });
  // Percent-encode each segment: the caller writes this straight into a
  // Markdown image target, where an unescaped space truncates the link. The
  // asset resolver decodes, so the reference still points at the real file.
  return result.path.split("/").map(encodeURIComponent).join("/");
}
