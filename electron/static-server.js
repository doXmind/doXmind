"use strict";

/**
 * Tiny in-process static server for the Next.js static export (`./out`).
 *
 * The export emits ABSOLUTE asset URLs (`/_next/static/...`), so loading it
 * over `file://` 404s on every chunk — the renderer must run at an http
 * origin. The listener binds only to loopback and serves renderer assets; it
 * is not a content backend or child process.
 *
 * Pure Node (no `electron` import) so it can be exercised headlessly by
 * scripts/electron-smoke.mjs.
 */

const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const CONTENT_SECURITY_POLICY_TAIL =
  "connect-src 'self'; img-src 'self' data: blob:; " +
  "font-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; " +
  "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

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

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function contentSecurityPolicy(file) {
  const hashes = new Set();
  if (path.extname(file).toLowerCase() === ".html") {
    const html = fs.readFileSync(file, "utf8");
    const inlineScript = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
    for (const match of html.matchAll(inlineScript)) {
      const digest = crypto.createHash("sha256").update(match[1]).digest("base64");
      hashes.add(`'sha256-${digest}'`);
    }
  }
  const scriptSources = ["'self'", ...hashes].join(" ");
  return `default-src 'self'; script-src ${scriptSources}; ${CONTENT_SECURITY_POLICY_TAIL}`;
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
    return null;
  }
  if (pathname.includes("\0")) return null;

  // Treat both separators as path boundaries even on POSIX. Electron packages
  // run on Windows too, where a decoded `%5C` is a real directory separator.
  const segments = pathname.replaceAll("\\", "/").split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) return null;

  const root = path.resolve(outDir);
  let realRoot;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    return null;
  }

  const safeFile = (candidate) => {
    const resolved = path.resolve(candidate);
    if (!isWithin(root, resolved) || !isFile(resolved)) return null;
    try {
      if (!isWithin(realRoot, fs.realpathSync(resolved))) return null;
    } catch {
      return null;
    }
    return resolved;
  };

  const base = path.join(root, ...segments);

  const exact = safeFile(base);
  if (exact) return exact;
  const directoryIndex = safeFile(path.join(base, "index.html"));
  if (directoryIndex) return directoryIndex;
  const html = safeFile(`${base}.html`);
  if (html) return html;

  for (let i = segments.length - 1; i >= 0; i--) {
    const candidate = safeFile(path.join(root, ...segments.slice(0, i), "index.html"));
    if (candidate) return candidate;
  }

  return safeFile(path.join(root, "index.html"));
}

function startStaticServer(outDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      const file = resolveFile(outDir, req.url || "/");
      if (!file) {
        res.setHeader(
          "Content-Security-Policy",
          `default-src 'self'; script-src 'self'; ${CONTENT_SECURITY_POLICY_TAIL}`
        );
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      res.setHeader("Content-Security-Policy", contentSecurityPolicy(file));
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
