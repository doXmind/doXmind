/**
 * Shared filter and sort logic for database views.
 * Centralised here so that table, gallery, list, and board views
 * all behave identically.
 */

import type {
  DatabaseData,
  FilterCondition,
  SortCondition,
  PropertyDef,
  PropertyType,
  FilterOperator,
} from "./database-types";

// ---------------------------------------------------------------------------
// Operator → property-type mapping
// ---------------------------------------------------------------------------

const TEXT_OPERATORS: FilterOperator[] = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "is_empty",
  "is_not_empty",
];

const NUMBER_OPERATORS: FilterOperator[] = [
  "equals",
  "not_equals",
  "greater_than",
  "less_than",
  "is_empty",
  "is_not_empty",
];

const SELECT_OPERATORS: FilterOperator[] = ["equals", "not_equals", "is_empty", "is_not_empty"];

const DATE_OPERATORS: FilterOperator[] = [
  "equals",
  "not_equals",
  "before",
  "after",
  "is_empty",
  "is_not_empty",
];

const CHECKBOX_OPERATORS: FilterOperator[] = ["equals", "not_equals"];

const READONLY_OPERATORS: FilterOperator[] = ["before", "after", "is_empty", "is_not_empty"];

/**
 * Return the filter operators that make sense for a given property type.
 */
export function getOperatorsForType(type: PropertyType): FilterOperator[] {
  switch (type) {
    case "text":
    case "url":
    case "email":
    case "phone":
      return TEXT_OPERATORS;
    case "number":
      return NUMBER_OPERATORS;
    case "select":
    case "multi_select":
    case "status":
      return SELECT_OPERATORS;
    case "date":
      return DATE_OPERATORS;
    case "checkbox":
      return CHECKBOX_OPERATORS;
    case "created_time":
    case "updated_time":
      return READONLY_OPERATORS;
    default:
      return TEXT_OPERATORS;
  }
}

/**
 * Return a sensible default operator when the property type changes.
 */
export function getDefaultOperator(type: PropertyType): FilterOperator {
  switch (type) {
    case "checkbox":
      return "equals";
    case "date":
    case "created_time":
    case "updated_time":
      return "is_not_empty";
    default:
      return "contains";
  }
}

/**
 * Whether the operator needs a value input (false for is_empty / is_not_empty).
 */
export function operatorNeedsValue(op: FilterOperator): boolean {
  return op !== "is_empty" && op !== "is_not_empty";
}

// ---------------------------------------------------------------------------
// applyFilters
// ---------------------------------------------------------------------------

export function applyFilters(
  rows: DatabaseData["rows"],
  filters: FilterCondition[],
  _schema?: PropertyDef[]
): DatabaseData["rows"] {
  if (!filters || filters.length === 0) return rows;

  return rows.filter((row) =>
    filters.every((f) => {
      const val = row.properties[f.propertyId];

      switch (f.operator) {
        case "equals":
          if (typeof val === "boolean") return val === (f.value === true || f.value === "true");
          return val === f.value;

        case "not_equals":
          if (typeof val === "boolean") return val !== (f.value === true || f.value === "true");
          return val !== f.value;

        case "contains":
          if (typeof val === "string" && typeof f.value === "string")
            return val.toLowerCase().includes(f.value.toLowerCase());
          if (Array.isArray(val) && typeof f.value === "string")
            return val.some(
              (v) =>
                typeof v === "string" && v.toLowerCase().includes(f.value!.toString().toLowerCase())
            );
          return false;

        case "not_contains":
          if (typeof val === "string" && typeof f.value === "string")
            return !val.toLowerCase().includes(f.value.toLowerCase());
          if (Array.isArray(val) && typeof f.value === "string")
            return !val.some(
              (v) =>
                typeof v === "string" && v.toLowerCase().includes(f.value!.toString().toLowerCase())
            );
          return true;

        case "is_empty":
          return val == null || val === "" || (Array.isArray(val) && val.length === 0);

        case "is_not_empty":
          return val != null && val !== "" && !(Array.isArray(val) && val.length === 0);

        case "greater_than":
          return typeof val === "number" && typeof f.value === "number" && val > f.value;

        case "less_than":
          return typeof val === "number" && typeof f.value === "number" && val < f.value;

        case "before":
          if (typeof val === "string" && typeof f.value === "string") {
            return new Date(val).getTime() < new Date(f.value).getTime();
          }
          return false;

        case "after":
          if (typeof val === "string" && typeof f.value === "string") {
            return new Date(val).getTime() > new Date(f.value).getTime();
          }
          return false;

        default:
          return true;
      }
    })
  );
}

// ---------------------------------------------------------------------------
// applySorts
// ---------------------------------------------------------------------------

export function applySorts(
  rows: DatabaseData["rows"],
  sorts: SortCondition[]
): DatabaseData["rows"] {
  if (!sorts || sorts.length === 0) return rows;

  return [...rows].sort((a, b) => {
    for (const sort of sorts) {
      const aVal = a.properties[sort.propertyId];
      const bVal = b.properties[sort.propertyId];
      let cmp = 0;

      if (aVal == null && bVal == null) cmp = 0;
      else if (aVal == null) cmp = -1;
      else if (bVal == null) cmp = 1;
      else if (typeof aVal === "string" && typeof bVal === "string") cmp = aVal.localeCompare(bVal);
      else if (typeof aVal === "number" && typeof bVal === "number") cmp = aVal - bVal;
      else cmp = String(aVal).localeCompare(String(bVal));

      if (cmp !== 0) return sort.direction === "desc" ? -cmp : cmp;
    }
    return a.position - b.position;
  });
}
