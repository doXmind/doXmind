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

test("no menu accelerator steals a key the command registry lets the user rebind", async () => {
  const menus = await fs.readFile(path.join(repoRoot, "electron/menus.js"), "utf8");
  const commands = await fs.readFile(path.join(repoRoot, "src/lib/commands.ts"), "utf8");

  // Every key the Hotkeys page can reassign, in the menu's spelling.
  const rebindable = new Map();
  for (const match of commands.matchAll(/id:\s*"([^"]+)"[\s\S]*?defaultBinding:\s*("([^"]+)"|null)/g)) {
    if (match[3]) rebindable.set(match[3].replace(/^Mod\+/, "CmdOrCtrl+"), match[1]);
  }
  assert.ok(rebindable.size > 0, "no rebindable commands parsed — the regex has drifted");

  // A main-process accelerator fires before the page sees the event, so an item that
  // registers one owns that key for good and the user's rebinding is dead. Items that
  // opt out with `registerAccelerator: false` still show the shortcut and leave the key
  // to the renderer, which is what makes it rebindable.
  const stolen = [];
  for (const item of menus.matchAll(/\{[^{}]*accelerator:\s*"([^"]+)"[^{}]*\}/g)) {
    const [block, accelerator] = item;
    if (/registerAccelerator:\s*false/.test(block)) continue;
    const command = rebindable.get(accelerator);
    if (command) stolen.push(`${accelerator} (${command})`);
  }

  assert.deepEqual(stolen, []);
});
