import { apiUrl } from "./base";

export interface UnfurledLink {
  url: string;
  title: string;
  description: string | null;
  faviconUrl: string | null;
  imageUrl: string | null;
}

/**
 * If the user typed `example.com`, treat it as `https://example.com`.
 * Leaves explicit `http://` / `https://` / other protocols (e.g. `mailto:`) intact.
 */
export function normaliseBookmarkUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return "https://" + trimmed.replace(/^\/+/, "");
}

/** Fetch Open Graph / metadata for a URL via the local sidecar. */
export async function unfurlLink(url: string): Promise<UnfurledLink> {
  const response = await fetch(apiUrl("/api/links/unfurl"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!response.ok) {
    throw new Error(`Unfurl failed: ${response.status}`);
  }
  const data = (await response.json()) as {
    url: string;
    title: string;
    description: string | null;
    favicon_url: string | null;
    image_url: string | null;
  };
  return {
    url: data.url,
    title: data.title,
    description: data.description,
    faviconUrl: data.favicon_url,
    imageUrl: data.image_url,
  };
}
