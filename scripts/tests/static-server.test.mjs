import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveFile, startStaticServer } = require("../../electron/static-server.js");

async function withStaticExport(run) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "doxmind-static-"));
  const out = path.join(parent, "out");
  await fs.mkdir(path.join(out, "editor"), { recursive: true });
  await fs.writeFile(path.join(out, "index.html"), "<script>globalThis.booted = true;</script>root");
  await fs.writeFile(path.join(out, "editor", "index.html"), "editor");
  await fs.writeFile(path.join(parent, "secret.txt"), "outside");
  try {
    await run({ out, parent });
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
}

test("static export resolver rejects encoded slash and backslash traversal", async () => {
  await withStaticExport(async ({ out }) => {
    const traversalPaths = [
      "/../secret.txt",
      "/%2e%2e/secret.txt",
      "/%2e%2e%2fsecret.txt",
      "/%2e%2e%5csecret.txt",
      "/..%5Csecret.txt",
    ];

    for (const requestPath of traversalPaths) {
      assert.equal(resolveFile(out, requestPath), null, requestPath);
    }
  });
});

test("static export server never serves or falls back for traversal requests", async () => {
  await withStaticExport(async ({ out }) => {
    const server = await startStaticServer(out);
    try {
      for (const requestPath of ["/%2e%2e%2fsecret.txt", "/%2e%2e%5csecret.txt"]) {
        const response = await fetch(`${server.url}${requestPath}`);
        assert.equal(response.status, 404, requestPath);
        assert.notEqual(await response.text(), "outside", requestPath);
      }
    } finally {
      await server.close();
    }
  });
});

test("static export resolver preserves exact and optional catch-all routes", async () => {
  await withStaticExport(async ({ out }) => {
    assert.equal(resolveFile(out, "/"), path.join(out, "index.html"));
    assert.equal(resolveFile(out, "/editor/page-id/"), path.join(out, "editor", "index.html"));
  });
});

test("static export server applies a local-app content boundary", async () => {
  await withStaticExport(async ({ out }) => {
    const server = await startStaticServer(out);
    try {
      const response = await fetch(`${server.url}/`);
      assert.equal(response.status, 200);
      assert.equal(
        response.headers.get("content-security-policy"),
        `default-src 'self'; script-src 'self' 'sha256-${crypto
          .createHash("sha256")
          .update("globalThis.booted = true;")
          .digest("base64")}'; connect-src 'self'; img-src 'self' data: blob:; ` +
          "font-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; " +
          "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      );
      assert.doesNotMatch(response.headers.get("content-security-policy"), /script-src[^;]*unsafe-inline/);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(response.headers.get("referrer-policy"), "no-referrer");
      assert.equal(response.headers.get("x-frame-options"), "DENY");
      assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
    } finally {
      await server.close();
    }
  });
});
