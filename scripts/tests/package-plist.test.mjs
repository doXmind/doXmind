import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { hardenInfoPlist } = require("../../electron/harden-info-plist.js");

test("the macOS bundle permits only local renderer HTTP and declares no device access", () => {
  const plist = {
    NSAppTransportSecurity: { NSAllowsArbitraryLoads: true },
    NSAudioCaptureUsageDescription: "audio",
    NSBluetoothAlwaysUsageDescription: "bluetooth",
    NSBluetoothPeripheralUsageDescription: "bluetooth",
    NSCameraUsageDescription: "camera",
    NSMicrophoneUsageDescription: "microphone",
    Unrelated: "preserved",
  };

  hardenInfoPlist(plist);

  assert.deepEqual(plist.NSAppTransportSecurity, {
    NSAllowsArbitraryLoads: false,
    NSAllowsLocalNetworking: true,
    NSExceptionDomains: {
      "127.0.0.1": {
        NSIncludesSubdomains: false,
        NSTemporaryExceptionAllowsInsecureHTTPLoads: true,
      },
      localhost: {
        NSIncludesSubdomains: false,
        NSTemporaryExceptionAllowsInsecureHTTPLoads: true,
      },
    },
  });
  assert.equal(plist.NSAudioCaptureUsageDescription, undefined);
  assert.equal(plist.NSBluetoothAlwaysUsageDescription, undefined);
  assert.equal(plist.NSBluetoothPeripheralUsageDescription, undefined);
  assert.equal(plist.NSCameraUsageDescription, undefined);
  assert.equal(plist.NSMicrophoneUsageDescription, undefined);
  assert.equal(plist.Unrelated, "preserved");
});
