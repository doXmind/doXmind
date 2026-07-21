#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function digest(bytes, algorithm, encoding) {
  return createHash(algorithm).update(bytes).digest(encoding);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expectedNames(version) {
  return [
    `doXmind-${version}-arm64-mac.zip`,
    `doXmind-${version}-arm64-mac.zip.blockmap`,
    `doXmind-${version}-arm64.dmg`,
    `doXmind-${version}-arm64.dmg.blockmap`,
    "doXmind-mac-arm64.dmg",
    "latest-mac.yml",
  ];
}

function readRegularFile(filePath) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`release artifact is not a regular file: ${filePath}`);
  }
  return fs.readFileSync(filePath);
}

function parseManifest(manifestPath) {
  const entries = new Map();
  const lines = fs.readFileSync(manifestPath, "utf8").split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const match = /^([0-9a-f]{64})  ([^/\\]+)$/.exec(line);
    if (!match) throw new Error(`invalid SHA-256 manifest line: ${line}`);
    if (entries.has(match[2])) throw new Error(`duplicate manifest entry: ${match[2]}`);
    entries.set(match[2], match[1]);
  }
  return entries;
}

function metadataEntry(yaml, fileName) {
  const name = escapeRegExp(fileName);
  const match = new RegExp(
    `^  - url: ${name}\\r?\\n    sha512: ([^\\r\\n]+)\\r?\\n    size: ([0-9]+)$`,
    "m"
  ).exec(yaml);
  if (!match) throw new Error(`latest-mac.yml is missing metadata for ${fileName}`);
  return { sha512: match[1], size: Number(match[2]) };
}

export function verifyReleaseArtifacts(artifactDir, manifestPath, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`invalid release version: ${version}`);

  const expected = expectedNames(version);
  const manifest = parseManifest(manifestPath);
  const manifestNames = [...manifest.keys()].sort();
  const expectedSorted = [...expected].sort();
  if (JSON.stringify(manifestNames) !== JSON.stringify(expectedSorted)) {
    throw new Error(
      `manifest asset set mismatch\nexpected: ${expectedSorted.join(", ")}\nactual: ${manifestNames.join(", ")}`
    );
  }

  const artifacts = new Map();
  for (const name of expected) {
    const bytes = readRegularFile(path.join(artifactDir, name));
    const sha256 = digest(bytes, "sha256", "hex");
    if (sha256 !== manifest.get(name)) throw new Error(`SHA-256 mismatch for ${name}`);
    artifacts.set(name, { bytes, sha256 });
  }

  const dmgName = `doXmind-${version}-arm64.dmg`;
  const aliasName = "doXmind-mac-arm64.dmg";
  if (!artifacts.get(dmgName).bytes.equals(artifacts.get(aliasName).bytes)) {
    throw new Error("stable DMG alias differs from the versioned DMG");
  }

  const zipName = `doXmind-${version}-arm64-mac.zip`;
  const yaml = artifacts.get("latest-mac.yml").bytes.toString("utf8");
  if (!new RegExp(`^version: ${escapeRegExp(version)}$`, "m").test(yaml)) {
    throw new Error(`latest-mac.yml version does not equal ${version}`);
  }

  for (const name of [zipName, dmgName]) {
    const entry = metadataEntry(yaml, name);
    const bytes = artifacts.get(name).bytes;
    if (entry.size !== bytes.length) throw new Error(`latest-mac.yml size mismatch for ${name}`);
    if (entry.sha512 !== digest(bytes, "sha512", "base64")) {
      throw new Error(`latest-mac.yml SHA-512 mismatch for ${name}`);
    }
  }

  const topLevelPath = /^path: ([^\r\n]+)$/m.exec(yaml)?.[1];
  const topLevelSha512 = /^sha512: ([^\r\n]+)$/m.exec(yaml)?.[1];
  const zipSha512 = digest(artifacts.get(zipName).bytes, "sha512", "base64");
  if (topLevelPath !== zipName || topLevelSha512 !== zipSha512) {
    throw new Error("latest-mac.yml top-level update target does not match the ZIP");
  }

  return expected.map((name) => ({ name, sha256: artifacts.get(name).sha256 }));
}

function main() {
  const [artifactDir, manifestPath, version] = process.argv.slice(2);
  if (!artifactDir || !manifestPath || !version) {
    throw new Error(
      "usage: node scripts/verify-release-artifacts.mjs <artifact-dir> <sha256-manifest> <version>"
    );
  }
  const verified = verifyReleaseArtifacts(artifactDir, manifestPath, version);
  for (const item of verified) console.log(`verified ${item.sha256}  ${item.name}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
