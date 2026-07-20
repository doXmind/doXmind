import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createUpdateState } = require("../../../electron/update-state.js") as {
  createUpdateState: (version: string) => {
    snapshot: () => {
      status: string;
      currentVersion: string;
      availableVersion: string | null;
      error: string | null;
      lastCheckedAt: string | null;
    };
    apply: (event: string, payload?: Record<string, unknown>) => unknown;
  };
};

describe("auto-update state machine", () => {
  it("starts idle with the running version", () => {
    const s = createUpdateState("1.7.5");
    expect(s.snapshot()).toMatchObject({
      status: "idle",
      currentVersion: "1.7.5",
      availableVersion: null,
    });
  });

  it("walks the happy path: checking → downloading → downloaded", () => {
    const s = createUpdateState("1.7.5");
    s.apply("checking");
    expect(s.snapshot().status).toBe("checking");
    s.apply("available");
    expect(s.snapshot().status).toBe("downloading");
    s.apply("downloaded", { version: "1.7.6" });
    expect(s.snapshot()).toMatchObject({ status: "downloaded", availableVersion: "1.7.6" });
  });

  it("records up-to-date with a checked timestamp", () => {
    const s = createUpdateState("1.7.5");
    s.apply("checking");
    s.apply("not-available", { at: "2026-07-19T00:00:00Z" });
    expect(s.snapshot()).toMatchObject({
      status: "up-to-date",
      lastCheckedAt: "2026-07-19T00:00:00Z",
    });
  });

  it("keeps a staged update sticky across later checks and errors", () => {
    const s = createUpdateState("1.7.5");
    s.apply("downloaded", { version: "1.7.6" });
    expect(s.apply("checking")).toBeNull();
    expect(s.apply("error", { message: "offline" })).toBeNull();
    expect(s.snapshot()).toMatchObject({ status: "downloaded", availableVersion: "1.7.6" });
  });

  it("stores the error message and recovers on the next check", () => {
    const s = createUpdateState("1.7.5");
    s.apply("error", { message: "rate limited" });
    expect(s.snapshot()).toMatchObject({ status: "error", error: "rate limited" });
    s.apply("checking");
    expect(s.snapshot()).toMatchObject({ status: "checking", error: null });
  });

  it("ignores unknown events", () => {
    const s = createUpdateState("1.7.5");
    expect(s.apply("bogus")).toBeNull();
    expect(s.snapshot().status).toBe("idle");
  });
});
