/**
 * Zustand store for database block state management.
 *
 * Caches loaded databases in memory with optimistic update pattern.
 * API responses are merged surgically (never full-replace) so that
 * concurrent operations don't overwrite each other's optimistic state.
 */

import { create } from "zustand";
import { api } from "@/lib/api";
import { eventBus } from "@/lib/events";
import type {
  DatabaseData,
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

export const useDatabaseStore = create<DatabaseState>()((set, get) => ({
  databases: {},
  loadingIds: new Set(),
  activeViewIds: {},

  loadDatabase: async (id: string) => {
    const { loadingIds, databases } = get();
    // Return cached if available
    if (databases[id]) return databases[id];
    // Prevent duplicate loads
    if (loadingIds.has(id)) return null;

    set({ loadingIds: new Set([...loadingIds, id]) });
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
      await api.deleteDatabase(id);
      eventBus.emit("database:deleted", { databaseId: id });
    } catch {
      if (prev) set((state) => ({ databases: { ...state.databases, [id]: prev } }));
    }
  },

  // Property actions
  addProperty: async (dbId, body) => {
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
    const tempId = `temp-${Date.now()}`;
    // Optimistic: add a temporary row
    set((state) => {
      const db = state.databases[dbId];
      if (!db) return state;
      const maxPos = db.rows.reduce((max, r) => Math.max(max, r.position), 0);
      const tempRow: DatabaseData["rows"][number] = {
        id: tempId,
        database_id: dbId,
        properties: body?.properties ?? {},
        position: maxPos + 1,
        page_file_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      return {
        databases: {
          ...state.databases,
          [dbId]: { ...db, rows: [...db.rows, tempRow] },
        },
      };
    });
    try {
      const data = await api.addDatabaseRow(dbId, body);
      // Merge: replace the temp row with the real server row.
      // Derive known real IDs from current state (exclude all temp-* rows)
      // so concurrent addRow calls each find their own new server row.
      set((state) => {
        const db = state.databases[dbId];
        if (!db) return state;
        const currentRealIds = new Set(
          db.rows.filter((r) => !r.id.startsWith("temp-")).map((r) => r.id)
        );
        const newRealRow = data.rows.find((r) => !currentRealIds.has(r.id));
        if (!newRealRow) return state;
        return {
          databases: {
            ...state.databases,
            [dbId]: {
              ...db,
              rows: db.rows.map((r) => (r.id === tempId ? newRealRow : r)),
            },
          },
        };
      });
    } catch {
      // Targeted rollback: remove the temp row
      set((state) => {
        const db = state.databases[dbId];
        if (!db) return state;
        return {
          databases: {
            ...state.databases,
            [dbId]: { ...db, rows: db.rows.filter((r) => r.id !== tempId) },
          },
        };
      });
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
          [dbId]: { ...db, rows: db.rows.filter((r) => r.id !== rowId) },
        },
      };
    });
    // Temp rows only exist locally -- no API call needed
    if (rowId.startsWith("temp-")) return;
    try {
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
