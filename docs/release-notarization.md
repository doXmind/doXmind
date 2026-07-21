# macOS release signing and notarization

The public macOS package uses the Electron release shell. `electron-builder`
signs the app, then `electron/notarize.js` submits the signed bundle with
`notarytool` before the DMG and Squirrel update ZIP are created.

## Local release machine

Keep the Developer ID Application certificate in the login keychain. Store the
notarization credentials in a keychain profile once:

```bash
xcrun notarytool store-credentials "doxmind-notary" \
  --apple-id "<Apple ID>" \
  --team-id "46KF5Z549N" \
  --password "<Apple app-specific password>"
```

The hook uses the `doxmind-notary` profile by default. Set
`DOXMIND_NOTARY_PROFILE` only when using a different profile name.

Build a signed, notarized package without publishing it:

```bash
python3.12 -m venv server/.venv
server/.venv/bin/python -m pip install --upgrade pip
server/.venv/bin/python -m pip install -r server/requirements.txt pyinstaller
npm ci
npm run dist:electron
```

After the release version and packaged-app checks are complete, provide a
GitHub token that can publish to `doXmind/releases` and run:

```bash
export GH_TOKEN="<token with access to doXmind/releases>"
npm run release:electron
```

`release:electron` uploads Electron's artifacts to a draft GitHub Release. Keep
the release as a draft until the signed app, DMG, update ZIP, and generated
`latest-mac.yml` have been verified.

Only after every publication blocker in
`docs/releases/<version>-checklist.md` is cleared, upload the stable website
alias and publish the draft:

```bash
VERSION="$(node -p "require('./package.json').version")"
CHECKLIST="docs/releases/${VERSION}-checklist.md"
NOTES="docs/releases/${VERSION}.md"
grep -qx 'Status: READY TO PUBLISH' "${CHECKLIST}"
! grep -Eq 'Pending release validation|^- \[ \]' "${CHECKLIST}"
! grep -Eq 'Pending release validation|Not yet (designated|recorded)' "${NOTES}"
cp "dist-electron/doXmind-${VERSION}-arm64.dmg" \
  "dist-electron/doXmind-mac-arm64.dmg"
gh release upload "v${VERSION}" "dist-electron/doXmind-mac-arm64.dmg" \
  --repo doXmind/releases \
  --clobber
gh release edit "v${VERSION}" \
  --repo doXmind/releases \
  --notes-file "${NOTES}" \
  --draft=false \
  --latest \
  --target main
```

Publishing the draft immediately exposes it to the existing automatic-update
feed. Do not run the final `gh release edit` command for a candidate build.

## CI or explicit environment credentials

The notarization hook also accepts credentials through the environment:

```bash
export APPLE_ID="<Apple ID>"
export APPLE_APP_SPECIFIC_PASSWORD="<Apple app-specific password>"
export APPLE_TEAM_ID="46KF5Z549N"
```

CI additionally needs `CSC_LINK` and `CSC_KEY_PASSWORD` for the Developer ID
certificate, plus `RELEASES_TOKEN` for the workflow's cross-repository upload.

Never commit tokens, certificates, or app-specific passwords. Prefer the local
keychain profile when building on the release machine, and revoke any credential
that has been exposed outside its intended secret store.
