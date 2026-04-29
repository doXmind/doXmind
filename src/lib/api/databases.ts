/**
 * Database block API methods - extends ApiClient prototype
 */

import { ApiClient } from "./client";
import type {
  DatabaseData,
  DatabaseRow,
  CreateDatabaseRequest,
  AddPropertyRequest,
  UpdatePropertyRequest,
  AddRowRequest,
  UpdateRowRequest,
  CreateViewRequest,
  UpdateViewRequest,
} from "@/extensions/database/database-types";

export interface PaginatedRowsResponse {
  rows: DatabaseRow[];
  total: number;
  has_more: boolean;
}

declare module "./client" {
  interface ApiClient {
    createDatabase(options?: CreateDatabaseRequest): Promise<DatabaseData>;
    getDatabase(id: string): Promise<DatabaseData>;
    updateDatabase(
      id: string,
      updates: { title?: string; icon?: string | null }
    ): Promise<DatabaseData>;
    deleteDatabase(id: string): Promise<{ status: string }>;

    addDatabaseProperty(databaseId: string, body: AddPropertyRequest): Promise<DatabaseData>;
    updateDatabaseProperty(
      databaseId: string,
      propId: string,
      body: UpdatePropertyRequest
    ): Promise<DatabaseData>;
    deleteDatabaseProperty(databaseId: string, propId: string): Promise<DatabaseData>;
    reorderDatabaseProperties(databaseId: string, propertyIds: string[]): Promise<DatabaseData>;

    getDatabaseRows(
      databaseId: string,
      options?: { limit?: number; offset?: number }
    ): Promise<PaginatedRowsResponse>;
    addDatabaseRow(databaseId: string, body?: AddRowRequest): Promise<DatabaseData>;
    updateDatabaseRow(
      databaseId: string,
      rowId: string,
      body: UpdateRowRequest
    ): Promise<DatabaseData>;
    deleteDatabaseRow(databaseId: string, rowId: string): Promise<DatabaseData>;
    reorderDatabaseRows(databaseId: string, rowIds: string[]): Promise<DatabaseData>;

    createOrGetRowPage(databaseId: string, rowId: string): Promise<{ page_file_id: string }>;

    createDatabaseView(databaseId: string, body: CreateViewRequest): Promise<DatabaseData>;
    updateDatabaseView(
      databaseId: string,
      viewId: string,
      body: UpdateViewRequest
    ): Promise<DatabaseData>;
    deleteDatabaseView(databaseId: string, viewId: string): Promise<DatabaseData>;
  }
}

// Database CRUD

ApiClient.prototype.createDatabase = async function (
  this: ApiClient,
  options?: CreateDatabaseRequest
) {
  // Use a 2-minute timeout for large imports
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120_000);

  try {
    return await this.request<DatabaseData>("/api/databases/", {
      method: "POST",
      body: JSON.stringify({
        title: options?.title || "Untitled Database",
        properties_schema: options?.properties_schema,
        rows: options?.rows,
        views: options?.views,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
};

ApiClient.prototype.getDatabase = async function (this: ApiClient, id: string) {
  return this.request<DatabaseData>(`/api/databases/${id}`);
};

ApiClient.prototype.updateDatabase = async function (
  this: ApiClient,
  id: string,
  updates: { title?: string; icon?: string | null }
) {
  return this.request<DatabaseData>(`/api/databases/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
};

ApiClient.prototype.deleteDatabase = async function (this: ApiClient, id: string) {
  return this.request<{ status: string }>(`/api/databases/${id}`, {
    method: "DELETE",
  });
};

// Properties

ApiClient.prototype.addDatabaseProperty = async function (
  this: ApiClient,
  databaseId: string,
  body: AddPropertyRequest
) {
  return this.request<DatabaseData>(`/api/databases/${databaseId}/properties`, {
    method: "POST",
    body: JSON.stringify(body),
  });
};

ApiClient.prototype.updateDatabaseProperty = async function (
  this: ApiClient,
  databaseId: string,
  propId: string,
  body: UpdatePropertyRequest
) {
  return this.request<DatabaseData>(`/api/databases/${databaseId}/properties/${propId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
};

ApiClient.prototype.deleteDatabaseProperty = async function (
  this: ApiClient,
  databaseId: string,
  propId: string
) {
  return this.request<DatabaseData>(`/api/databases/${databaseId}/properties/${propId}`, {
    method: "DELETE",
  });
};

ApiClient.prototype.reorderDatabaseProperties = async function (
  this: ApiClient,
  databaseId: string,
  propertyIds: string[]
) {
  return this.request<DatabaseData>(`/api/databases/${databaseId}/properties/reorder`, {
    method: "PUT",
    body: JSON.stringify({ property_ids: propertyIds }),
  });
};

// Rows

ApiClient.prototype.getDatabaseRows = async function (
  this: ApiClient,
  databaseId: string,
  options?: { limit?: number; offset?: number }
) {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.offset) params.set("offset", String(options.offset));
  const qs = params.toString();
  return this.request<PaginatedRowsResponse>(
    `/api/databases/${databaseId}/rows${qs ? `?${qs}` : ""}`
  );
};

ApiClient.prototype.addDatabaseRow = async function (
  this: ApiClient,
  databaseId: string,
  body?: AddRowRequest
) {
  return this.request<DatabaseData>(`/api/databases/${databaseId}/rows`, {
    method: "POST",
    body: JSON.stringify(body || {}),
  });
};

ApiClient.prototype.updateDatabaseRow = async function (
  this: ApiClient,
  databaseId: string,
  rowId: string,
  body: UpdateRowRequest
) {
  return this.request<DatabaseData>(`/api/databases/${databaseId}/rows/${rowId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
};

ApiClient.prototype.deleteDatabaseRow = async function (
  this: ApiClient,
  databaseId: string,
  rowId: string
) {
  return this.request<DatabaseData>(`/api/databases/${databaseId}/rows/${rowId}`, {
    method: "DELETE",
  });
};

ApiClient.prototype.reorderDatabaseRows = async function (
  this: ApiClient,
  databaseId: string,
  rowIds: string[]
) {
  return this.request<DatabaseData>(`/api/databases/${databaseId}/rows/reorder`, {
    method: "PUT",
    body: JSON.stringify({ row_ids: rowIds }),
  });
};

// Row Page

ApiClient.prototype.createOrGetRowPage = async function (
  this: ApiClient,
  databaseId: string,
  rowId: string
) {
  return this.request<{ page_file_id: string }>(`/api/databases/${databaseId}/rows/${rowId}/page`, {
    method: "POST",
  });
};

// Views

ApiClient.prototype.createDatabaseView = async function (
  this: ApiClient,
  databaseId: string,
  body: CreateViewRequest
) {
  return this.request<DatabaseData>(`/api/databases/${databaseId}/views`, {
    method: "POST",
    body: JSON.stringify(body),
  });
};

ApiClient.prototype.updateDatabaseView = async function (
  this: ApiClient,
  databaseId: string,
  viewId: string,
  body: UpdateViewRequest
) {
  return this.request<DatabaseData>(`/api/databases/${databaseId}/views/${viewId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
};

ApiClient.prototype.deleteDatabaseView = async function (
  this: ApiClient,
  databaseId: string,
  viewId: string
) {
  return this.request<DatabaseData>(`/api/databases/${databaseId}/views/${viewId}`, {
    method: "DELETE",
  });
};
