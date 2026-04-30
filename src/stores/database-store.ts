/**
 * Zustand store for database block state management.
 *
 * Caches loaded databases in memory with optimistic update pattern.
 * API responses are merged surgically (never full-replace) so that
 * concurrent operations don't overwrite each other's optimistic state.
 */

import { create } from "zustand";
import type { StoreApi, UseBoundStore } from "zustand";
import { api } from "@/lib/api";
import { eventBus } from "@/lib/events";
import type {
  DatabaseData,
  DatabaseRow,
  DatabaseView,
  PropertyDef,
  CreateDatabaseRequest,
  AddPropertyRequest,
  UpdatePropertyRequest,
  AddRowRequest,
  CreateViewRequest,
  UpdateViewRequest,
  RowProperties,
} from "@/extensions/database/database-types";

interface DatabaseState {
  /** Cached databases keyed by ID */
  databases: Record<string, DatabaseData>;
  /** IDs currently being loaded */
  loadingIds: Set<string>;
  /** Currently active view per database */
  activeViewIds: Record<string, string>;

  // Actions
  loadDatabase: (id: string) => Promise<DatabaseData | null>;
  createDatabase: (options?: CreateDatabaseRequest) => Promise<DatabaseData>;
  updateDatabase: (id: string, updates: { title?: string; icon?: string | null }) => Promise<void>;
  deleteDatabase: (id: string) => Promise<void>;

  // Properties
  addProperty: (dbId: string, body: AddPropertyRequest) => Promise<void>;
  updateProperty: (dbId: string, propId: string, body: UpdatePropertyRequest) => Promise<void>;
  deleteProperty: (dbId: string, propId: string) => Promise<void>;
  reorderProperties: (dbId: string, propertyIds: string[]) => Promise<void>;

  // Rows
  loadMoreRows: (dbId: string) => Promise<void>;
  addRow: (dbId: string, body?: AddRowRequest) => Promise<void>;
  duplicateRow: (dbId: string, rowId: string) => Promise<void>;
  updateRow: (dbId: string, rowId: string, properties: RowProperties) => Promise<void>;
  deleteRow: (dbId: string, rowId: string) => Promise<void>;
  reorderRows: (dbId: string, rowIds: string[]) => Promise<void>;

  // Views
  setActiveView: (dbId: string, viewId: string) => void;
  createView: (dbId: string, body: CreateViewRequest) => Promise<void>;
  updateView: (dbId: string, viewId: string, body: UpdateViewRequest) => Promise<void>;
  deleteView: (dbId: string, viewId: string) => Promise<void>;
}

/**
 * Load only the first page of rows. Further pages are loaded on-demand
 * via the `loadMoreRows` store action when the user scrolls.
 */
async function loadInitialRows(dbId: string, setFn: typeof useDatabaseStore.setState) {
  const page = await api.getDatabaseRows(dbId, { limit: 500, offset: 0 });
  setFn((state) => {
    const db = state.databases[dbId];
    if (!db) return state;
    return {
      databases: {
        ...state.databases,
        [dbId]: { ...db, rows: page.rows, hasMoreRows: page.has_more },
      },
    };
  });
}

/** Set used to prevent concurrent loadMoreRows calls for the same database. */
const _loadingMoreIds = new Set<string>();

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

async function isDiskWorkspace(): Promise<boolean> {
  const { useFileStore } = await import("@/stores/file-store");
  return useFileStore.getState().workspaceMode === "disk";
}

function extractDatabaseIdsFromDocument(html: string, markdown?: string | null): Set<string> {
  const ids = new Set<string>();
  const sources = [html, markdown ?? ""];
  for (const source of sources) {
    for (const match of source.matchAll(/data-database-id=["']([^"']+)["']/g)) {
      ids.add(match[1]);
    }
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

async function persistCurrentDiskDatabases(
  state: DatabaseState,
  changedDbIds: string[] = []
): Promise<boolean> {
  const { useFileStore } = await import("@/stores/file-store");
  const { createStorageAdapter } = await import("@/lib/storage");
  const fileState = useFileStore.getState();
  if (fileState.workspaceMode !== "disk") {
    return false;
  }
  if (!fileState.workspaceRoot || !fileState.currentFileId) return true;

  const file = fileState.files.find((item) => item.id === fileState.currentFileId);
  if (!file || file.isFolder) return true;

  const handle = file.storageHandle ?? {
    mode: "disk" as const,
    id: file.id,
    kind: "document" as const,
  };
  const adapter = createStorageAdapter({
    mode: "disk",
    disk: { root: fileState.workspaceRoot },
  });
  const current = await adapter.read(handle);
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
  return true;
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

function makeView(databaseId: string, view: Record<string, unknown>, position: number): DatabaseView {
  const created = nowIso();
  return {
    id: typeof view.id === "string" ? view.id : newId(),
    database_id: databaseId,
    name: typeof view.name === "string" ? view.name : "Table View",
    type: typeof view.type === "string" ? (view.type as DatabaseView["type"]) : "table",
    config:
      view.config && typeof view.config === "object"
        ? (view.config as DatabaseView["config"])
        : {},
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
    const views =
      options.views?.length
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
  const views =
    options.views?.length
      ? options.views.map((view, index) => {
          const config =
            view.type === "board" && !view.config
              ? { groupByPropertyId: statusPropId }
              : (view.config ?? {});
          return makeView(databaseId, { ...view, config }, index);
        })
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

export const useDatabaseStore: UseBoundStore<StoreApi<DatabaseState>> = create<DatabaseState>()((set, get) => ({
  databases: {},
  loadingIds: new Set(),
  activeViewIds: {},

  loadDatabase: async (id: string) => {
    const diskWorkspace = await isDiskWorkspace();
    const { loadingIds, databases } = get();
    // Return cached if available
    if (!diskWorkspace && databases[id]) return databases[id];
    // Prevent duplicate loads
    if (loadingIds.has(id)) return null;

    set({ loadingIds: new Set([...loadingIds, id]) });
    if (diskWorkspace) {
      try {
        const { useFileStore } = await import("@/stores/file-store");
        const { createStorageAdapter } = await import("@/lib/storage");
        const fileState = useFileStore.getState();
        const file = fileState.files.find((item) => item.id === fileState.currentFileId);
        let hydrated: DatabaseData | null = null;
        if (file && fileState.workspaceRoot) {
          const adapter = createStorageAdapter({
            mode: "disk",
            disk: { root: fileState.workspaceRoot },
          });
          const content = await adapter.read(file.storageHandle ?? { mode: "disk", id: file.id });
          const diskDatabases = databaseExtrasFromUnknown(content.extras);
          hydrateDatabasesFromExtras(content.extras);
          hydrated = diskDatabases[id] ?? null;
        }
        set((state) => ({
          loadingIds: new Set([...state.loadingIds].filter((x) => x !== id)),
        }));
        return hydrated;
      } catch {
        set((state) => ({
          loadingIds: new Set([...state.loadingIds].filter((x) => x !== id)),
        }));
        return null;
      }
    }

    try {
      const data = await api.getDatabase(id);
      set((state) => ({
        databases: { ...state.databases, [id]: data },
        loadingIds: new Set([...state.loadingIds].filter((x) => x !== id)),
        activeViewIds: {
          ...state.activeViewIds,
          // Default to first view if not set
          [id]: state.activeViewIds[id] || (data.views[0]?.id ?? ""),
        },
      }));

      // Load first page of rows; more loaded on-demand via loadMoreRows
      if (data.row_count && data.row_count > 0) {
        await loadInitialRows(id, set);
      }

      return data;
    } catch {
      set((state) => ({
        loadingIds: new Set([...state.loadingIds].filter((x) => x !== id)),
      }));
      return null;
    }
  },

  createDatabase: async (options?: CreateDatabaseRequest) => {
    if (await isDiskWorkspace()) {
      const data = createLocalDatabase(options);
      set((state) => ({
        databases: { ...state.databases, [data.id]: data },
        activeViewIds: {
          ...state.activeViewIds,
          [data.id]: data.views[0]?.id ?? "",
        },
      }));
      await persistCurrentDiskDatabases(useDatabaseStore.getState(), [data.id]);
      return data;
    }

    const data = await api.createDatabase(options);

    // Store metadata immediately
    set((state) => ({
      databases: { ...state.databases, [data.id]: data },
      activeViewIds: {
        ...state.activeViewIds,
        [data.id]: data.views[0]?.id ?? "",
      },
    }));

    // If rows were omitted (large import), load first page
    if (data.row_count && data.rows.length === 0) {
      await loadInitialRows(data.id, set);
    }

    return data;
  },

  updateDatabase: async (id, updates) => {
    const prev = get().databases[id];
    // Optimistic update
    set((state) => {
      const db = state.databases[id];
      if (!db) return state;
      return {
        databases: { ...state.databases, [id]: { ...db, ...updates } },
      };
    });
    try {
      if (await persistCurrentDiskDatabases(useDatabaseStore.getState(), [id])) return;
      await api.updateDatabase(id, updates);
      // Success -- optimistic state is correct, no replacement needed
    } catch {
      // Targeted rollback: only revert the specific fields we changed
      if (prev) {
        set((state) => {
          const db = state.databases[id];
          if (!db) return state;
          const reverted: Partial<DatabaseData> = {};
          if ("title" in updates) reverted.title = prev.title;
          if ("icon" in updates) reverted.icon = prev.icon;
          return { databases: { ...state.databases, [id]: { ...db, ...reverted } } };
        });
      }
    }
  },

  deleteDatabase: async (id) => {
    const prev = get().databases[id];
    set((state) => {
      const { [id]: _, ...rest } = state.databases;
      return { databases: rest };
    });
    try {
      if (await persistCurrentDiskDatabases(useDatabaseStore.getState())) {
        eventBus.emit("database:deleted", { databaseId: id });
        return;
      }
      await api.deleteDatabase(id);
      eventBus.emit("database:deleted", { databaseId: id });
    } catch {
      if (prev) set((state) => ({ databases: { ...state.databases, [id]: prev } }));
    }
  },

  // Property actions
  addProperty: async (dbId, body) => {
    if (await isDiskWorkspace()) {
      set((state) => {
        const db = state.databases[dbId];
        if (!db) return state;
        const newProp: PropertyDef = {
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
              properties_schema: [...db.properties_schema, newProp],
              updated_at: nowIso(),
            },
          },
        };
      });
      await persistCurrentDiskDatabases(useDatabaseStore.getState(), [dbId]);
      return;
    }

    const prevPropIds = new Set(get().databases[dbId]?.properties_schema.map((p) => p.id) ?? []);
    const data = await api.addDatabaseProperty(dbId, body);
    // Merge: add only the new property to current state
    set((state) => {
      const db = state.databases[dbId];
      if (!db) return state;
      const newProp = data.properties_schema.find((p) => !prevPropIds.has(p.id));
      if (!newProp) return state;
      return {
        databases: {
          ...state.databases,
          [dbId]: {
            ...db,
            properties_schema: [...db.properties_schema, newProp],
          },
        },
      };
    });
  },

  updateProperty: async (dbId, propId, body) => {
    if (await isDiskWorkspace()) {
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
      await persistCurrentDiskDatabases(useDatabaseStore.getState(), [dbId]);
      return;
    }

    const data = await api.updateDatabaseProperty(dbId, propId, body);
    // Merge: update only the changed property
    set((state) => {
      const db = state.databases[dbId];
      if (!db) return state;
      const updatedProp = data.properties_schema.find((p) => p.id === propId);
      if (!updatedProp) return state;
      return {
        databases: {
          ...state.databases,
          [dbId]: {
            ...db,
            properties_schema: db.properties_schema.map((p) => (p.id === propId ? updatedProp : p)),
          },
        },
      };
    });
  },

  deleteProperty: async (dbId, propId) => {
    const prevDb = get().databases[dbId];
    const deletedProp = prevDb?.properties_schema.find((p) => p.id === propId);
    // Optimistic: remove property immediately
    set((state) => {
      const db = state.databases[dbId];
      if (!db) return state;
      return {
        databases: {
          ...state.databases,
          [dbId]: {
            ...db,
            properties_schema: db.properties_schema.filter((p) => p.id !== propId),
            rows: db.rows.map((r) => {
              const { [propId]: _, ...rest } = r.properties;
              return { ...r, properties: rest };
            }),
          },
        },
      };
    });
    try {
      if (await persistCurrentDiskDatabases(useDatabaseStore.getState(), [dbId])) return;
      await api.deleteDatabaseProperty(dbId, propId);
      // Success -- optimistic state is correct
    } catch {
      // Targeted rollback: re-insert the deleted property and restore row values
      if (prevDb && deletedProp) {
        set((state) => {
          const db = state.databases[dbId];
          if (!db) return state;
          const schema = [...db.properties_schema];
          const insertIdx = Math.min(deletedProp.position, schema.length);
          schema.splice(insertIdx, 0, deletedProp);
          const prevRowMap = new Map(prevDb.rows.map((r) => [r.id, r]));
          const rows = db.rows.map((r) => {
            const prevRow = prevRowMap.get(r.id);
            const restoredValue = prevRow?.properties[propId];
            return restoredValue !== undefined
              ? { ...r, properties: { ...r.properties, [propId]: restoredValue } }
              : r;
          });
          return {
            databases: {
              ...state.databases,
              [dbId]: { ...db, properties_schema: schema, rows },
            },
          };
        });
      }
    }
  },

  reorderProperties: async (dbId, propertyIds) => {
    const prevSchema = get().databases[dbId]?.properties_schema;
    // Optimistic: reorder immediately
    set((state) => {
      const db = state.databases[dbId];
      if (!db) return state;
      const ordered = propertyIds
        .map((id) => db.properties_schema.find((p) => p.id === id))
        .filter(Boolean) as typeof db.properties_schema;
      return {
        databases: {
          ...state.databases,
          [dbId]: { ...db, properties_schema: ordered },
        },
      };
    });
    try {
      if (await persistCurrentDiskDatabases(useDatabaseStore.getState(), [dbId])) return;
      await api.reorderDatabaseProperties(dbId, propertyIds);
      // Success -- optimistic state is correct
    } catch {
      // Targeted rollback: restore schema order
      if (prevSchema) {
        set((state) => {
          const db = state.databases[dbId];
          if (!db) return state;
          return {
            databases: { ...state.databases, [dbId]: { ...db, properties_schema: prevSchema } },
          };
        });
      }
    }
  },

  // Row actions
  loadMoreRows: async (dbId: string) => {
    if (await isDiskWorkspace()) return;

    const db = get().databases[dbId];
    if (!db || !db.hasMoreRows || _loadingMoreIds.has(dbId)) return;
    _loadingMoreIds.add(dbId);
    try {
      const offset = db.rows.length;
      const page = await api.getDatabaseRows(dbId, { limit: 500, offset });
      set((state) => {
        const current = state.databases[dbId];
        if (!current) return state;
        return {
          databases: {
            ...state.databases,
            [dbId]: {
              ...current,
              rows: [...current.rows, ...page.rows],
              hasMoreRows: page.has_more,
            },
          },
        };
      });
    } finally {
      _loadingMoreIds.delete(dbId);
    }
  },

  addRow: async (dbId, body) => {
    if (await isDiskWorkspace()) {
      set((state) => {
        const db = state.databases[dbId];
        if (!db) return state;
        const maxPos = db.rows.reduce((max, r) => Math.max(max, r.position), -1);
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
      await persistCurrentDiskDatabases(useDatabaseStore.getState(), [dbId]);
      return;
    }

    try {
      const data = await api.addDatabaseRow(dbId, body);
      set((state) => {
        if (!state.databases[dbId]) return state;
        return {
          databases: {
            ...state.databases,
            [dbId]: { ...data, hasMoreRows: false },
          },
        };
      });
    } catch (error) {
      console.error("Failed to add database row", error);
    }
  },

  duplicateRow: async (dbId, rowId) => {
    const db = get().databases[dbId];
    const sourceRow = db?.rows.find((r) => r.id === rowId);
    if (!sourceRow || !db) return;
    // Copy all properties from the source row (excluding page_file_id)
    await get().addRow(dbId, { properties: { ...sourceRow.properties } });
  },

  updateRow: async (dbId, rowId, properties) => {
    // Snapshot only the affected property keys for targeted rollback
    const prevRow = get().databases[dbId]?.rows.find((r) => r.id === rowId);
    const prevProperties: RowProperties = {};
    if (prevRow) {
      for (const key of Object.keys(properties)) {
        prevProperties[key] = prevRow.properties[key] ?? null;
      }
    }
    // Optimistic: update the row
    set((state) => {
      const db = state.databases[dbId];
      if (!db) return state;
      const updatedRows = db.rows.map((r) =>
        r.id === rowId ? { ...r, properties: { ...r.properties, ...properties } } : r
      );
      return {
        databases: {
          ...state.databases,
          [dbId]: { ...db, rows: updatedRows },
        },
      };
    });
    try {
      if (rowId.startsWith("temp-")) return;
      if (await persistCurrentDiskDatabases(useDatabaseStore.getState(), [dbId])) return;
      await api.updateDatabaseRow(dbId, rowId, { properties });
      // Success -- optimistic state is correct
    } catch {
      // Targeted rollback: only revert the specific properties we changed
      set((state) => {
        const db = state.databases[dbId];
        if (!db) return state;
        const rows = db.rows.map((r) =>
          r.id === rowId ? { ...r, properties: { ...r.properties, ...prevProperties } } : r
        );
        return { databases: { ...state.databases, [dbId]: { ...db, rows } } };
      });
    }
  },

  deleteRow: async (dbId, rowId) => {
    const deletedRow = get().databases[dbId]?.rows.find((r) => r.id === rowId);
    // Optimistic: remove row
    set((state) => {
      const db = state.databases[dbId];
      if (!db) return state;
      return {
        databases: {
          ...state.databases,
          [dbId]: {
            ...db,
            rows: db.rows.filter((r) => r.id !== rowId),
            row_count: Math.max(0, (db.row_count ?? db.rows.length) - 1),
            updated_at: nowIso(),
          },
        },
      };
    });
    // Temp rows only exist locally -- no API call needed
    if (rowId.startsWith("temp-")) return;
    try {
      if (await persistCurrentDiskDatabases(useDatabaseStore.getState(), [dbId])) return;
      await api.deleteDatabaseRow(dbId, rowId);
      // Success -- optimistic state is correct
    } catch {
      // Targeted rollback: re-insert the deleted row
      if (deletedRow) {
        set((state) => {
          const db = state.databases[dbId];
          if (!db) return state;
          const rows = [...db.rows, deletedRow].sort((a, b) => a.position - b.position);
          return { databases: { ...state.databases, [dbId]: { ...db, rows } } };
        });
      }
    }
  },

  reorderRows: async (dbId, rowIds) => {
    if (await isDiskWorkspace()) {
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
      await persistCurrentDiskDatabases(useDatabaseStore.getState(), [dbId]);
      return;
    }

    const data = await api.reorderDatabaseRows(dbId, rowIds);
    // Merge: only update positions from server response
    set((state) => {
      const db = state.databases[dbId];
      if (!db) return state;
      const positionMap = new Map(data.rows.map((r) => [r.id, r.position]));
      const rows = db.rows.map((r) => {
        const newPos = positionMap.get(r.id);
        return newPos != null ? { ...r, position: newPos } : r;
      });
      return { databases: { ...state.databases, [dbId]: { ...db, rows } } };
    });
  },

  // View actions
  setActiveView: (dbId, viewId) => {
    set((state) => ({
      activeViewIds: { ...state.activeViewIds, [dbId]: viewId },
    }));
  },

  createView: async (dbId, body) => {
    if (await isDiskWorkspace()) {
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
      await persistCurrentDiskDatabases(useDatabaseStore.getState(), [dbId]);
      return;
    }

    const prevViewIds = new Set(get().databases[dbId]?.views.map((v) => v.id) ?? []);
    const data = await api.createDatabaseView(dbId, body);
    // Merge: add only the new view
    const newView = data.views.find((v) => !prevViewIds.has(v.id));
    if (newView) {
      set((state) => {
        const db = state.databases[dbId];
        if (!db) return state;
        return {
          databases: {
            ...state.databases,
            [dbId]: { ...db, views: [...db.views, newView] },
          },
          activeViewIds: { ...state.activeViewIds, [dbId]: newView.id },
        };
      });
    }
  },

  updateView: async (dbId, viewId, body) => {
    const prevView = get().databases[dbId]?.views.find((v) => v.id === viewId);
    // Optimistic: merge view config immediately
    set((state) => {
      const db = state.databases[dbId];
      if (!db) return state;
      return {
        databases: {
          ...state.databases,
          [dbId]: {
            ...db,
            views: db.views.map((v) =>
              v.id === viewId
                ? {
                    ...v,
                    ...(body.name != null ? { name: body.name } : {}),
                    config: { ...v.config, ...(body.config ?? {}) },
                  }
                : v
            ),
          },
        },
      };
    });
    try {
      if (await persistCurrentDiskDatabases(useDatabaseStore.getState(), [dbId])) return;
      await api.updateDatabaseView(dbId, viewId, body);
      // Success -- optimistic state is correct
    } catch {
      // Targeted rollback: restore this view to its previous state
      if (prevView) {
        set((state) => {
          const db = state.databases[dbId];
          if (!db) return state;
          return {
            databases: {
              ...state.databases,
              [dbId]: {
                ...db,
                views: db.views.map((v) => (v.id === viewId ? prevView : v)),
              },
            },
          };
        });
      }
    }
  },

  deleteView: async (dbId, viewId) => {
    const deletedView = get().databases[dbId]?.views.find((v) => v.id === viewId);
    // Optimistic: remove view immediately
    set((state) => {
      const db = state.databases[dbId];
      if (!db) return state;
      const remaining = db.views.filter((v) => v.id !== viewId);
      const updates: Partial<DatabaseState> = {
        databases: {
          ...state.databases,
          [dbId]: { ...db, views: remaining },
        },
      };
      if (state.activeViewIds[dbId] === viewId && remaining.length > 0) {
        updates.activeViewIds = {
          ...state.activeViewIds,
          [dbId]: remaining[0].id,
        };
      }
      return updates;
    });
    try {
      if (await persistCurrentDiskDatabases(useDatabaseStore.getState(), [dbId])) return;
      await api.deleteDatabaseView(dbId, viewId);
      // Success -- optimistic state is correct
    } catch {
      // Targeted rollback: re-insert the deleted view
      if (deletedView) {
        set((state) => {
          const db = state.databases[dbId];
          if (!db) return state;
          return {
            databases: {
              ...state.databases,
              [dbId]: {
                ...db,
                views: [...db.views, deletedView].sort((a, b) => a.position - b.position),
              },
            },
          };
        });
      }
    }
  },
}));
