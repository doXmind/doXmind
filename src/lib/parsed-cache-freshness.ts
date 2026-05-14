export type ParsedCacheEnvelope<T = unknown> = {
  sourceHash: string;
  parsed: T;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function freshParsedCacheValue<T>(cache: unknown, currentSourceHash: string): T | null {
  if (!isRecord(cache)) return null;
  if (cache.sourceHash !== currentSourceHash) return null;
  if (!Object.prototype.hasOwnProperty.call(cache, "parsed")) return null;
  return cache.parsed as T;
}
