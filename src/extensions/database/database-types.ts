/**
 * TypeScript types for the Notion-style database block system.
 */

// =============================================================================
// Property Types
// =============================================================================

export type PropertyType =
  | "text"
  | "number"
  | "select"
  | "multi_select"
  | "status"
  | "date"
  | "checkbox"
  | "url"
  | "email"
  | "phone"
  | "created_time"
  | "updated_time";

export interface SelectChoice {
  id: string;
  name: string;
  color: string;
}

export interface StatusCategory {
  id: string;
  name: string;
  color: string;
  optionIds: string[];
}

export interface PropertyOptions {
  /** For select/multi_select/status */
  choices?: SelectChoice[];
  /** For status: category groupings */
  statusCategories?: StatusCategory[];
  /** For number */
  format?: "number" | "currency" | "percent";
  /** For date */
  includeTime?: boolean;
  dateFormat?: string;
}

export interface PropertyDef {
  id: string;
  name: string;
  type: PropertyType;
  position: number;
  options?: PropertyOptions;
}

// =============================================================================
// Row & Cell Values
// =============================================================================

/** Map of property_id -> cell value */
export type RowProperties = Record<string, CellValue>;

export type CellValue =
  | string
  | number
  | boolean
  | string[] // multi_select
  | null;

export interface DatabaseRow {
  id: string;
  database_id: string;
  properties: RowProperties;
  position: number;
  page_file_id: string | null;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// View Types
// =============================================================================

export type ViewType = "table" | "board" | "gallery" | "list";

export interface FilterCondition {
  propertyId: string;
  operator: FilterOperator;
  value: CellValue;
}

export type FilterOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "is_empty"
  | "is_not_empty"
  | "greater_than"
  | "less_than"
  | "before"
  | "after";

export interface SortCondition {
  propertyId: string;
  direction: "asc" | "desc";
}

export interface ViewConfig {
  filters?: FilterCondition[];
  sorts?: SortCondition[];
  visibleProperties?: string[];
  propertyWidths?: Record<string, number>;
  /** Board view: which select property to group by */
  groupByPropertyId?: string;
  /** Gallery view: URL property to use as card cover image */
  coverPropertyId?: string;
  /** Gallery view: card size */
  cardSize?: "small" | "medium" | "large";
  /** Table view: per-column calculation type */
  calculations?: Record<string, string>;
}

export interface DatabaseView {
  id: string;
  database_id: string;
  name: string;
  type: ViewType;
  config: ViewConfig;
  position: number;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// Database Block (Top-level)
// =============================================================================

export interface DatabaseData {
  id: string;
  title: string;
  icon: string | null;
  properties_schema: PropertyDef[];
  rows: DatabaseRow[];
  /** Present when rows are omitted from response (large imports). */
  row_count?: number;
  /** True when more rows exist on the server beyond what's loaded. */
  hasMoreRows?: boolean;
  views: DatabaseView[];
  created_at: string;
  updated_at: string;
}

// =============================================================================
// API Request/Response Types
// =============================================================================

export interface CreateDatabaseRequest {
  title?: string;
  properties_schema?: Record<string, unknown>[];
  rows?: { properties: Record<string, CellValue> }[];
  views?: { name: string; type: ViewType; config?: Record<string, unknown> }[];
}

export interface UpdateDatabaseRequest {
  title?: string;
  icon?: string | null;
}

export interface AddPropertyRequest {
  name: string;
  type: PropertyType;
  options?: PropertyOptions;
}

export interface UpdatePropertyRequest {
  name?: string;
  type?: PropertyType;
  options?: PropertyOptions;
}

export interface ReorderPropertiesRequest {
  property_ids: string[];
}

export interface AddRowRequest {
  properties?: RowProperties;
}

export interface UpdateRowRequest {
  properties: RowProperties;
}

export interface ReorderRowsRequest {
  row_ids: string[];
}

export interface CreateViewRequest {
  name: string;
  type: ViewType;
  config?: ViewConfig;
}

export interface UpdateViewRequest {
  name?: string;
  config?: ViewConfig;
}

// =============================================================================
// UI Constants
// =============================================================================

export const READONLY_PROPERTY_TYPES: readonly PropertyType[] = [
  "created_time",
  "updated_time",
] as const;

export const DEFAULT_STATUS_CATEGORIES: StatusCategory[] = [
  { id: "todo", name: "To Do", color: "gray", optionIds: [] },
  { id: "in_progress", name: "In Progress", color: "blue", optionIds: [] },
  { id: "done", name: "Done", color: "green", optionIds: [] },
];

export const SELECT_COLORS = [
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
] as const;

export type SelectColor = (typeof SELECT_COLORS)[number];

export const SELECT_COLOR_CLASSES: Record<SelectColor, { bg: string; text: string }> = {
  gray: { bg: "bg-gray-100 dark:bg-zinc-700", text: "text-gray-700 dark:text-zinc-100" },
  brown: { bg: "bg-amber-100 dark:bg-amber-950/80", text: "text-amber-800 dark:text-amber-100" },
  orange: {
    bg: "bg-orange-100 dark:bg-orange-950/80",
    text: "text-orange-800 dark:text-orange-100",
  },
  yellow: {
    bg: "bg-yellow-100 dark:bg-yellow-950/80",
    text: "text-yellow-800 dark:text-yellow-100",
  },
  green: { bg: "bg-green-100 dark:bg-green-950/80", text: "text-green-800 dark:text-green-100" },
  blue: { bg: "bg-blue-100 dark:bg-blue-950/80", text: "text-blue-800 dark:text-blue-100" },
  purple: {
    bg: "bg-purple-100 dark:bg-purple-950/80",
    text: "text-purple-800 dark:text-purple-100",
  },
  pink: { bg: "bg-pink-100 dark:bg-pink-950/80", text: "text-pink-800 dark:text-pink-100" },
  red: { bg: "bg-red-100 dark:bg-red-950/80", text: "text-red-800 dark:text-red-100" },
};

export const SELECT_COLOR_DOT_CLASSES: Record<SelectColor, string> = {
  gray: "bg-gray-500 dark:bg-zinc-300",
  brown: "bg-amber-600 dark:bg-amber-300",
  orange: "bg-orange-600 dark:bg-orange-300",
  yellow: "bg-yellow-600 dark:bg-yellow-300",
  green: "bg-green-600 dark:bg-green-300",
  blue: "bg-blue-600 dark:bg-blue-300",
  purple: "bg-purple-600 dark:bg-purple-300",
  pink: "bg-pink-600 dark:bg-pink-300",
  red: "bg-red-600 dark:bg-red-300",
};

export const DEFAULT_COLUMN_WIDTH = 180;
export const MIN_COLUMN_WIDTH = 100;
export const MAX_COLUMN_WIDTH = 500;
