import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("Electron builds use the frontend scrubber without exposing a direct publish script", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));
  assert.equal(packageJson.scripts.build, "next build");
  assert.match(packageJson.scripts["dist:electron"], /^node scripts\/build-frontend\.mjs && /);
  assert.match(packageJson.scripts["dist:electron"], /electron-builder --publish never$/);
  assert.equal(packageJson.scripts["release:electron"], undefined);

  const scrubber = await fs.readFile(path.join(repoRoot, "scripts/build-frontend.mjs"), "utf8");
  assert.match(scrubber, /delete env\.NEXT_PUBLIC_API_URL/);
  assert.match(scrubber, /"run",\s*\n\s*"build"/);

  for (const workflow of ["release.yml", "release-windows.yml"]) {
    const source = await fs.readFile(path.join(repoRoot, ".github/workflows", workflow), "utf8");
    assert.match(source, /Build the renderer \(static export\)\s*\n\s*run: node scripts\/build-frontend\.mjs/);
  }
});
