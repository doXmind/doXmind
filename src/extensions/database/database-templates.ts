/**
 * Database template definitions.
 *
 * Each template defines a schema (properties, sample rows, views) that is
 * converted to a full CreateDatabaseRequest payload at creation time.
 * UUIDs are generated lazily by buildTemplatePayload().
 */

import type { PropertyType, ViewType, SelectColor } from "./database-types";
import { SELECT_COLORS } from "./database-types";

// ---------------------------------------------------------------------------
// Template types
// ---------------------------------------------------------------------------

export interface TemplateProperty {
  /** i18n key is NOT used here — we use the raw English name and let the
   *  backend / store handle it. Templates always create with English names. */
  name: string;
  type: PropertyType;
  options?: {
    choices?: { name: string; color: SelectColor }[];
    format?: "number" | "currency" | "percent";
    includeTime?: boolean;
  };
}

export interface TemplateView {
  name: string;
  type: ViewType;
  /** Index into the properties array for board groupBy */
  groupByPropertyIndex?: number;
}

export interface DatabaseTemplate {
  key: string;
  /** Lucide icon name */
  icon: string;
  /** Badge color for the icon */
  color: string;
  properties: TemplateProperty[];
  /** Each row is an array of values matching the properties array order.
   *  For select/status: use the choice *name* — buildTemplatePayload maps it. */
  sampleRows: (string | number | boolean | string[] | null)[][];
  views: TemplateView[];
}

// ---------------------------------------------------------------------------
// Template definitions
// ---------------------------------------------------------------------------

export const DATABASE_TEMPLATES: DatabaseTemplate[] = [
  {
    key: "tasks",
    icon: "CheckCircle2",
    color: "green",
    properties: [
      { name: "Name", type: "text" },
      {
        name: "Status",
        type: "select",
        options: {
          choices: [
            { name: "To Do", color: "gray" },
            { name: "In Progress", color: "blue" },
            { name: "Done", color: "green" },
          ],
        },
      },
      {
        name: "Priority",
        type: "select",
        options: {
          choices: [
            { name: "High", color: "red" },
            { name: "Medium", color: "orange" },
            { name: "Low", color: "gray" },
          ],
        },
      },
      { name: "Due Date", type: "date" },
      { name: "Assignee", type: "text" },
    ],
    sampleRows: [
      ["Design homepage mockup", "In Progress", "High", "2026-04-01", "Alice"],
      ["Write API documentation", "To Do", "Medium", "2026-04-05", "Bob"],
      ["Fix login bug", "Done", "High", "2026-03-20", "Charlie"],
    ],
    views: [
      { name: "Table View", type: "table" },
      { name: "Board View", type: "board", groupByPropertyIndex: 1 },
    ],
  },
  {
    key: "projects",
    icon: "FolderKanban",
    color: "purple",
    properties: [
      { name: "Name", type: "text" },
      {
        name: "Status",
        type: "select",
        options: {
          choices: [
            { name: "Planning", color: "gray" },
            { name: "Active", color: "blue" },
            { name: "Completed", color: "green" },
          ],
        },
      },
      {
        name: "Category",
        type: "select",
        options: {
          choices: [
            { name: "Engineering", color: "blue" },
            { name: "Design", color: "purple" },
            { name: "Marketing", color: "orange" },
          ],
        },
      },
      { name: "Start Date", type: "date" },
      { name: "End Date", type: "date" },
      { name: "URL", type: "url" },
    ],
    sampleRows: [
      ["Website Redesign", "Active", "Design", "2026-03-01", "2026-05-01", ""],
      ["API v2", "Planning", "Engineering", "2026-04-01", "2026-06-30", ""],
      ["Q2 Campaign", "Planning", "Marketing", "2026-04-15", "2026-05-15", ""],
    ],
    views: [
      { name: "Table View", type: "table" },
      { name: "Board View", type: "board", groupByPropertyIndex: 1 },
    ],
  },
  {
    key: "readingList",
    icon: "BookOpen",
    color: "orange",
    properties: [
      { name: "Name", type: "text" },
      { name: "Author", type: "text" },
      {
        name: "Status",
        type: "select",
        options: {
          choices: [
            { name: "Want to Read", color: "gray" },
            { name: "Reading", color: "blue" },
            { name: "Finished", color: "green" },
          ],
        },
      },
      {
        name: "Rating",
        type: "select",
        options: {
          choices: [
            { name: "★★★★★", color: "yellow" },
            { name: "★★★★", color: "yellow" },
            { name: "★★★", color: "orange" },
            { name: "★★", color: "orange" },
            { name: "★", color: "gray" },
          ],
        },
      },
      {
        name: "Genre",
        type: "select",
        options: {
          choices: [
            { name: "Fiction", color: "purple" },
            { name: "Non-fiction", color: "blue" },
            { name: "Technical", color: "green" },
            { name: "Self-help", color: "orange" },
          ],
        },
      },
    ],
    sampleRows: [
      ["Deep Work", "Cal Newport", "Finished", "★★★★★", "Non-fiction"],
      ["Dune", "Frank Herbert", "Reading", null, "Fiction"],
      ["Clean Code", "Robert C. Martin", "Want to Read", null, "Technical"],
    ],
    views: [{ name: "Table View", type: "table" }],
  },
  {
    key: "contacts",
    icon: "Users",
    color: "blue",
    properties: [
      { name: "Name", type: "text" },
      { name: "Email", type: "email" },
      { name: "Phone", type: "phone" },
      { name: "Company", type: "text" },
      { name: "Role", type: "text" },
      {
        name: "Tags",
        type: "multi_select",
        options: {
          choices: [
            { name: "Client", color: "blue" },
            { name: "Partner", color: "green" },
            { name: "Vendor", color: "orange" },
            { name: "Friend", color: "purple" },
          ],
        },
      },
    ],
    sampleRows: [
      ["Jane Smith", "jane@example.com", "+1 555-0100", "Acme Corp", "PM", ["Client"]],
      ["John Doe", "john@example.com", "+1 555-0200", "TechCo", "Engineer", ["Partner"]],
      ["Lisa Wong", "lisa@example.com", "+1 555-0300", "DesignLab", "Designer", ["Vendor"]],
    ],
    views: [{ name: "Table View", type: "table" }],
  },
  {
    key: "meetingNotes",
    icon: "Calendar",
    color: "red",
    properties: [
      { name: "Name", type: "text" },
      { name: "Date", type: "date" },
      { name: "Attendees", type: "text" },
      {
        name: "Status",
        type: "select",
        options: {
          choices: [
            { name: "Scheduled", color: "blue" },
            { name: "Completed", color: "green" },
            { name: "Cancelled", color: "red" },
          ],
        },
      },
      { name: "Action Items", type: "text" },
    ],
    sampleRows: [
      ["Sprint Planning", "2026-03-15", "Team A", "Scheduled", "Review backlog"],
      ["Design Review", "2026-03-10", "Design Team", "Completed", "Update mockups"],
      ["Client Sync", "2026-03-12", "Client + PM", "Completed", "Send follow-up"],
    ],
    views: [{ name: "Table View", type: "table" }],
  },
];

// ---------------------------------------------------------------------------
// Payload builder
// ---------------------------------------------------------------------------

/**
 * Convert a template definition into a CreateDatabaseRequest payload.
 * Generates UUIDs for all properties and maps sample row values.
 */
export function buildTemplatePayload(template: DatabaseTemplate) {
  const crypto = globalThis.crypto;

  // Generate property schema with UUIDs
  const properties_schema = template.properties.map((prop, i) => {
    const propId = crypto.randomUUID();
    const def: Record<string, unknown> = {
      id: propId,
      name: prop.name,
      type: prop.type,
      position: i,
    };

    if (prop.options?.choices) {
      def.options = {
        choices: prop.options.choices.map((c) => ({
          id: crypto.randomUUID(),
          name: c.name,
          color: c.color,
        })),
      };
    }
    if (prop.options?.format) {
      def.options = { ...((def.options as object) || {}), format: prop.options.format };
    }
    if (prop.options?.includeTime) {
      def.options = { ...((def.options as object) || {}), includeTime: prop.options.includeTime };
    }

    return def;
  });

  // Map sample rows: convert choice names to choice IDs
  const rows = template.sampleRows.map((rowValues) => {
    const properties: Record<string, unknown> = {};
    rowValues.forEach((value, colIdx) => {
      const propSchema = properties_schema[colIdx];
      if (!propSchema || value === null || value === undefined) return;

      const propId = propSchema.id as string;
      const choices = (propSchema.options as { choices?: { id: string; name: string }[] })?.choices;

      if (choices && typeof value === "string") {
        // Single select: map name -> choice id
        const match = choices.find((c) => c.name === value);
        properties[propId] = match ? match.id : value;
      } else if (choices && Array.isArray(value)) {
        // Multi-select: map names -> choice ids
        properties[propId] = value.map((v) => {
          const match = choices.find((c) => c.name === v);
          return match ? match.id : v;
        });
      } else {
        properties[propId] = value;
      }
    });
    return { properties };
  });

  // Build views
  const views = template.views.map((v) => {
    const view: Record<string, unknown> = { name: v.name, type: v.type };
    if (v.groupByPropertyIndex !== undefined) {
      view.config = {
        groupByPropertyId: properties_schema[v.groupByPropertyIndex]?.id,
      };
    }
    return view;
  });

  return {
    title: template.properties[0]?.name ? template.key : "Untitled Database",
    properties_schema,
    rows,
    views,
  };
}

// Re-export for convenience
export { SELECT_COLORS };
