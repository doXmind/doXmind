# Releasing doXmind

A release is two phases, and the second one never rebuilds. Phase one produces
one immutable signed candidate; phase two verifies those exact bytes and exposes
them. Nothing in phase two may touch an asset, because changing a byte would
invalidate the hashes and the packaged-app validation recorded against that
candidate.

Every release needs, in `docs/releases/`:

| File                         | Written                                    |
| ---------------------------- | ------------------------------------------ |
| `<version>.md`               | before the candidate build (public notes)  |
| `<version>-checklist.md`     | before the candidate build, boxes empty    |
| `<version>-artifacts.sha256` | after the candidate exists, from its bytes |
| `<version>-validation.md`    | after the candidate is verified            |

`package.json` and `package-lock.json` must agree on the version, and it must be
one that has no release yet — the candidate job refuses to replace verified bytes.

## Phase one: build the signed candidate

Two routes produce the same six assets. Pick whichever has working credentials.

### Route A — GitHub Actions

```bash
gh workflow run release.yml -f publish=false --repo doXmind/doXmind-app
```

This needs six repository secrets. The workflow now checks for them first and
names any that are missing, rather than failing ten minutes later inside
electron-builder with `⨯ <workspace> not a file`, which is what an empty
`CSC_LINK` actually reports.

| Secret                        | What it is                                    |
| ----------------------------- | --------------------------------------------- |
| `CSC_LINK`                    | base64 of the Developer ID `.p12`             |
| `CSC_KEY_PASSWORD`            | password for that `.p12`                      |
| `APPLE_ID`                    | Apple account used for notarization           |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password for that account        |
| `APPLE_TEAM_ID`               | Apple Developer team id                       |
| `RELEASES_TOKEN`              | token with write access to `doXmind/releases` |

Set them from a machine that holds the certificate:

```bash
base64 -i /path/to/developer-id.p12 | gh secret set CSC_LINK --repo doXmind/doXmind-app
gh secret set CSC_KEY_PASSWORD --repo doXmind/doXmind-app
gh secret set APPLE_ID --repo doXmind/doXmind-app
gh secret set APPLE_APP_SPECIFIC_PASSWORD --repo doXmind/doXmind-app
gh secret set APPLE_TEAM_ID --repo doXmind/doXmind-app
gh secret set RELEASES_TOKEN --repo doXmind/doXmind-app
```

Each `gh secret set` without a value prompts for it, so the value never lands in
shell history.

### Route B — locally on an Apple Silicon Mac

This is how `1.8.3` was built. It needs no password in the environment:

- a `Developer ID Application` identity in the login keychain, which
  electron-builder discovers on its own — check with
  `security find-identity -v -p codesigning`;
- a stored notarytool profile, default `doxmind-notary`, overridable with
  `DOXMIND_NOTARY_PROFILE`. `electron/notarize.js` prefers `APPLE_ID` +
  `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` when all three are set and
  otherwise falls back to the profile. Create it once with
  `xcrun notarytool store-credentials`, and check it with
  `xcrun notarytool history --keychain-profile doxmind-notary`.

Build from a clean worktree at the exact commit being released, so provenance is
unambiguous:

```bash
git worktree add ../doxmind-candidate-<version> <commit> --detach
cd ../doxmind-candidate-<version>
npm ci
node scripts/build-frontend.mjs
npx electron-builder --publish never
```

Notarization runs in electron-builder's `afterSign` hook so the bundle is
notarized _before_ it is zipped, which is what keeps `latest-mac.yml`'s hashes
correct for auto-update. Setting `CSC_IDENTITY_AUTO_DISCOVERY=false` skips both
signing and notarization — useful to smoke-test packaging, never acceptable for a
candidate.

Then create the draft with exactly six assets, the stable alias DMG among them:

```bash
VERSION=<version>
cp "dist-electron/doXmind-${VERSION}-arm64.dmg" dist-electron/doXmind-mac-arm64.dmg
cd dist-electron && shasum -a 256 \
  "doXmind-${VERSION}-arm64-mac.zip" "doXmind-${VERSION}-arm64-mac.zip.blockmap" \
  "doXmind-${VERSION}-arm64.dmg" "doXmind-${VERSION}-arm64.dmg.blockmap" \
  "doXmind-mac-arm64.dmg" latest-mac.yml > "../docs/releases/${VERSION}-artifacts.sha256"
cd .. && node scripts/verify-release-artifacts.mjs \
  dist-electron "docs/releases/${VERSION}-artifacts.sha256" "${VERSION}"
gh release create "v${VERSION}" dist-electron/doXmind-* dist-electron/latest-mac.yml \
  --repo doXmind/releases --draft --title "doXmind ${VERSION}" \
  --notes-file "docs/releases/${VERSION}.md" --target main
```

## Phase two: verify, then publish

The publish job refuses to run until the checklist says exactly
`Status: READY TO PUBLISH` with no `- [ ]` left, the notes carry no placeholder,
and the SHA-256 manifest is committed. That gate is the point of the process, so
a box is ticked only once its check has actually been run against the downloaded
candidate — never from the source tree, which cannot tell you anything about
Gatekeeper, a notarization ticket, or whether the packaged app launches.

What has to be verified on a Mac, against the downloaded bytes:

- integrity, Developer ID signature, Gatekeeper acceptance, and a stapled
  notarization ticket on both the DMG and the update ZIP;
- bundle version and architecture, and that the packaged runtime carries no
  removed surface;
- packaged Electron GUI acceptance, all 23 checks;
- Page and Attachment recovery leaving Markdown, source Attachments, `.doxmind`,
  `.bak`, `.lock` and `.corrupt-*` byte-identical;
- a signed update from the previous version restarting and cold-launching.

Record the results in `<version>-validation.md`, fill in the provenance table,
commit the manifest, then:

```bash
gh workflow run release.yml -f publish=true --repo doXmind/doXmind-app
```

The website's version label deploys only after the release is public and latest.
