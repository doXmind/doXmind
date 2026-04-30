/**
 * Local migration API methods.
 */

import { ApiClient } from "./client";

export interface DbToWorkspaceMigrationResult {
  output_root: string;
  folders_exported: number;
  documents_exported: number;
  sidecars_written: number;
  empty_documents: number;
  fallback_html: number;
  images_copied: number;
  images_missing: number;
  databases_embedded: number;
  skipped_trash: number;
  written_markdown: string[];
  missing_images: string[];
}

declare module "./client" {
  interface ApiClient {
    migrateDbToWorkspace(
      outputRoot: string,
      options?: { force?: boolean }
    ): Promise<DbToWorkspaceMigrationResult>;
  }
}

ApiClient.prototype.migrateDbToWorkspace = async function (
  this: ApiClient,
  outputRoot: string,
  options: { force?: boolean } = {}
) {
  return this.request<DbToWorkspaceMigrationResult>("/api/migration/export-library", {
    method: "POST",
    body: JSON.stringify({
      output_root: outputRoot,
      overwrite: options.force ?? false,
    }),
  });
};
