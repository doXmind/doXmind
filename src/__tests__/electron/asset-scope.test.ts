import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createAssetScope } = require("../../../electron/asset-scope.js") as {
  createAssetScope: () => {
    addRoot: (dirPath: string) => void;
    addRootForFile: (filePath: string) => void;
    allows: (filePath: string) => boolean;
  };
};

describe("asset scope (doxmind-asset:// confinement)", () => {
  let workspace: string;
  let outside: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "doxmind-scope-ws-"));
    outside = mkdtempSync(join(tmpdir(), "doxmind-scope-out-"));
    writeFileSync(join(workspace, "img.png"), "png");
    mkdirSync(join(workspace, "assets"));
    writeFileSync(join(workspace, "assets", "nested.png"), "png");
    writeFileSync(join(outside, "secret.txt"), "secret");
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("denies everything before any root is registered", () => {
    const scope = createAssetScope();
    expect(scope.allows(join(workspace, "img.png"))).toBe(false);
  });

  it("allows files inside a registered root, including nested dirs", () => {
    const scope = createAssetScope();
    scope.addRoot(workspace);
    expect(scope.allows(join(workspace, "img.png"))).toBe(true);
    expect(scope.allows(join(workspace, "assets", "nested.png"))).toBe(true);
  });

  it("denies files outside every registered root", () => {
    const scope = createAssetScope();
    scope.addRoot(workspace);
    expect(scope.allows(join(outside, "secret.txt"))).toBe(false);
  });

  it("denies traversal that escapes a registered root", () => {
    const scope = createAssetScope();
    scope.addRoot(workspace);
    expect(scope.allows(join(workspace, "..", "..", "etc", "hosts"))).toBe(false);
  });

  it("denies a sibling directory whose name shares the root as a prefix", () => {
    const scope = createAssetScope();
    const sibling = `${workspace}-evil`;
    mkdirSync(sibling);
    writeFileSync(join(sibling, "x.png"), "png");
    try {
      scope.addRoot(workspace);
      expect(scope.allows(join(sibling, "x.png"))).toBe(false);
    } finally {
      rmSync(sibling, { recursive: true, force: true });
    }
  });

  it("denies symlinks that resolve outside the root", () => {
    const scope = createAssetScope();
    scope.addRoot(workspace);
    const link = join(workspace, "escape.txt");
    symlinkSync(join(outside, "secret.txt"), link);
    expect(scope.allows(link)).toBe(false);
  });

  it("denies nonexistent paths", () => {
    const scope = createAssetScope();
    scope.addRoot(workspace);
    expect(scope.allows(join(workspace, "missing.png"))).toBe(false);
  });

  it("registers the parent directory for an opened file", () => {
    const scope = createAssetScope();
    scope.addRootForFile(join(workspace, "img.png"));
    expect(scope.allows(join(workspace, "assets", "nested.png"))).toBe(true);
    expect(scope.allows(join(outside, "secret.txt"))).toBe(false);
  });

  it("ignores junk registrations without opening the scope", () => {
    const scope = createAssetScope();
    scope.addRoot("");
    scope.addRoot(join(workspace, "does-not-exist"));
    scope.addRoot(join(workspace, "img.png")); // a file, not a directory
    expect(scope.allows(join(workspace, "img.png"))).toBe(false);
  });
});
