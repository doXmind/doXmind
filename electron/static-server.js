"use strict";

/**
 * Tiny in-process static server for the Next.js static export (`./out`).
 *
 * The export emits ABSOLUTE asset URLs (`/_next/static/...`), so loading it
 * over `file://` 404s on every chunk — the renderer must run at an http
 * origin. Serving from `http://127.0.0.1:<port>` also makes the page origin
 * match the sidecar's CORS allowlist (`^https?://(localhost|127.0.0.1)...$`)
 * for free, so no server change is needed.
 *
 * Pure Node (no `electron` import) so it can be exercised headlessly by
 * scripts/electron-smoke.mjs.
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve a request path to a file on disk, mirroring Next's static-export
 * routing: exact file -> `<dir>/index.html` -> `<path>.html` -> nearest
 * ancestor `index.html` (the optional catch-all `/editor/[[...fileId]]`
 * lands on `out/editor/index.html` for any `/editor/<uuid>/`) -> root index.
 */
function resolveFile(outDir, urlPath) {
  let pathname;
  try {
    pathname = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch {
    pathname = urlPath.split("?")[0];
  }
  const segments = pathname.split("/").filter((s) => s && s !== "." && s !== "..");
  const base = path.join(outDir, ...segments);

  if (isFile(base)) return base;
  if (isFile(path.join(base, "index.html"))) return path.join(base, "index.html");
  if (isFile(`${base}.html`)) return `${base}.html`;

  for (let i = segments.length - 1; i >= 0; i--) {
    const candidate = path.join(outDir, ...segments.slice(0, i), "index.html");
    if (isFile(candidate)) return candidate;
  }

  const rootIndex = path.join(outDir, "index.html");
  return isFile(rootIndex) ? rootIndex : null;
}

function startStaticServer(outDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const file = resolveFile(outDir, req.url || "/");
      if (!file) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
      res.setHeader("Content-Type", type);
      // Hashed `/_next/` assets are immutable; HTML must always revalidate.
      if (file.includes(`${path.sep}_next${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        res.setHeader("Cache-Control", "no-cache");
      }
      fs.createReadStream(file)
        .on("error", () => {
          res.statusCode = 500;
          res.end("Read error");
        })
        .pipe(res);
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

module.exports = { startStaticServer, resolveFile };
