// Shared stat-revalidation logic for the PDF / Excel module-level switch
// caches. Lives outside both workspace components so it's directly
// unit-testable — the workspaces themselves carry too much React/Tauri
// machinery to drive from a vitest harness.
//
// Contract:
//   * `cached`        — the (mtime, size) the entry was stored with.
//                       Either side may be null when the cold path
//                       wasn't able to capture a stat (typically the
//                       HTTP browser-dev fallback).
//   * `probe`         — async fetch of the live (mtime, size). Pass the
//                       adapter's `statBinary(handle)` here, or
//                       `undefined` when the adapter doesn't implement
//                       stat at all (HTTP fallback).
//
// Three resolutions:
//   1. probe undefined  → return true (cache stays valid; we can't tell
//      otherwise and refusing to serve would defeat dev mode).
//   2. probe resolves   → compare. Match = true. Mismatch = false.
//   3. probe throws     → return false. Stat is implemented but failed,
//      most likely because the source file moved or permissions
//      changed; serving an unverifiable cache is worse than re-reading.

export type SwitchCacheStat = { mtimeNs: string; size: number };

export type SwitchCacheKey = {
  mtimeNs: string | null;
  size: number | null;
};

export async function isSwitchCacheStillValid(
  cached: SwitchCacheKey,
  probe: (() => Promise<SwitchCacheStat | null>) | undefined
): Promise<boolean> {
  if (!probe) return true;
  try {
    const stat = await probe();
    if (!stat) return true;
    return stat.mtimeNs === cached.mtimeNs && stat.size === cached.size;
  } catch {
    return false;
  }
}
