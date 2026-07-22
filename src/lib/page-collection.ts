import {
  evaluatePageComputedProperties,
  validatePageComputedPropertiesDefinition,
  type PageComputedPropertiesDefinition,
  type PageComputedPropertyDiagnostic,
  type PageComputedRelationTarget,
} from "@/lib/page-computed-properties";

export type PageCollectionPropertyValue = string | number | boolean | string[];

export interface PageCollectionCatalogRow {
  id: string;
  path: string;
  title: string;
  aliases?: string[];
  properties: Record<string, PageCollectionPropertyValue>;
}

export interface PageCollectionEqualsFilter {
  property: string;
  operator: "equals";
  value: PageCollectionPropertyValue;
}

export interface PageCollectionContainsFilter {
  property: string;
  operator: "contains";
  value: string;
}

export interface PageCollectionExistsFilter {
  property: string;
  operator: "exists";
}

export type PageCollectionFilter =
  PageCollectionEqualsFilter | PageCollectionContainsFilter | PageCollectionExistsFilter;

export interface PageCollectionSort {
  property: string;
  direction: "asc" | "desc";
}

interface PageCollectionQueryDefinition {
  filters: PageCollectionFilter[];
  columns: string[];
  sort: PageCollectionSort[];
}

export interface PageCollectionV1TableDefinition extends PageCollectionQueryDefinition {
  version: 1;
  view: "table";
}

export interface PageCollectionV2TableDefinition extends PageCollectionQueryDefinition {
  version: 2;
  view: "table";
  computed?: PageComputedPropertiesDefinition;
}

export interface PageCollectionV2BoardDefinition extends PageCollectionQueryDefinition {
  version: 2;
  view: "board";
  groupBy: string;
  computed?: PageComputedPropertiesDefinition;
}

export interface PageCollectionV2CalendarDefinition extends PageCollectionQueryDefinition {
  version: 2;
  view: "calendar";
  dateBy: string;
  computed?: PageComputedPropertiesDefinition;
}

export type PageCollectionDefinition =
  | PageCollectionV1TableDefinition
  | PageCollectionV2TableDefinition
  | PageCollectionV2BoardDefinition
  | PageCollectionV2CalendarDefinition;

export interface PageCollectionDiagnostic {
  code: "invalid-fence" | "invalid-json" | "invalid-definition";
  message: string;
}

export type PageCollectionParseResult =
  | { ok: true; definition: PageCollectionDefinition }
  | { ok: false; diagnostics: [PageCollectionDiagnostic] };

export interface PageCollectionTableProjection {
  view: "table";
  rows: PageCollectionCatalogRow[];
  computedDiagnostics?: PageComputedPropertyDiagnostic[];
  relationNavigation?: PageCollectionRelationNavigation[];
}

export interface PageCollectionRelationNavigation {
  rowId: string;
  rowPath: string;
  relations: Record<string, PageComputedRelationTarget[]>;
}

export interface PageCollectionBoardColumn {
  key: string;
  value: PageCollectionPropertyValue | null;
  rows: PageCollectionCatalogRow[];
}

export interface PageCollectionBoardProjection {
  view: "board";
  groupBy: string;
  rows: PageCollectionCatalogRow[];
  columns: PageCollectionBoardColumn[];
  computedDiagnostics?: PageComputedPropertyDiagnostic[];
  relationNavigation?: PageCollectionRelationNavigation[];
}

export interface PageCollectionCalendarDay {
  date: string;
  rows: PageCollectionCatalogRow[];
}

export interface PageCollectionCalendarProjection {
  view: "calendar";
  dateBy: string;
  rows: PageCollectionCatalogRow[];
  days: PageCollectionCalendarDay[];
  unscheduled: {
    key: "unscheduled";
    rows: PageCollectionCatalogRow[];
  };
  computedDiagnostics?: PageComputedPropertyDiagnostic[];
  relationNavigation?: PageCollectionRelationNavigation[];
}

export type PageCollectionProjection =
  PageCollectionTableProjection | PageCollectionBoardProjection | PageCollectionCalendarProjection;

const PROPERTY_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const QUERY_DEFINITION_KEYS = ["version", "view", "filters", "columns", "sort"] as const;

/** Property names shared by Collection filters, columns, and sorting. */
export function isPageCollectionPropertyKey(value: unknown): value is string {
  return typeof value === "string" && value !== "id" && PROPERTY_KEY_PATTERN.test(value);
}

/** Parse one complete portable `doxmind-collection` fenced block. */
export function parsePageCollection(source: string): PageCollectionParseResult {
  const match = /^```doxmind-collection\r?\n([\s\S]*?)\r?\n```(?:\r?\n)?$/.exec(source);
  if (!match) {
    if (!source.startsWith("```doxmind-collection")) {
      return invalid(
        "invalid-fence",
        "Collection source must be fenced with an exact ```doxmind-collection opening fence."
      );
    }
    if (/\r?\n```(?:\r?\n)/.test(source)) {
      return invalid("invalid-fence", "Collection source has content after the closing fence.");
    }
    return invalid("invalid-fence", "Collection source must contain a complete fenced block.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1] ?? "");
  } catch {
    return invalid("invalid-json", "Collection fence body must be valid JSON.");
  }

  const diagnostic = validateDefinition(parsed);
  if (diagnostic) return invalid("invalid-definition", diagnostic);
  return { ok: true, definition: parsed as PageCollectionDefinition };
}

/**
 * Evaluate a validated Collection definition as a zero-write derived view.
 * Results are deterministic: filters are ANDed, missing sort values stay last,
 * and normalized path plus id provide the final tie-break.
 */
export function evaluatePageCollection(
  definition: PageCollectionDefinition,
  catalog: readonly PageCollectionCatalogRow[]
): PageCollectionCatalogRow[] {
  return queryPageCollection(definition, prepareCollectionCatalog(definition, catalog).rows);
}

function queryPageCollection(
  definition: PageCollectionDefinition,
  catalog: readonly PageCollectionCatalogRow[]
): PageCollectionCatalogRow[] {
  return catalog
    .filter((row) => definition.filters.every((filter) => matchesFilter(row, filter)))
    .slice()
    .sort((left, right) => compareRows(left, right, definition.sort));
}

/** Query once, then expose the portable view without replacing the source Page rows. */
export function projectPageCollection(
  definition: PageCollectionDefinition,
  catalog: readonly PageCollectionCatalogRow[]
): PageCollectionProjection {
  const prepared = prepareCollectionCatalog(definition, catalog);
  const rows = queryPageCollection(definition, prepared.rows);
  const computedProjection = projectComputedMetadata(prepared, rows);
  if (definition.view === "table") return { view: "table", rows, ...computedProjection };
  if (definition.view === "board") {
    return {
      view: "board",
      groupBy: definition.groupBy,
      rows,
      columns: projectBoardColumns(rows, definition.groupBy),
      ...computedProjection,
    };
  }
  const { days, unscheduled } = projectCalendarDays(rows, definition.dateBy);
  return {
    view: "calendar",
    dateBy: definition.dateBy,
    rows,
    days,
    unscheduled: { key: "unscheduled", rows: unscheduled },
    ...computedProjection,
  };
}

interface PreparedCollectionCatalog {
  rows: readonly PageCollectionCatalogRow[];
  computedDiagnostics?: PageComputedPropertyDiagnostic[];
  relationNavigationByRow?: Map<string, PageCollectionRelationNavigation>;
}

function prepareCollectionCatalog(
  definition: PageCollectionDefinition,
  catalog: readonly PageCollectionCatalogRow[]
): PreparedCollectionCatalog {
  if (definition.version !== 2 || definition.computed === undefined) return { rows: catalog };

  const computed = evaluatePageComputedProperties(
    definition.computed,
    catalog.map((row) => ({ ...row, aliases: row.aliases ?? [] }))
  );
  const sourceRows = new Map(catalog.map((row) => [collectionRowIdentity(row), row]));
  const rows = computed.rows.map((row) => {
    const source = sourceRows.get(collectionRowIdentity(row)) as PageCollectionCatalogRow;
    return {
      ...source,
      properties: { ...row.sourceProperties, ...row.derivedProperties },
    };
  });
  const relationNavigationByRow = new Map(
    computed.rows.map((row) => [
      collectionRowIdentity(row),
      {
        rowId: row.id,
        rowPath: row.path,
        relations: row.relations,
      },
    ])
  );
  return {
    rows,
    computedDiagnostics: computed.diagnostics,
    relationNavigationByRow,
  };
}

function projectComputedMetadata(
  prepared: PreparedCollectionCatalog,
  rows: readonly PageCollectionCatalogRow[]
): Pick<PageCollectionTableProjection, "computedDiagnostics" | "relationNavigation"> {
  if (!prepared.computedDiagnostics || !prepared.relationNavigationByRow) return {};
  const visibleRows = new Set(rows.map(collectionRowIdentity));
  return {
    computedDiagnostics: prepared.computedDiagnostics.filter((diagnostic) =>
      visibleRows.has(collectionRowIdentity({ id: diagnostic.rowId, path: diagnostic.rowPath }))
    ),
    relationNavigation: rows.flatMap((row) => {
      const navigation = prepared.relationNavigationByRow?.get(collectionRowIdentity(row));
      return navigation ? [navigation] : [];
    }),
  };
}

function collectionRowIdentity(row: Pick<PageCollectionCatalogRow, "id" | "path">): string {
  return `${row.path}\0${row.id}`;
}

function projectBoardColumns(
  rows: readonly PageCollectionCatalogRow[],
  groupBy: string
): PageCollectionBoardColumn[] {
  const grouped = new Map<
    string,
    { key: string; value: PageCollectionPropertyValue; rows: PageCollectionCatalogRow[] }
  >();
  const missing: PageCollectionCatalogRow[] = [];
  for (const row of rows) {
    const value = readProperty(row, groupBy);
    if (value === undefined) {
      missing.push(row);
      continue;
    }
    const key = boardColumnKey(value);
    const column = grouped.get(key) ?? { key, value, rows: [] };
    column.rows.push(row);
    grouped.set(key, column);
  }

  const columns: PageCollectionBoardColumn[] = [...grouped.values()].sort((left, right) =>
    comparePropertyValues(left.value, right.value)
  );
  if (missing.length > 0) columns.push({ key: "missing", value: null, rows: missing });
  return columns;
}

function boardColumnKey(value: PageCollectionPropertyValue): string {
  return `${Array.isArray(value) ? "strings" : typeof value}:${JSON.stringify(value)}`;
}

function projectCalendarDays(
  rows: readonly PageCollectionCatalogRow[],
  dateBy: string
): { days: PageCollectionCalendarDay[]; unscheduled: PageCollectionCatalogRow[] } {
  const grouped = new Map<string, PageCollectionCatalogRow[]>();
  const unscheduled: PageCollectionCatalogRow[] = [];
  for (const row of rows) {
    const value = readProperty(row, dateBy);
    if (typeof value !== "string" || !isCalendarDate(value)) {
      unscheduled.push(row);
      continue;
    }
    const dayRows = grouped.get(value) ?? [];
    dayRows.push(row);
    grouped.set(value, dayRows);
  }
  return {
    days: [...grouped.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([date, dayRows]) => ({ date, rows: dayRows })),
    unscheduled,
  };
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (daysInMonth[month - 1] ?? 0);
}

function validateDefinition(value: unknown): string | null {
  if (!isPlainObject(value)) return "definition must be a JSON object.";
  if (value.version !== 1 && value.version !== 2) {
    return "definition.version must be exactly 1 or 2.";
  }
  if (value.version === 1 && value.view !== "table") {
    return 'definition.view must be exactly "table" for Collection v1.';
  }
  if (
    value.version === 2 &&
    value.view !== "table" &&
    value.view !== "board" &&
    value.view !== "calendar"
  ) {
    return "definition.view must be table, board, or calendar for Collection v2.";
  }

  const viewKeys =
    value.version === 2 && value.view === "board"
      ? ["groupBy"]
      : value.version === 2 && value.view === "calendar"
        ? ["dateBy"]
        : [];
  const allowed = new Set<string>([
    ...QUERY_DEFINITION_KEYS,
    ...viewKeys,
    ...(value.version === 2 ? ["computed"] : []),
  ]);
  const unknownKey = Object.keys(value).find((key) => !allowed.has(key));
  if (unknownKey) {
    return `definition.${unknownKey} is not part of Collection v${value.version} ${value.view}.`;
  }
  const requiredKeys = [...QUERY_DEFINITION_KEYS, ...viewKeys];
  const missingKey = requiredKeys.find((key) => !Object.hasOwn(value, key));
  if (missingKey) return `definition.${missingKey} is required.`;
  if (value.version === 2 && Object.hasOwn(value, "computed")) {
    const computed = validatePageComputedPropertiesDefinition(value.computed);
    if (!computed.ok) {
      return computed.diagnostics[0].message.replace(/^definition/, "definition.computed");
    }
  }
  if (
    value.version === 2 &&
    value.view === "board" &&
    !isPageCollectionPropertyKey(value.groupBy)
  ) {
    return "definition.groupBy must be a legal, non-reserved property key.";
  }
  if (
    value.version === 2 &&
    value.view === "calendar" &&
    !isPageCollectionPropertyKey(value.dateBy)
  ) {
    return "definition.dateBy must be a legal, non-reserved property key.";
  }

  if (!Array.isArray(value.filters)) return "definition.filters must be an array.";
  for (let index = 0; index < value.filters.length; index += 1) {
    const diagnostic = validateFilter(value.filters[index], index);
    if (diagnostic) return diagnostic;
  }

  if (!Array.isArray(value.columns)) return "definition.columns must be an array.";
  const columnKeys = new Set<string>();
  for (let index = 0; index < value.columns.length; index += 1) {
    const column = value.columns[index];
    if (!isPageCollectionPropertyKey(column)) {
      return `definition.columns[${index}] must be a legal, non-reserved property key.`;
    }
    if (columnKeys.has(column)) return `definition.columns[${index}] duplicates ${column}.`;
    columnKeys.add(column);
  }

  if (!Array.isArray(value.sort)) return "definition.sort must be an array.";
  const sortKeys = new Set<string>();
  for (let index = 0; index < value.sort.length; index += 1) {
    const diagnostic = validateSort(value.sort[index], index, value.version);
    if (diagnostic) return diagnostic;
    const property = (value.sort[index] as { property: string }).property;
    if (sortKeys.has(property)) return `definition.sort[${index}] duplicates ${property}.`;
    sortKeys.add(property);
  }
  return null;
}

function validateFilter(value: unknown, index: number): string | null {
  const path = `definition.filters[${index}]`;
  if (!isPlainObject(value)) return `${path} must be a JSON object.`;
  if (!isPageCollectionPropertyKey(value.property)) {
    return `${path}.property must be a legal, non-reserved property key.`;
  }
  if (value.operator !== "equals" && value.operator !== "contains" && value.operator !== "exists") {
    return `${path}.operator must be equals, contains, or exists.`;
  }

  const expectedKeys =
    value.operator === "exists"
      ? new Set(["property", "operator"])
      : new Set(["property", "operator", "value"]);
  const unknownKey = Object.keys(value).find((key) => !expectedKeys.has(key));
  if (unknownKey) return `${path}.${unknownKey} is not valid for ${value.operator}.`;
  const missingKey = [...expectedKeys].find((key) => !Object.hasOwn(value, key));
  if (missingKey) return `${path}.${missingKey} is required for ${value.operator}.`;

  if (value.operator === "contains") {
    return typeof value.value === "string" ? null : `${path}.value must be a string for contains.`;
  }
  if (value.operator === "equals" && !isPropertyValue(value.value)) {
    return `${path}.value must be a string, finite number, boolean, or string array.`;
  }
  return null;
}

function validateSort(value: unknown, index: number, version: 1 | 2): string | null {
  const path = `definition.sort[${index}]`;
  if (!isPlainObject(value)) return `${path} must be a JSON object.`;
  const expectedKeys = new Set(["property", "direction"]);
  const unknownKey = Object.keys(value).find((key) => !expectedKeys.has(key));
  if (unknownKey) return `${path}.${unknownKey} is not part of Collection v${version}.`;
  const missingKey = [...expectedKeys].find((key) => !Object.hasOwn(value, key));
  if (missingKey) return `${path}.${missingKey} is required.`;
  if (!isPageCollectionPropertyKey(value.property)) {
    return `${path}.property must be a legal, non-reserved property key.`;
  }
  if (value.direction !== "asc" && value.direction !== "desc") {
    return `${path}.direction must be asc or desc.`;
  }
  return null;
}

function matchesFilter(row: PageCollectionCatalogRow, filter: PageCollectionFilter): boolean {
  const value = readProperty(row, filter.property);
  if (filter.operator === "exists") return value !== undefined;
  if (value === undefined) return false;
  if (filter.operator === "contains") {
    return typeof value === "string"
      ? value.includes(filter.value)
      : Array.isArray(value) && value.includes(filter.value);
  }
  return equalPropertyValues(value, filter.value);
}

function compareRows(
  left: PageCollectionCatalogRow,
  right: PageCollectionCatalogRow,
  sorts: readonly PageCollectionSort[]
): number {
  for (const sort of sorts) {
    const leftValue = readProperty(left, sort.property);
    const rightValue = readProperty(right, sort.property);
    if (leftValue === undefined || rightValue === undefined) {
      if (leftValue === undefined && rightValue === undefined) continue;
      return leftValue === undefined ? 1 : -1;
    }
    const compared = comparePropertyValues(leftValue, rightValue);
    if (compared !== 0) return sort.direction === "asc" ? compared : -compared;
  }
  return compareText(left.path, right.path) || compareText(left.id, right.id);
}

function readProperty(
  row: PageCollectionCatalogRow,
  property: string
): PageCollectionPropertyValue | undefined {
  if (!Object.hasOwn(row.properties, property)) return undefined;
  const value: unknown = row.properties[property];
  return isPropertyValue(value) ? value : undefined;
}

function isPropertyValue(value: unknown): value is PageCollectionPropertyValue {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (Array.isArray(value) && value.every((item) => typeof item === "string"))
  );
}

function equalPropertyValues(
  left: PageCollectionPropertyValue,
  right: PageCollectionPropertyValue
): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => value === right[index])
    );
  }
  return left === right;
}

function comparePropertyValues(
  left: PageCollectionPropertyValue,
  right: PageCollectionPropertyValue
): number {
  const leftRank = propertyTypeRank(left);
  const rightRank = propertyTypeRank(right);
  if (leftRank !== rightRank) return leftRank - rightRank;
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const compared = compareText(left[index] ?? "", right[index] ?? "");
      if (compared !== 0) return compared;
    }
    return left.length - right.length;
  }
  return compareText(String(left), String(right));
}

function propertyTypeRank(value: PageCollectionPropertyValue): number {
  if (typeof value === "boolean") return 0;
  if (typeof value === "number") return 1;
  if (typeof value === "string") return 2;
  return 3;
}

function compareText(left: string, right: string): number {
  const foldedLeft = left.toLowerCase();
  const foldedRight = right.toLowerCase();
  if (foldedLeft < foldedRight) return -1;
  if (foldedLeft > foldedRight) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(
  code: PageCollectionDiagnostic["code"],
  message: string
): PageCollectionParseResult {
  return { ok: false, diagnostics: [{ code, message }] };
}
