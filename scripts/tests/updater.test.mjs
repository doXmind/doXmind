import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Module = require("node:module");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("the desktop boot path never starts an update check", async () => {
  const mainSource = await fs.readFile(path.join(repoRoot, "electron/main.js"), "utf8");
  assert.doesNotMatch(mainSource, /initAutoUpdater|checkForUpdatesInteractive/);

  const menuSource = await fs.readFile(path.join(repoRoot, "electron/menus.js"), "utf8");
  assert.match(menuSource, /Check for Updates/);
  assert.match(menuSource, /checkForUpdatesInteractive/);
});

test("the updater contacts its feed only after an explicit manual check", () => {
  const calls = { feed: 0, check: 0 };
  const listeners = new Map();
  const fakeElectron = {
    app: { isPackaged: true, getVersion: () => "1.0.0" },
    autoUpdater: {
      setFeedURL: () => {
        calls.feed += 1;
      },
      on: (event, handler) => listeners.set(event, handler),
      checkForUpdates: () => {
        calls.check += 1;
      },
      quitAndInstall: () => {},
    },
    dialog: { showMessageBox: () => Promise.resolve({ response: 1 }) },
  };
  const updaterPath = require.resolve("../../electron/updater.js");
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "electron") return fakeElectron;
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[updaterPath];
    const updater = require(updaterPath);
    assert.deepEqual(calls, { feed: 0, check: 0 });

    updater.checkForUpdatesInteractive();
    assert.deepEqual(calls, { feed: 1, check: 1 });
  } finally {
    delete require.cache[updaterPath];
    Module._load = originalLoad;
  }
});
