import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function sourceFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(target) : [target];
    })
  );
  return nested.flat();
}

test("development HTTP listeners are pinned to loopback", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));
  const browserDev = await fs.readFile(path.join(repoRoot, "scripts/dev.mjs"), "utf8");

  assert.equal(packageJson.scripts.dev, "next dev -H 127.0.0.1");
  assert.equal(packageJson.scripts.start, "next start -H 127.0.0.1");
  assert.equal(packageJson.scripts["dev:mobile"], undefined);
  assert.doesNotMatch(browserDev, /0\.0\.0\.0/);
  assert.match(browserDev, /"next"\),\s*"dev",\s*"-H",\s*"127\.0\.0\.1"/);
});

test("desktop packages contain no Python or FastAPI runtime payload", async () => {
  const electronBuilder = await fs.readFile(path.join(repoRoot, "electron-builder.yml"), "utf8");
  const packageJson = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));
  const packageLock = JSON.parse(
    await fs.readFile(path.join(repoRoot, "package-lock.json"), "utf8")
  );
  const filesSection = electronBuilder.match(/^files:\n((?:  - .+\n)+)/m)?.[1] ?? "";
  const packagedFiles = filesSection
    .trim()
    .split("\n")
    .map((line) => line.replace(/^\s*-\s*/, "").replace(/^"|"$/g, ""));

  assert.equal(packagedFiles.includes("electron/**/*"), true);
  assert.equal(packagedFiles.includes("out/**/*"), true);
  assert.equal(packagedFiles.includes("package.json"), true);
  assert.equal(
    packagedFiles.some((entry) => /server|python|fastapi|src-tauri/i.test(entry)),
    false
  );
  assert.doesNotMatch(electronBuilder, /^\s*(?:extraFiles|extraResources):/m);
  assert.match(electronBuilder, /^afterPack: electron\/harden-info-plist\.js$/m);
  assert.equal(
    Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies }).some((name) =>
      name.startsWith("@tauri-apps/")
    ),
    false
  );
  assert.equal(
    Object.keys(packageLock.packages).some((name) => name.startsWith("node_modules/@tauri-apps/")),
    false
  );
});

test("Electron is the only packaged desktop runtime", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));
  const retiredPaths = ["Cargo.toml", "Cargo.lock", "src-tauri", "crates/page-core"];

  for (const relativePath of retiredPaths) {
    await assert.rejects(fs.access(path.join(repoRoot, relativePath)), undefined, relativePath);
  }

  assert.equal(
    Object.keys(packageJson.scripts).some((name) => /tauri|build:desktop|dev:desktop/i.test(name)),
    false
  );

  const workflowDir = path.join(repoRoot, ".github", "workflows");
  const workflows = await Promise.all(
    (await fs.readdir(workflowDir))
      .filter((name) => /\.ya?ml$/i.test(name))
      .map((name) => fs.readFile(path.join(workflowDir, name), "utf8"))
  );
  for (const workflow of workflows) {
    assert.doesNotMatch(workflow, /\btauri\b|rust-toolchain|\bcargo\b/i);
  }
});

test("renderer and main process use the Electron bridge directly", async () => {
  const files = (
    await Promise.all([sourceFiles(path.join(repoRoot, "src")), sourceFiles(path.join(repoRoot, "electron"))])
  )
    .flat()
    .filter((file) => /\.(?:ts|tsx|js|css|json)$/.test(file))
    .filter((file) => !file.includes(`${path.sep}__tests__${path.sep}`));
  const sources = await Promise.all(files.map((file) => fs.readFile(file, "utf8")));

  for (const source of sources) {
    assert.doesNotMatch(
      source,
      /@tauri-apps|__TAURI|src-tauri|data-tauri|is-tauri/i,
      "retired desktop bridge identifier"
    );
  }

  const main = await fs.readFile(path.join(repoRoot, "electron/main.js"), "utf8");
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
});
