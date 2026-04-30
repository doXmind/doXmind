/**
 * Resolve the FastAPI sidecar's base URL at runtime.
 *
 * Order of precedence:
 *   1. window.__TAURI_BACKEND_URL__ — injected by the Tauri shell before the
 *      WebView loads (see src-tauri/src/lib.rs).
 *   2. NEXT_PUBLIC_API_URL build-time env var — useful when running the Next
 *      dev server in a regular browser tab against a known backend port.
 *   3. http://127.0.0.1:8000 — last-resort fallback for plain `npm run dev`.
 *
 * Always evaluated lazily so the Tauri-injected value is picked up after the
 * page first renders (the global is available before any React effect runs).
 */

declare global {
  interface Window {
    __TAURI_BACKEND_URL__?: string;
  }
}

const FALLBACK = "http://127.0.0.1:8000";

export function getApiBase(): string {
  if (typeof window !== "undefined" && window.__TAURI_BACKEND_URL__) {
    return window.__TAURI_BACKEND_URL__.replace(/\/+$/, "");
  }
  const envBase = process.env.NEXT_PUBLIC_API_URL;
  if (envBase) return envBase.replace(/\/+$/, "");
  return FALLBACK;
}

/** Convenience: prefix a sidecar HTTP path with the backend base URL. */
export function apiUrl(path: string): string {
  const base = getApiBase();
  if (!path.startsWith("/")) path = "/" + path;
  return `${base}${path}`;
}
