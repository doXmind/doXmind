/**
 * Bookmarks API methods - extends ApiClient prototype
 */

import { ApiClient } from "./client";

export interface BookmarkMetadata {
  url: string;
  title: string;
  description: string | null;
  favicon_url: string | null;
  image_url: string | null;
}

declare module "./client" {
  interface ApiClient {
    unfurlUrl(url: string): Promise<BookmarkMetadata>;
  }
}

ApiClient.prototype.unfurlUrl = async function (
  this: ApiClient,
  url: string
): Promise<BookmarkMetadata> {
  return this.request<BookmarkMetadata>("/api/bookmarks/unfurl", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
};
