/**
 * Resolve the optional standalone FastAPI tooling URL.
 *
 * Order of precedence:
 *   1. NEXT_PUBLIC_API_URL build-time env var — useful when running the Next
 *      dev server in a regular browser tab against a known backend port.
 *   2. http://127.0.0.1:8000 — fallback for plain `npm run dev`.
 *
 * Packaged Electron builds use native commands and do not inject or
 * depend on an HTTP backend URL.
 */

const FALLBACK = "http://127.0.0.1:8000";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function loopbackApiBase(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (!LOOPBACK_HOSTS.has(url.hostname)) return null;
    if (url.username || url.password) return null;
    return url.href.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function getApiBase(): string {
  const envBase = process.env.NEXT_PUBLIC_API_URL;
  if (envBase) return loopbackApiBase(envBase) || FALLBACK;
  return FALLBACK;
}

/** Prefix a standalone local-tooling path with the configured base URL. */
export function apiUrl(path: string): string {
  const base = getApiBase();
  if (!path.startsWith("/")) path = "/" + path;
  return `${base}${path}`;
}
