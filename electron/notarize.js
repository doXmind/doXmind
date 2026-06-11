"use strict";

/**
 * electron-builder afterSign hook: notarize the signed .app with notarytool,
 * so electron-builder staples and zips the *notarized* bundle (correct
 * latest-mac.yml hashes for auto-update).
 *
 * Two credential sources, picked automatically:
 *   - CI / explicit: APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID env.
 *   - Local: the stored keychain profile (DOXMIND_NOTARY_PROFILE, default
 *     `doxmind-notary`) — no password in the environment.
 *
 * Skips quietly when signing is disabled (CSC_IDENTITY_AUTO_DISCOVERY=false)
 * or on non-mac targets, so unsigned local packs still work.
 */

const { notarize } = require("@electron/notarize");

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") return;
  if (process.env.CSC_IDENTITY_AUTO_DISCOVERY === "false") {
    console.log("[notarize] signing disabled — skipping notarization");
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;
  const appBundleId = context.packager.appInfo.id;

  const hasEnvCreds =
    process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID;

  const common = { tool: "notarytool", appBundleId, appPath };
  const opts = hasEnvCreds
    ? {
        ...common,
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
        teamId: process.env.APPLE_TEAM_ID,
      }
    : { ...common, keychainProfile: process.env.DOXMIND_NOTARY_PROFILE || "doxmind-notary" };

  console.log(
    `[notarize] submitting ${appName}.app via ${hasEnvCreds ? "APPLE_* env" : "keychain profile"}…`
  );
  await notarize(opts);
  console.log("[notarize] done");
};
