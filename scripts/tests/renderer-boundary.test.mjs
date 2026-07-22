import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  isExternallyOpenable,
  isTrustedRendererUrl,
  lockDownRendererPermissions,
} = require("../../electron/renderer-boundary.js");

test("desktop commands trust only the exact renderer origin", () => {
  const renderer = "http://127.0.0.1:43127";
  assert.equal(isTrustedRendererUrl(renderer, `${renderer}/editor/?file=Note.md`), true);
  assert.equal(isTrustedRendererUrl(renderer, "http://127.0.0.1:43128/editor/"), false);
  assert.equal(isTrustedRendererUrl(renderer, "http://localhost:43127/editor/"), false);
  assert.equal(isTrustedRendererUrl(renderer, "https://example.com/"), false);
  assert.equal(isTrustedRendererUrl(renderer, "not a url"), false);
});

test("only ordinary web and mail links may leave the desktop window", () => {
  assert.equal(isExternallyOpenable("https://example.com/path"), true);
  assert.equal(isExternallyOpenable("http://example.com/path"), true);
  assert.equal(isExternallyOpenable("mailto:hello@example.com"), true);
  assert.equal(isExternallyOpenable("file:///etc/passwd"), false);
  assert.equal(isExternallyOpenable("javascript:alert(1)"), false);
  assert.equal(isExternallyOpenable("doxmind-asset://local/etc/passwd"), false);
});

test("the renderer session denies browser and device permissions", () => {
  let requestHandler;
  let checkHandler;
  let deviceHandler;
  const targetSession = {
    setPermissionRequestHandler(handler) {
      requestHandler = handler;
    },
    setPermissionCheckHandler(handler) {
      checkHandler = handler;
    },
    setDevicePermissionHandler(handler) {
      deviceHandler = handler;
    },
  };

  lockDownRendererPermissions(targetSession);

  let granted = true;
  requestHandler(null, "media", (allowed) => {
    granted = allowed;
  });
  assert.equal(granted, false);
  assert.equal(checkHandler(null, "geolocation", "http://127.0.0.1:3000"), false);
  assert.equal(deviceHandler({ deviceType: "hid" }), false);
});
