import * as pdfjs from "pdfjs-dist";

let workerConfigured = false;

export function getPdfjs() {
  if (!workerConfigured) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.mjs",
      import.meta.url
    ).toString();
    workerConfigured = true;
  }

  return pdfjs;
}
