/**
 * API client barrel file — local desktop edition.
 */

// Import mixin modules to apply prototype extensions
import "./files";
import "./databases";
import "./marker";

// Re-export the client class and singleton
export { ApiClient } from "./client";

// Re-export the types still in use
export type { SearchResultItem, SearchResults } from "./types";

// Create and export the default client instance
import { ApiClient } from "./client";
export const api = new ApiClient();
