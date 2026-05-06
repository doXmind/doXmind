import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { isSwitchCacheStillValid } from "@/lib/switch-cache-validation";

describe("isSwitchCacheStillValid", () => {
  const cached = { mtimeNs: "1700000000000000000", size: 1_400_000 };

  it("returns true when stat probe is undefined (HTTP fallback in dev)", async () => {
    const result = await isSwitchCacheStillValid(cached, undefined);
    expect(result).toBe(true);
  });

  it("returns true when stat returns matching (mtime, size)", async () => {
    const probe = vi.fn().mockResolvedValue({ ...cached });
    const result = await isSwitchCacheStillValid(cached, probe);
    expect(result).toBe(true);
    expect(probe).toHaveBeenCalledOnce();
  });

  it("returns false when stat reports a newer mtime — simulates external save", async () => {
    const probe = vi.fn().mockResolvedValue({ mtimeNs: "1800000000000000000", size: cached.size });
    const result = await isSwitchCacheStillValid(cached, probe);
    expect(result).toBe(false);
  });

  it("returns false when stat reports a different size", async () => {
    const probe = vi.fn().mockResolvedValue({ mtimeNs: cached.mtimeNs, size: 9_999_999 });
    const result = await isSwitchCacheStillValid(cached, probe);
    expect(result).toBe(false);
  });

  it("returns false when stat throws — file moved / permission denied / FS glitch", async () => {
    const probe = vi.fn().mockRejectedValue(new Error("ENOENT"));
    const result = await isSwitchCacheStillValid(cached, probe);
    expect(result).toBe(false);
  });

  it("returns true when stat resolves to null — implementation bug, fail open", async () => {
    // statBinary is implemented but returned null without throwing. Treat
    // as "can't tell" rather than "definitely stale" — same posture as
    // when the probe is undefined.
    const probe = vi.fn().mockResolvedValue(null);
    const result = await isSwitchCacheStillValid(cached, probe);
    expect(result).toBe(true);
  });

  it("treats null mtime/size in cached entry as never matching a real stat", async () => {
    // Cache entries from cold paths that couldn't capture a stat (HTTP
    // fallback) store nulls. If we later get a real stat back we should
    // not match, since "null !== anything-real".
    const cachedNoStat = { mtimeNs: null, size: null };
    const probe = vi.fn().mockResolvedValue({ mtimeNs: "1700000000000000000", size: 100 });
    const result = await isSwitchCacheStillValid(cachedNoStat, probe);
    expect(result).toBe(false);
  });
});

// Integration-flavoured cases: instead of vi.fn().mockResolvedValue(...) the
// probe here actually stat()s a real temp file. This guards against the
// mock-tests-coupled-to-implementation drift the reviewer flagged — if our
// helper or the Tauri command ever changed how mtime is shaped, a pure mock
// test would silently agree with itself. These tests bind real filesystem
// behaviour to the helper's contract.
describe("isSwitchCacheStillValid (real fs)", () => {
  let workdir: string;
  let target: string;

  beforeAll(() => {
    workdir = mkdtempSync(join(tmpdir(), "doxmind-switch-cache-"));
    target = join(workdir, "fixture.bin");
  });

  afterAll(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  // Read a real (mtime, size) and shape it to match what the Tauri command
  // workspace_stat_binary would return: ns-string + numeric byte count.
  const realStat = () => {
    const s = statSync(target, { bigint: true });
    return { mtimeNs: s.mtimeNs.toString(), size: Number(s.size) };
  };

  it("real file unchanged → cache stays valid", async () => {
    writeFileSync(target, "v1");
    const cached = realStat();
    const result = await isSwitchCacheStillValid(cached, () => Promise.resolve(realStat()));
    expect(result).toBe(true);
  });

  it("real mtime bump (utimes) → cache invalidated", async () => {
    writeFileSync(target, "v1");
    const cached = realStat();
    // Push the mtime forward by 5s deterministically. Avoids racing on
    // CI where two writes back-to-back can hit the same mtime tick.
    const future = new Date(Date.now() + 5000);
    utimesSync(target, future, future);
    const result = await isSwitchCacheStillValid(cached, () => Promise.resolve(realStat()));
    expect(result).toBe(false);
  });

  it("real content rewrite of different size → cache invalidated", async () => {
    writeFileSync(target, "v1");
    const cached = realStat();
    writeFileSync(target, "v2-much-longer-content-than-before");
    const result = await isSwitchCacheStillValid(cached, () => Promise.resolve(realStat()));
    expect(result).toBe(false);
  });

  it("real probe throws on missing file → cache invalidated", async () => {
    writeFileSync(target, "v1");
    const cached = realStat();
    rmSync(target);
    const result = await isSwitchCacheStillValid(cached, () => Promise.resolve(realStat()));
    // realStat() throws ENOENT → helper's catch path returns false.
    expect(result).toBe(false);
    // Restore for any later tests in this describe.
    writeFileSync(target, "v1");
  });
});
