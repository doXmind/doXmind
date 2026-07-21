import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyReleaseArtifacts } from "../../../scripts/verify-release-artifacts.mjs";

const VERSION = "1.8.0";

function hash(bytes: Buffer, algorithm: "sha256" | "sha512", encoding: "hex" | "base64") {
  return createHash(algorithm).update(bytes).digest(encoding);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "doxmind-release-artifacts-"));
  const zipName = `doXmind-${VERSION}-arm64-mac.zip`;
  const dmgName = `doXmind-${VERSION}-arm64.dmg`;
  const zip = Buffer.from("signed update zip");
  const dmg = Buffer.from("signed website dmg");
  const files = new Map<string, Buffer>([
    [zipName, zip],
    [`${zipName}.blockmap`, Buffer.from("zip blockmap")],
    [dmgName, dmg],
    [`${dmgName}.blockmap`, Buffer.from("dmg blockmap")],
    ["doXmind-mac-arm64.dmg", dmg],
  ]);
  const metadata = Buffer.from(
    [
      `version: ${VERSION}`,
      "files:",
      `  - url: ${zipName}`,
      `    sha512: ${hash(zip, "sha512", "base64")}`,
      `    size: ${zip.length}`,
      `  - url: ${dmgName}`,
      `    sha512: ${hash(dmg, "sha512", "base64")}`,
      `    size: ${dmg.length}`,
      `path: ${zipName}`,
      `sha512: ${hash(zip, "sha512", "base64")}`,
      "releaseDate: '2026-07-21T00:00:00.000Z'",
      "",
    ].join("\n")
  );
  files.set("latest-mac.yml", metadata);

  for (const [name, bytes] of files) writeFileSync(join(root, name), bytes);
  const manifestPath = join(root, "artifacts.sha256");
  writeFileSync(
    manifestPath,
    [...files].map(([name, bytes]) => `${hash(bytes, "sha256", "hex")}  ${name}`).join("\n") + "\n"
  );
  return { root, manifestPath, dmgName };
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("release artifact verifier", () => {
  it("accepts one exact six-asset candidate with matching updater metadata", () => {
    const built = fixture();
    roots.push(built.root);

    expect(verifyReleaseArtifacts(built.root, built.manifestPath, VERSION)).toHaveLength(6);
  });

  it("rejects a candidate whose verified DMG bytes changed after the manifest", () => {
    const built = fixture();
    roots.push(built.root);
    const dmgPath = join(built.root, built.dmgName);
    writeFileSync(dmgPath, Buffer.concat([readFileSync(dmgPath), Buffer.from("changed")]));

    expect(() => verifyReleaseArtifacts(built.root, built.manifestPath, VERSION)).toThrow(
      `SHA-256 mismatch for ${built.dmgName}`
    );
  });
});
