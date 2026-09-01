import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const { ACTIVE_NATIVE_PAGE_SCRIPT } = require("../../electron/local-pdf-export.js");

/**
 * The script is a string handed to `executeJavaScript`, so nothing type-checks it and a
 * broken quote surfaces only as a failed export at run time — reporting that the Page had
 * changed, which names the wrong cause entirely.
 */
test("the injected active-Page script is valid JavaScript", () => {
  assert.doesNotThrow(() => new Function(`return (${ACTIVE_NATIVE_PAGE_SCRIPT})`));
});

test("the injected script picks the focused Page out of a split", () => {
  const dom = new JSDOM(`<!doctype html><body>
    <div data-native-markdown-document data-file-id="left" data-pane-active="false"></div>
    <div data-native-markdown-document data-file-id="right" data-pane-active="true"></div>
  </body>`);
  assert.equal(runScript(dom), "right");
});

test("the injected script finds the single Page when not split", () => {
  const dom = new JSDOM(`<!doctype html><body>
    <div data-native-markdown-document data-file-id="only" data-pane-active="true"></div>
  </body>`);
  assert.equal(runScript(dom), "only");
});

test("the injected script refuses when no Page is marked active", () => {
  const dom = new JSDOM(`<!doctype html><body>
    <div data-native-markdown-document data-file-id="left" data-pane-active="false"></div>
  </body>`);
  assert.equal(runScript(dom), null);
});

function runScript(dom) {
  return new Function("document", `return (${ACTIVE_NATIVE_PAGE_SCRIPT})`)(dom.window.document);
}
