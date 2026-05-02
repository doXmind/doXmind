/**
 * Sidecar-backed database block state.
 *
 * Inline database blocks are document data, not app database data. Their
 * schema, rows, and views live in the active document sidecar under
 * `extras.databases`.
 */

import { create } from "zustand";
import type { StoreApi, UseBoundStore } from "zustand";
import { eventBus } from "@/lib/events";
import type {
  AddPropertyRequest,
  AddRowRequest,
  CreateDatabaseRequest,
  CreateViewRequest,
  DatabaseData,
  DatabaseRow,
  DatabaseView,
  PropertyDef,
  RowProperties,
  UpdatePropertyRequest,
  UpdateViewRequest,
} from "@/extensions/database/database-types";

interface DatabaseState {
  databases: Record<string, DatabaseData>;
  loadingIds: Set<string>;
  activeViewIds: Record<string, string>;

  loadDatabase: (id: string) => Promise<DatabaseData | null>;
  createDatabase: (options?: CreateDatabaseRequest) => Promise<DatabaseData>;
  updateDatabase: (id: string, updates: { title?: string; icon?: string | null }) => Promise<void>;
  deleteDatabase: (id: string) => Promise<void>;

  addProperty: (dbId: string, body: AddPropertyRequest) => Promise<void>;
  updateProperty: (dbId: string, propId: string, body: UpdatePropertyRequest) => Promise<void>;
  deleteProperty: (dbId: string, propId: string) => Promise<void>;
  reorderProperties: (dbId: string, propertyIds: string[]) => Promise<void>;

  loadMoreRows: (dbId: string) => Promise<void>;
  addRow: (dbId: string, body?: AddRowRequest) => Promise<void>;
  duplicateRow: (dbId: string, rowId: string) => Promise<void>;
  updateRow: (dbId: string, rowId: string, properties: RowProperties) => Promise<void>;
  deleteRow: (dbId: string, rowId: string) => Promise<void>;
  reorderRows: (dbId: string, rowIds: string[]) => Promise<void>;

  setActiveView: (dbId: string, viewId: string) => void;
  createView: (dbId: string, body: CreateViewRequest) => Promise<void>;
  updateView: (dbId: string, viewId: string, body: UpdateViewRequest) => Promise<void>;
  deleteView: (dbId: string, viewId: string) => Promise<void>;
}

type DatabaseExtras = {
  databases?: Record<string, DatabaseData>;
  [key: string]: unknown;
};

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return crypto.randomUUID();
}

function databaseExtrasFromUnknown(extras: unknown): Record<string, DatabaseData> {
  if (!extras || typeof extras !== "object") return {};
  const databases = (extras as DatabaseExtras).databases;
  if (!databases || typeof databases !== "object") return {};
  return databases;
}

export function hydrateDatabasesFromExtras(extras: unknown): void {
  const databases = databaseExtrasFromUnknown(extras);
  const ids = Object.keys(databases);
  if (ids.length === 0) return;

  useDatabaseStore.setState((state) => {
    const activeViewIds = { ...state.activeViewIds };
    for (const id of ids) {
      activeViewIds[id] = activeViewIds[id] || databases[id]?.views[0]?.id || "";
    }
    return {
      databases: { ...state.databases, ...databases },
      activeViewIds,
    };
  });
}

export function syncDatabasesForDocument(
  extras: unknown,
  html: string,
  markdown?: string | null
): void {
  const diskDatabases = databaseExtrasFromUnknown(extras);
  const referencedIds = extractDatabaseIdsFromDocument(html, markdown);
  if (referencedIds.size === 0) {
    hydrateDatabasesFromExtras(extras);
    return;
  }

  useDatabaseStore.setState((state) => {
    const databases = { ...state.databases };
    const activeViewIds = { ...state.activeViewIds };

    for (const id of referencedIds) {
      const db = diskDatabases[id];
      if (db) {
        databases[id] = db;
        activeViewIds[id] = activeViewIds[id] || db.views[0]?.id || "";
      } else {
        delete databases[id];
        delete activeViewIds[id];
      }
    }

    return { databases, activeViewIds };
  });
}

function extractDatabaseIdsFromDocument(html: string, markdown?: string | null): Set<string> {
  const ids = new Set<string>();
  const sources = [html, markdown ?? ""];
  for (const source of sources) {
    for (const match of source.matchAll(/data-database-id=["']([^"']+)["']/g)) ids.add(match[1]);
    for (const match of source.matchAll(/<!--\s*database:([a-zA-Z0-9_-]+)\s*-->/g)) {
      ids.add(match[1]);
    }
  }
  return ids;
}

function databasesForDocument(
  state: DatabaseState,
  html: string,
  markdown?: string | null,
  extraIds: string[] = []
): Record<string, DatabaseData> {
  const ids = extractDatabaseIdsFromDocument(html, markdown);
  for (const id of extraIds) ids.add(id);

  const databases: Record<string, DatabaseData> = {};
  for (const id of ids) {
    const db = state.databases[id];
    if (db) databases[id] = db;
  }
  return databases;
}

async function persistCurrentDatabases(state: DatabaseState, changedDbIds: string[] = []) {
  const { useFileStore } = await import("@/stores/file-store");
  const { createStorageAdapter } = await import("@/lib/storage");
  const fileState = useFileStore.getState();
  if (!fileState.rootPath || !fileState.currentFileId) return;

  const file = fileState.files.find((item) => item.id === fileState.currentFileId);
  if (!file || file.isFolder) return;

  const adapter = createStorageAdapter({ disk: { root: fileState.rootPath } });
  const current = await adapter.read(file.storageHandle ?? { mode: "disk", id: file.id });
  const existingExtras =
    current.extras && typeof current.extras === "object"
      ? (current.extras as Record<string, unknown>)
      : {};

  await adapter.write(current.handle, {
    extras: {
      ...existingExtras,
      databases: databasesForDocument(state, current.html, current.markdown, changedDbIds),
    },
  });
}

function normalizeProperty(raw: Record<string, unknown>, position: number): PropertyDef {
  return {
    id: typeof raw.id === "string" ? raw.id : newId(),
    name: typeof raw.name === "string" ? raw.name : "Property",
    type: typeof raw.type === "string" ? (raw.type as PropertyDef["type"]) : "text",
    position: typeof raw.position === "number" ? raw.position : position,
    options:
      raw.options && typeof raw.options === "object"
        ? (raw.options as PropertyDef["options"])
        : undefined,
  };
}

function makeView(
  databaseId: string,
  view: Record<string, unknown>,
  position: number
): DatabaseView {
  const created = nowIso();
  return {
    id: typeof view.id === "string" ? view.id : newId(),
    database_id: databaseId,
    name: typeof view.name === "string" ? view.name : "Table View",
    type: typeof view.type === "string" ? (view.type as DatabaseView["type"]) : "table",
    config:
      view.config && typeof view.config === "object" ? (view.config as DatabaseView["config"]) : {},
    position,
    created_at: created,
    updated_at: created,
  };
}

function makeRow(databaseId: string, row: Record<string, unknown>, position: number): DatabaseRow {
  const created = nowIso();
  return {
    id: typeof row.id === "string" ? row.id : newId(),
    database_id: databaseId,
    properties:
      row.properties && typeof row.properties === "object"
        ? (row.properties as DatabaseRow["properties"])
        : {},
    position,
    page_file_id: typeof row.page_file_id === "string" ? row.page_file_id : null,
    created_at: created,
    updated_at: created,
  };
}

function createLocalDatabase(options: CreateDatabaseRequest = {}): DatabaseData {
  const created = nowIso();
  const databaseId = newId();
  const title = options.title || "Untitled Database";

  if (options.properties_schema?.length) {
    const properties_schema = options.properties_schema.map((prop, index) =>
      normalizeProperty(prop, index)
    );
    const rows = (options.rows ?? []).map((row, index) =>
      makeRow(databaseId, row as Record<string, unknown>, index)
    );
    const views = options.views?.length
      ? options.views.map((view, index) => makeView(databaseId, view, index))
      : [makeView(databaseId, { name: "Table View", type: "table" }, 0)];

    return {
      id: databaseId,
      title,
      icon: null,
      properties_schema,
      rows,
      row_count: rows.length,
      hasMoreRows: false,
      views,
      created_at: created,
      updated_at: created,
    };
  }

  const namePropId = newId();
  const statusPropId = newId();
  const choices = [
    { id: newId(), name: "To Do", color: "gray" },
    { id: newId(), name: "In Progress", color: "blue" },
    { id: newId(), name: "Done", color: "green" },
  ];
  const properties_schema: PropertyDef[] = [
    { id: namePropId, name: "Name", type: "text", position: 0 },
    {
      id: statusPropId,
      name: "Status",
      type: "select",
      position: 1,
      options: { choices },
    },
  ];
  const views = options.views?.length
    ? options.views.map((view, index) =>
        makeView(
          databaseId,
          {
            ...view,
            config:
              view.type === "board" && !view.config
                ? { groupByPropertyId: statusPropId }
                : (view.config ?? {}),
          },
          index
        )
      )
    : [
        makeView(databaseId, { name: "Table View", type: "table" }, 0),
        makeView(
          databaseId,
          { name: "Board View", type: "board", config: { groupByPropertyId: statusPropId } },
          1
        ),
      ];
  const rows = ["To Do", "In Progress", "Done"].map((status, index) =>
    makeRow(
      databaseId,
      {
        properties: {
          [namePropId]: `Task ${index + 1}`,
          [statusPropId]: choices.find((choice) => choice.name === status)?.id ?? null,
        },
      },
      index
    )
  );

  return {
    id: databaseId,
    title,
    icon: null,
    properties_schema,
    rows,
    row_count: rows.length,
    hasMoreRows: false,
    views,
    created_at: created,
    updated_at: created,
  };
}

async function persistDb(dbId: string) {
  await persistCurrentDatabases(useDatabaseStore.getState(), [dbId]);
}

export const useDatabaseStore: UseBoundStore<StoreApi<DatabaseState>> = create<DatabaseState>()(
  (set, get) => ({
    databases: {},
    loadingIds: new Set(),
    activeViewIds: {},

    loadDatabase: async (id) => get().databases[id] ?? null,

    createDatabase: async (options) => {
      const data = createLocalDatabase(options);
      set((state) => ({
        databases: { ...state.databases, [data.id]: data },
        activeViewIds: { ...state.activeViewIds, [data.id]: data.views[0]?.id ?? "" },
      }));
      await persistDb(data.id);
      return data;
    },

    updateDatabase: async (id, updates) => {
      set((state) => {
        const db = state.databases[id];
        if (!db) return state;
        return {
          databases: {
            ...state.databases,
            [id]: { ...db, ...updates, updated_at: nowIso() },
          },
        };
      });
      await persistDb(id);
    },

    deleteDatabase: async (id) => {
      set((state) => {
        const { [id]: _deleted, ...rest } = state.databases;
        const { [id]: _view, ...activeViewIds } = state.activeViewIds;
        return { databases: rest, activeViewIds };
      });
      await persistCurrentDatabases(useDatabaseStore.getState());
      eventBus.emit("database:deleted", { databaseId: id });
    },

    addProperty: async (dbId, body) => {
      set((state) => {
        const db = state.databases[dbId];
        if (!db) return state;
        const prop: PropertyDef = {
          id: newId(),
          name: body.name,
          type: body.type,
          position: db.properties_schema.length,
          options: body.options,
        };
        return {
          databases: {
            ...state.databases,
            [dbId]: {
              ...db,
              properties_schema: [...db.properties_schema, prop],
              updated_at: nowIso(),
            },
          },
        };
      });
      await persistDb(dbId);
    },

    updateProperty: async (dbId, propId, body) => {
      set((state) => {
        const db = state.databases[dbId];
        if (!db) return state;
        return {
          databases: {
            ...state.databases,
            [dbId]: {
              ...db,
              properties_schema: db.properties_schema.map((p) =>
                p.id === propId ? { ...p, ...body } : p
              ),
              updated_at: nowIso(),
            },
          },
        };
      });
      await persistDb(dbId);
    },

    deleteProperty: async (dbId, propId) => {
      set((state) => {
        const db = state.databases[dbId];
        if (!db) return state;
        return {
          databases: {
            ...state.databases,
            [dbId]: {
              ...db,
              properties_schema: db.properties_schema.filter((p) => p.id !== propId),
              rows: db.rows.map((row) => {
                const { [propId]: _deleted, ...properties } = row.properties;
                return { ...row, properties };
              }),
              updated_at: nowIso(),
            },
          },
        };
      });
      await persistDb(dbId);
    },

    reorderProperties: async (dbId, propertyIds) => {
      set((state) => {
        const db = state.databases[dbId];
        if (!db) return state;
        const byId = new Map(db.properties_schema.map((prop) => [prop.id, prop]));
        const ordered = propertyIds
          .map((id, position) => {
            const prop = byId.get(id);
            return prop ? { ...prop, position } : null;
          })
          .filter(Boolean) as PropertyDef[];
        return {
          databases: {
            ...state.databases,
            [dbId]: { ...db, properties_schema: ordered, updated_at: nowIso() },
          },
        };
      });
      await persistDb(dbId);
    },

    loadMoreRows: async () => {},

    addRow: async (dbId, body) => {
      set((state) => {
        const db = state.databases[dbId];
        if (!db) return state;
        const maxPos = db.rows.reduce((max, row) => Math.max(max, row.position), -1);
        const row = makeRow(dbId, { properties: body?.properties ?? {} }, maxPos + 1);
        return {
          databases: {
            ...state.databases,
            [dbId]: {
              ...db,
              rows: [...db.rows, row],
              row_count: db.rows.length + 1,
              updated_at: nowIso(),
            },
          },
        };
      });
      await persistDb(dbId);
    },

    duplicateRow: async (dbId, rowId) => {
      const source = get().databases[dbId]?.rows.find((row) => row.id === rowId);
      if (!source) return;
      await get().addRow(dbId, { properties: { ...source.properties } });
    },

    updateRow: async (dbId, rowId, properties) => {
      set((state) => {
        const db = state.databases[dbId];
        if (!db) return state;
        return {
          databases: {
            ...state.databases,
            [dbId]: {
              ...db,
              rows: db.rows.map((row) =>
                row.id === rowId
                  ? {
                      ...row,
                      properties: { ...row.properties, ...properties },
                      updated_at: nowIso(),
                    }
                  : row
              ),
              updated_at: nowIso(),
            },
          },
        };
      });
      await persistDb(dbId);
    },

    deleteRow: async (dbId, rowId) => {
      set((state) => {
        const db = state.databases[dbId];
        if (!db) return state;
        const rows = db.rows.filter((row) => row.id !== rowId);
        return {
          databases: {
            ...state.databases,
            [dbId]: {
              ...db,
              rows,
              row_count: rows.length,
              updated_at: nowIso(),
            },
          },
        };
      });
      await persistDb(dbId);
    },

    reorderRows: async (dbId, rowIds) => {
      set((state) => {
        const db = state.databases[dbId];
        if (!db) return state;
        const positionMap = new Map(rowIds.map((id, index) => [id, index]));
        const rows = db.rows
          .map((row) => ({
            ...row,
            position: positionMap.get(row.id) ?? row.position,
            updated_at: nowIso(),
          }))
          .sort((a, b) => a.position - b.position);
        return {
          databases: {
            ...state.databases,
            [dbId]: { ...db, rows, updated_at: nowIso() },
          },
        };
      });
      await persistDb(dbId);
    },

    setActiveView: (dbId, viewId) => {
      set((state) => ({ activeViewIds: { ...state.activeViewIds, [dbId]: viewId } }));
    },

    createView: async (dbId, body) => {
      const view = makeView(
        dbId,
        body as unknown as Record<string, unknown>,
        get().databases[dbId]?.views.length ?? 0
      );
      set((state) => {
        const db = state.databases[dbId];
        if (!db) return state;
        return {
          databases: {
            ...state.databases,
            [dbId]: { ...db, views: [...db.views, view], updated_at: nowIso() },
          },
          activeViewIds: { ...state.activeViewIds, [dbId]: view.id },
        };
      });
      await persistDb(dbId);
    },

    updateView: async (dbId, viewId, body) => {
      set((state) => {
        const db = state.databases[dbId];
        if (!db) return state;
        return {
          databases: {
            ...state.databases,
            [dbId]: {
              ...db,
              views: db.views.map((view) =>
                view.id === viewId
                  ? {
                      ...view,
                      ...(body.name != null ? { name: body.name } : {}),
                      config: { ...view.config, ...(body.config ?? {}) },
                      updated_at: nowIso(),
                    }
                  : view
              ),
              updated_at: nowIso(),
            },
          },
        };
      });
      await persistDb(dbId);
    },

    deleteView: async (dbId, viewId) => {
      set((state) => {
        const db = state.databases[dbId];
        if (!db) return state;
        const views = db.views.filter((view) => view.id !== viewId);
        return {
          databases: {
            ...state.databases,
            [dbId]: { ...db, views, updated_at: nowIso() },
          },
          activeViewIds:
            state.activeViewIds[dbId] === viewId
              ? { ...state.activeViewIds, [dbId]: views[0]?.id ?? "" }
              : state.activeViewIds,
        };
      });
      await persistDb(dbId);
    },
  })
);
