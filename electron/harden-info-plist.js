"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const plist = require("plist");

const DEVICE_USAGE_KEYS = [
  "NSAudioCaptureUsageDescription",
  "NSBluetoothAlwaysUsageDescription",
  "NSBluetoothPeripheralUsageDescription",
  "NSCameraUsageDescription",
  "NSMicrophoneUsageDescription",
];

function hardenInfoPlist(info) {
  const localHttp = {
    NSIncludesSubdomains: false,
    NSTemporaryExceptionAllowsInsecureHTTPLoads: true,
  };
  info.NSAppTransportSecurity = {
    NSAllowsArbitraryLoads: false,
    NSAllowsLocalNetworking: true,
    NSExceptionDomains: {
      "127.0.0.1": { ...localHttp },
      localhost: { ...localHttp },
    },
  };
  for (const key of DEVICE_USAGE_KEYS) delete info[key];
  return info;
}

async function hardenMacBundle(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appName = context.packager.appInfo.productFilename;
  const infoPath = path.join(context.appOutDir, `${appName}.app`, "Contents", "Info.plist");
  const info = plist.parse(await fs.readFile(infoPath, "utf8"));
  await fs.writeFile(infoPath, plist.build(hardenInfoPlist(info)), "utf8");
}

exports.default = hardenMacBundle;
exports.hardenInfoPlist = hardenInfoPlist;
