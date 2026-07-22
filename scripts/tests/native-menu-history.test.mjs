import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("desktop menus route Undo and Redo to Markdown source history", async () => {
  const electronMenu = await fs.readFile(path.join(repoRoot, "electron/menus.js"), "utf8");

  assert.doesNotMatch(electronMenu, /role:\s*["'](?:undo|redo)["']/);
  assert.match(electronMenu, /emitToFocused\(["']menu:\/\/undo["']/);
  assert.match(electronMenu, /emitToFocused\(["']menu:\/\/redo["']/);
});
