import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("release configuration", () => {
  const root = process.cwd();
  const builderConfig = readFileSync(join(root, "electron-builder.yml"), "utf8");
  const workflow = readFileSync(join(root, ".github/workflows/release.yml"), "utf8");
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

  it("generates update metadata through a non-uploading provider", () => {
    expect(builderConfig).toContain(
      "publish:\n  provider: generic\n  url: https://github.com/doXmind/releases/releases/latest/download"
    );
  });

  it("keeps every supported build path in non-publishing mode", () => {
    expect(packageJson.scripts["dist:electron"]).toContain("electron-builder --publish never");
    expect(packageJson.scripts["release:electron"]).toBeUndefined();
    expect(workflow).toContain("npx electron-builder --publish never");
    expect(workflow).not.toContain("electron-builder --publish always");
  });

  it("verifies candidate metadata before mutating a GitHub draft", () => {
    const verifyIndex = workflow.indexOf("node scripts/verify-release-artifacts.mjs");
    const firstDraftMutationIndex = workflow.indexOf('gh release create "v${VERSION}"');

    expect(verifyIndex).toBeGreaterThan(-1);
    expect(firstDraftMutationIndex).toBeGreaterThan(-1);
    expect(verifyIndex).toBeLessThan(firstDraftMutationIndex);
  });

  it("publishes only by verifying and editing the existing draft", () => {
    const publishJob = workflow.slice(workflow.indexOf("  publish-existing:"));

    expect(publishJob).toContain('test "${GITHUB_REF}" = "refs/heads/main"');
    expect(publishJob).toContain("node scripts/verify-release-artifacts.mjs");
    expect(publishJob).toContain("gh release edit");
    expect(publishJob).not.toContain("electron-builder");
    expect(publishJob).not.toContain("gh release create");
    expect(publishJob).not.toContain("gh release upload");
  });
});
