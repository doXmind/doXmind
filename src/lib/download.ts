export function downloadLocalFile(
  data: Blob | Uint8Array,
  fileName: string,
  mimeType: string
): void {
  const blob =
    data instanceof Blob
      ? data
      : new Blob([new Uint8Array(data)], {
          type: mimeType,
        });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
