import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { isWorkspaceCommand } = require("../../../electron/workspace-proxy.js") as {
  isWorkspaceCommand: (command: string) => boolean;
};

describe("Electron workspace proxy attachment recovery", () => {
  it("allows both zero-write attachment recovery commands", () => {
    expect(isWorkspaceCommand("workspace_inspect_attachment")).toBe(true);
    expect(isWorkspaceCommand("workspace_read_attachment_recovery")).toBe(true);
  });
});
