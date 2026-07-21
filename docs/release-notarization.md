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

The build above creates local artifacts only. Before uploading a candidate,
make the fixed-name website DMG from the exact versioned DMG, then create the
machine-readable SHA-256 manifest:

```bash
VERSION="$(node -p "require('./package.json').version")"
cp "dist-electron/doXmind-${VERSION}-arm64.dmg" \
  "dist-electron/doXmind-mac-arm64.dmg"
(
  cd dist-electron
  shasum -a 256 \
    "doXmind-${VERSION}-arm64-mac.zip" \
    "doXmind-${VERSION}-arm64-mac.zip.blockmap" \
    "doXmind-${VERSION}-arm64.dmg" \
    "doXmind-${VERSION}-arm64.dmg.blockmap" \
    "doXmind-mac-arm64.dmg" \
    "latest-mac.yml"
) > "docs/releases/${VERSION}-artifacts.sha256"
node scripts/verify-release-artifacts.mjs \
  dist-electron "docs/releases/${VERSION}-artifacts.sha256" "${VERSION}"
```

Upload those same six files—not a rebuilt package—to a draft release. The
manual `publish=false` workflow performs the same build-and-upload candidate
path with CI signing credentials. A candidate upload may replace an older draft
candidate, so every upload invalidates all earlier hashes, quarantine results,
and approval.

```bash
set -euo pipefail
export GH_TOKEN="<token with access to doXmind/releases>"
TAG="v${VERSION}"
gh release view "${TAG}" --repo doXmind/releases >/dev/null 2>&1 || \
  gh release create "${TAG}" \
    --repo doXmind/releases \
    --draft \
    --title "doXmind ${VERSION}"
test "$(gh release view "${TAG}" --repo doXmind/releases \
  --json isDraft --jq '.isDraft')" = "true"
EXPECTED=(
  "doXmind-${VERSION}-arm64-mac.zip"
  "doXmind-${VERSION}-arm64-mac.zip.blockmap"
  "doXmind-${VERSION}-arm64.dmg"
  "doXmind-${VERSION}-arm64.dmg.blockmap"
  "doXmind-mac-arm64.dmg"
  "latest-mac.yml"
)
while IFS= read -r asset; do
  keep=false
  for expected in "${EXPECTED[@]}"; do
    if test "${asset}" = "${expected}"; then keep=true; break; fi
  done
  if test "${keep}" = "false"; then
    gh release delete-asset "${TAG}" "${asset}" \
      --repo doXmind/releases --yes
  fi
done < <(gh release view "${TAG}" --repo doXmind/releases \
  --json assets --jq '.assets[].name')
ARTIFACTS=()
for expected in "${EXPECTED[@]}"; do
  ARTIFACTS+=("dist-electron/${expected}")
done
gh release upload "${TAG}" "${ARTIFACTS[@]}" \
  --repo doXmind/releases --clobber
```

Download the draft into a clean directory and rerun the verifier against the
committed manifest. Confirm the GitHub asset digest for every file matches its
SHA-256, then perform the packaged-app, legacy recovery, automatic-update ZIP,
and quarantined Finder-install gates. The draft must contain exactly the six
files above; no stale asset may remain.

Record the exact `doXmind-app` source commit, manifest, signed artifact names,
and validation evidence in a follow-up provenance PR. Do not set the checklist
to `READY TO PUBLISH` until that PR and the matching website update are ready.

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
