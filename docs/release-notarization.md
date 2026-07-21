# macOS release signing and notarization

The public macOS package uses the Electron release shell. `electron-builder`
signs the app, then `electron/notarize.js` submits the signed bundle with
`notarytool` before the DMG and Squirrel update ZIP are created.

The generic provider in `electron-builder.yml` is metadata-only: it makes the
builder emit a fresh `latest-mac.yml` but does not upload artifacts. Candidate
builds always pass `--publish never`; the verified draft upload is a separate
workflow step.

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

The build above creates local artifacts only. The normal candidate path is the
manual release workflow with `publish=false`. It refuses an existing version,
builds and notarizes once, copies the versioned DMG byte-for-byte to the fixed
website name, and creates one draft containing exactly these six assets:

- `doXmind-<version>-arm64-mac.zip`
- `doXmind-<version>-arm64-mac.zip.blockmap`
- `doXmind-<version>-arm64.dmg`
- `doXmind-<version>-arm64.dmg.blockmap`
- `doXmind-mac-arm64.dmg`
- `latest-mac.yml`

If a local signing machine must create the draft instead, first prove that the
version does not already exist. Never use `--clobber` or delete individual
assets to reuse a version:

```bash
set -euo pipefail
export GH_TOKEN="<token with access to doXmind/releases>"
VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"
if gh release view "${TAG}" --repo doXmind/releases >/dev/null 2>&1; then
  echo "${TAG} already exists; choose a new version" >&2
  exit 1
fi
cp "dist-electron/doXmind-${VERSION}-arm64.dmg" \
  "dist-electron/doXmind-mac-arm64.dmg"
cmp "dist-electron/doXmind-${VERSION}-arm64.dmg" \
  "dist-electron/doXmind-mac-arm64.dmg"
LOCAL_MANIFEST="$(mktemp)"
(
  cd dist-electron
  shasum -a 256 \
    "doXmind-${VERSION}-arm64-mac.zip" \
    "doXmind-${VERSION}-arm64-mac.zip.blockmap" \
    "doXmind-${VERSION}-arm64.dmg" \
    "doXmind-${VERSION}-arm64.dmg.blockmap" \
    "doXmind-mac-arm64.dmg" \
    "latest-mac.yml"
) > "${LOCAL_MANIFEST}"
node scripts/verify-release-artifacts.mjs \
  dist-electron "${LOCAL_MANIFEST}" "${VERSION}"
gh release create "${TAG}" \
  "dist-electron/doXmind-${VERSION}-arm64-mac.zip" \
  "dist-electron/doXmind-${VERSION}-arm64-mac.zip.blockmap" \
  "dist-electron/doXmind-${VERSION}-arm64.dmg" \
  "dist-electron/doXmind-${VERSION}-arm64.dmg.blockmap" \
  "dist-electron/doXmind-mac-arm64.dmg" \
  "dist-electron/latest-mac.yml" \
  --repo doXmind/releases \
  --draft \
  --title "doXmind ${VERSION}" \
  --notes-file "docs/releases/${VERSION}.md" \
  --target main
```

Download the draft's exact six assets into a clean directory. Generate the
checksum manifest from those downloaded bytes, then run the repository's
zero-dependency verifier. It requires an exact six-file manifest, verifies every
SHA-256, requires the two DMGs to be byte-identical, and checks that
`latest-mac.yml` has the expected version, URLs, sizes, and SHA-512 values for
both the ZIP and versioned DMG.

```bash
CANDIDATE_DIR="$(mktemp -d)"
gh release download "v${VERSION}" \
  --repo doXmind/releases \
  --dir "${CANDIDATE_DIR}"
(
  cd "${CANDIDATE_DIR}"
  shasum -a 256 \
    "doXmind-${VERSION}-arm64-mac.zip" \
    "doXmind-${VERSION}-arm64-mac.zip.blockmap" \
    "doXmind-${VERSION}-arm64.dmg" \
    "doXmind-${VERSION}-arm64.dmg.blockmap" \
    "doXmind-mac-arm64.dmg" \
    "latest-mac.yml"
) > "docs/releases/${VERSION}-artifacts.sha256"
node scripts/verify-release-artifacts.mjs \
  "${CANDIDATE_DIR}" \
  "docs/releases/${VERSION}-artifacts.sha256" \
  "${VERSION}"
```

Then perform the packaged-app, legacy recovery, automatic-update ZIP, and
quarantined Finder-install gates against that download. Commit the checksum
manifest with the exact `doXmind-app` source commit, signed artifact names, and
validation evidence in the provenance PR.

Any candidate re-upload, even under the same version and even when only one
asset changed, invalidates the manifest, quarantine results, recovery results,
and approval. Start validation again from the newly downloaded six files. Do
not set the checklist to `READY TO PUBLISH` until the provenance PR and matching
website update are ready.

Only after every publication blocker in
`docs/releases/<version>-checklist.md` is cleared and the provenance PR is on
`main`, run the manual release workflow from `main` with `publish=true`.

Publication mode does not build or upload anything. It requires `main`, checks
the `READY TO PUBLISH` gate, confirms the draft has exactly six assets,
downloads them, verifies their SHA-256 plus `latest-mac.yml` size/SHA-512, and
only then changes the existing draft to public/latest. Publishing immediately
exposes the release to the automatic-update feed; never use `publish=true` for
a candidate.

Immediately after publication, verify that the fixed website download resolves
to the new versioned DMG, that the updater offers the new ZIP to the previous
stable version and returns no update to the new version, and that the matching
website boundary/version change is deployed. Record those live checks in the
release validation log.

## CI or explicit environment credentials

The notarization hook also accepts credentials through the environment:

```bash
export APPLE_ID="<Apple ID>"
export APPLE_APP_SPECIFIC_PASSWORD="<Apple app-specific password>"
export APPLE_TEAM_ID="46KF5Z549N"
```

Candidate mode additionally needs `CSC_LINK` and `CSC_KEY_PASSWORD` for the
Developer ID certificate, plus `RELEASES_TOKEN` for the workflow's
cross-repository draft upload. Publication mode needs only `RELEASES_TOKEN` and
consumes the already-verified draft.

Never commit tokens, certificates, or app-specific passwords. Prefer the local
keychain profile when building on the release machine, and revoke any credential
that has been exposed outside its intended secret store.
