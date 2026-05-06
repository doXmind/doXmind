import { describe, expect, it, vi } from "vitest";

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
