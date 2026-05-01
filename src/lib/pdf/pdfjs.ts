import * as pdfjs from "pdfjs-dist";

// PDF.js 5.x calls `Map.prototype.getOrInsertComputed` directly. That method
// is the TC39 "upsert" Stage-3 proposal, only available in Safari 18.4+ /
// Chrome 134+ / Firefox 137+. Tauri's WKWebView on slightly older systems
// throws `getOrInsertComputed is not a function`, so we install a polyfill
// in both the main-thread realm and the dedicated PDF.js worker realm
// (Map.prototype patches don't cross realm boundaries).
const POLYFILL_SRC = `
if (typeof Map !== 'undefined' && !Map.prototype.getOrInsertComputed) {
  Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
    value: function (key, callbackfn) {
      if (this.has(key)) return this.get(key);
      const v = callbackfn(key);
      this.set(key, v);
      return v;
    },
    writable: true,
    configurable: true,
  });
}
if (typeof Map !== 'undefined' && !Map.prototype.getOrInsert) {
  Object.defineProperty(Map.prototype, 'getOrInsert', {
    value: function (key, value) {
      if (this.has(key)) return this.get(key);
      this.set(key, value);
      return value;
    },
    writable: true,
    configurable: true,
  });
}
if (typeof WeakMap !== 'undefined' && !WeakMap.prototype.getOrInsertComputed) {
  Object.defineProperty(WeakMap.prototype, 'getOrInsertComputed', {
    value: function (key, callbackfn) {
      if (this.has(key)) return this.get(key);
      const v = callbackfn(key);
      this.set(key, v);
      return v;
    },
    writable: true,
    configurable: true,
  });
}
`;

let mainThreadPolyfilled = false;
function installMainThreadPolyfill() {
  if (mainThreadPolyfilled) return;

  new Function(POLYFILL_SRC)();
  mainThreadPolyfilled = true;
}

let workerConfigured = false;

export function getPdfjs() {
  installMainThreadPolyfill();

  if (!workerConfigured) {
    // Webpack rewrites this `new URL(...)` into the static asset URL of the
    // bundled worker file. In Next.js dev that comes out as a path-only
    // string like `/_next/static/media/pdf.worker.<hash>.mjs`, which a
    // blob-URL module worker cannot resolve (a blob: realm has no origin
    // to anchor a path-only URL against). Anchor against the page origin.
    const rawWorkerUrl = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();
    const absoluteWorkerUrl = new URL(rawWorkerUrl, window.location.href).toString();

    // Module-worker wrapper: install the polyfill in the worker realm, then
    // dynamically import the real PDF.js worker. Must be a dynamic import,
    // not a static one — static imports are evaluated before any top-level
    // code runs, which would defeat the polyfill ordering.
    const wrapperSrc = `${POLYFILL_SRC}\nimport(${JSON.stringify(absoluteWorkerUrl)});`;
    const blob = new Blob([wrapperSrc], { type: "application/javascript" });
    pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
    workerConfigured = true;
  }

  return pdfjs;
}
