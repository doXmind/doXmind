import { describe, expect, it } from "vitest";

import {
  evaluatePageCollection,
  parsePageCollection,
  projectPageCollection,
  type PageCollectionCatalogRow,
} from "@/lib/page-collection";

function block(definition: unknown, lineEnding = "\n"): string {
  return ["```doxmind-collection", JSON.stringify(definition, null, 2), "```", ""].join(lineEnding);
}

const VALID_DEFINITION = {
  version: 1,
  view: "table",
  filters: [{ property: "type", operator: "equals", value: "task" }],
  columns: ["status", "due"],
  sort: [{ property: "due", direction: "asc" }],
} as const;

describe("parsePageCollection", () => {
  it("parses the complete portable v1 fenced JSON grammar without normalizing source", () => {
    const source = block(VALID_DEFINITION, "\r\n");

    expect(parsePageCollection(source)).toEqual({
      ok: true,
      definition: VALID_DEFINITION,
    });
  });

  it("keeps the v1 table grammar compatible while accepting a portable v2 table view", () => {
    const definition = { ...VALID_DEFINITION, version: 2 } as const;

    expect(parsePageCollection(block(definition))).toEqual({
      ok: true,
      definition,
    });
  });

  it("accepts a strictly validated computed-properties schema only in Collection v2", () => {
    const computed = {
      version: 1,
      properties: {
        scoreLabel: {
          type: "formula",
          expression: {
            type: "concat",
            values: [
              { type: "literal", value: "Score: " },
              { type: "property", name: "score" },
            ],
          },
        },
      },
    } as const;
    const v2 = { ...VALID_DEFINITION, version: 2, computed } as const;

    expect(parsePageCollection(block(v2))).toEqual({ ok: true, definition: v2 });

    const v1 = parsePageCollection(block({ ...VALID_DEFINITION, computed }));
    expect(v1.ok).toBe(false);
    if (v1.ok) throw new Error("expected Collection v1 to reject computed properties");
    expect(v1.diagnostics[0]?.message).toContain("definition.computed");
  });

  it("rejects an invalid nested computed-properties definition at its portable source path", () => {
    const result = parsePageCollection(
      block({
        ...VALID_DEFINITION,
        version: 2,
        computed: {
          version: 1,
          properties: { owners: { type: "relation", fallback: "first" } },
        },
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected an invalid computed-properties definition");
    expect(result.diagnostics[0]?.message).toContain(
      "definition.computed.properties.owners.fallback"
    );
  });

  it("parses a v2 board only when it declares the Page property used for grouping", () => {
    const definition = {
      ...VALID_DEFINITION,
      version: 2,
      view: "board",
      groupBy: "status",
    } as const;

    expect(parsePageCollection(block(definition))).toEqual({ ok: true, definition });
  });

  it("parses a v2 calendar only when it declares the Page property used for dates", () => {
    const definition = {
      ...VALID_DEFINITION,
      version: 2,
      view: "calendar",
      dateBy: "due",
    } as const;

    expect(parsePageCollection(block(definition))).toEqual({ ok: true, definition });
  });

  it.each([
    ["missing fence", JSON.stringify(VALID_DEFINITION), "fenced"],
    ["wrong fence", "```collection\n{}\n```\n", "doxmind-collection"],
    ["trailing source", `${block(VALID_DEFINITION)}extra`, "after the closing fence"],
    ["invalid JSON", "```doxmind-collection\n{]\n```\n", "valid JSON"],
    ["missing field", block({ ...VALID_DEFINITION, columns: undefined }), "definition.columns"],
    ["wrong version", block({ ...VALID_DEFINITION, version: 3 }), "definition.version"],
    ["wrong view", block({ ...VALID_DEFINITION, view: "board" }), "definition.view"],
    ["unknown top-level field", block({ ...VALID_DEFINITION, query: "task" }), "definition.query"],
    [
      "invalid property key",
      block({ ...VALID_DEFINITION, columns: ["bad key"] }),
      "definition.columns[0]",
    ],
    [
      "reserved id property",
      block({ ...VALID_DEFINITION, columns: ["id"] }),
      "definition.columns[0]",
    ],
    [
      "duplicate column",
      block({ ...VALID_DEFINITION, columns: ["status", "status"] }),
      "definition.columns[1]",
    ],
    [
      "unknown filter operator",
      block({
        ...VALID_DEFINITION,
        filters: [{ property: "status", operator: "startsWith", value: "do" }],
      }),
      "definition.filters[0].operator",
    ],
    [
      "exists value",
      block({
        ...VALID_DEFINITION,
        filters: [{ property: "status", operator: "exists", value: true }],
      }),
      "definition.filters[0].value",
    ],
    [
      "contains non-string value",
      block({
        ...VALID_DEFINITION,
        filters: [{ property: "priority", operator: "contains", value: 2 }],
      }),
      "definition.filters[0].value",
    ],
    [
      "unknown sort field",
      block({
        ...VALID_DEFINITION,
        sort: [{ property: "due", direction: "asc", nulls: "first" }],
      }),
      "definition.sort[0].nulls",
    ],
  ])("rejects %s with an explicit source-path diagnostic", (_name, source, message) => {
    const result = parsePageCollection(source);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected invalid Collection definition");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain(message);
  });

  it.each([
    [
      "board without groupBy",
      { ...VALID_DEFINITION, version: 2, view: "board" },
      "definition.groupBy",
    ],
    [
      "board with calendar-only dateBy",
      { ...VALID_DEFINITION, version: 2, view: "board", groupBy: "status", dateBy: "due" },
      "definition.dateBy",
    ],
    [
      "calendar without dateBy",
      { ...VALID_DEFINITION, version: 2, view: "calendar" },
      "definition.dateBy",
    ],
    [
      "calendar with board-only groupBy",
      { ...VALID_DEFINITION, version: 2, view: "calendar", dateBy: "due", groupBy: "status" },
      "definition.groupBy",
    ],
    [
      "table with board-only groupBy",
      { ...VALID_DEFINITION, version: 2, view: "table", groupBy: "status" },
      "definition.groupBy",
    ],
    [
      "board with reserved groupBy",
      { ...VALID_DEFINITION, version: 2, view: "board", groupBy: "id" },
      "definition.groupBy",
    ],
    [
      "calendar with illegal dateBy",
      { ...VALID_DEFINITION, version: 2, view: "calendar", dateBy: "bad key" },
      "definition.dateBy",
    ],
  ])("rejects %s as an invalid v2 view combination", (_name, definition, message) => {
    const result = parsePageCollection(block(definition));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected invalid Collection definition");
    expect(result.diagnostics[0]?.message).toContain(message);
  });

  it("rejects contradictory duplicate sort properties", () => {
    const result = parsePageCollection(
      block({
        ...VALID_DEFINITION,
        sort: [
          { property: "due", direction: "asc" },
          { property: "due", direction: "desc" },
        ],
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected invalid Collection definition");
    expect(result.diagnostics[0]?.message).toContain("definition.sort[1]");
  });

  it("attributes unknown nested sort fields to the v2 grammar", () => {
    const result = parsePageCollection(
      block({
        ...VALID_DEFINITION,
        version: 2,
        view: "board",
        groupBy: "status",
        sort: [{ property: "due", direction: "asc", nulls: "first" }],
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected invalid Collection definition");
    expect(result.diagnostics[0]?.message).toContain("Collection v2");
  });
});

describe("evaluatePageCollection", () => {
  const rows: PageCollectionCatalogRow[] = [
    {
      id: "c",
      path: "Tasks/C.md",
      title: "C",
      properties: {
        type: "task",
        status: "done",
        due: "2026-08-01",
        labels: ["work", "urgent"],
        score: 3,
        published: false,
      },
    },
    {
      id: "a",
      path: "Tasks/A.md",
      title: "A",
      properties: {
        type: "task",
        status: "doing",
        due: "2026-07-30",
        labels: ["work"],
        score: 10,
        published: true,
      },
    },
    {
      id: "b",
      path: "Tasks/B.md",
      title: "B",
      properties: {
        type: "task",
        status: "doing",
        labels: ["work", "urgent"],
        score: 2,
        published: true,
      },
    },
    {
      id: "note",
      path: "Notes/Task idea.md",
      title: "Task idea",
      properties: { type: "note", status: "doing", labels: ["work"] },
    },
  ];

  it("ANDs equals, contains, and exists filters over typed Page properties", () => {
    const parsed = parsePageCollection(
      block({
        version: 1,
        view: "table",
        filters: [
          { property: "type", operator: "equals", value: "task" },
          { property: "status", operator: "contains", value: "do" },
          { property: "labels", operator: "contains", value: "urgent" },
          { property: "published", operator: "exists" },
        ],
        columns: ["status", "labels", "published"],
        sort: [],
      })
    );
    if (!parsed.ok) throw new Error(parsed.diagnostics[0]?.message);

    expect(evaluatePageCollection(parsed.definition, rows).map((row) => row.id)).toEqual([
      "b",
      "c",
    ]);
  });

  it("compares scalar and string-array equality by exact type and value", () => {
    const scalar = parsePageCollection(
      block({
        version: 1,
        view: "table",
        filters: [{ property: "score", operator: "equals", value: 2 }],
        columns: [],
        sort: [],
      })
    );
    const list = parsePageCollection(
      block({
        version: 1,
        view: "table",
        filters: [{ property: "labels", operator: "equals", value: ["work", "urgent"] }],
        columns: [],
        sort: [],
      })
    );
    if (!scalar.ok || !list.ok) throw new Error("expected valid fixtures");

    expect(evaluatePageCollection(scalar.definition, rows).map((row) => row.id)).toEqual(["b"]);
    expect(evaluatePageCollection(list.definition, rows).map((row) => row.id)).toEqual(["b", "c"]);
  });

  it("sorts by every directive, keeps missing values last in both directions, and ties by path", () => {
    const parsed = parsePageCollection(
      block({
        version: 1,
        view: "table",
        filters: [{ property: "type", operator: "equals", value: "task" }],
        columns: ["status", "score"],
        sort: [
          { property: "status", direction: "desc" },
          { property: "score", direction: "asc" },
        ],
      })
    );
    if (!parsed.ok) throw new Error(parsed.diagnostics[0]?.message);

    expect(evaluatePageCollection(parsed.definition, rows).map((row) => row.id)).toEqual([
      "c",
      "b",
      "a",
    ]);

    const missingDescending = parsePageCollection(
      block({
        version: 1,
        view: "table",
        filters: [{ property: "type", operator: "equals", value: "task" }],
        columns: ["due"],
        sort: [{ property: "due", direction: "desc" }],
      })
    );
    if (!missingDescending.ok) throw new Error(missingDescending.diagnostics[0]?.message);

    expect(evaluatePageCollection(missingDescending.definition, rows).map((row) => row.id)).toEqual(
      ["c", "a", "b"]
    );
  });

  it("uses path and then id as deterministic final tie-breakers", () => {
    const parsed = parsePageCollection(
      block({ version: 1, view: "table", filters: [], columns: [], sort: [] })
    );
    if (!parsed.ok) throw new Error(parsed.diagnostics[0]?.message);
    const tied: PageCollectionCatalogRow[] = [
      { id: "z", path: "same.md", title: "Second", properties: {} },
      { id: "a", path: "Same.md", title: "First", properties: {} },
      { id: "m", path: "b.md", title: "Middle", properties: {} },
    ];

    expect(evaluatePageCollection(parsed.definition, tied).map((row) => row.id)).toEqual([
      "m",
      "a",
      "z",
    ]);
  });
});

describe("projectPageCollection", () => {
  it("projects a table from the deterministic query while preserving each Page row as truth", () => {
    const page: PageCollectionCatalogRow = {
      id: "task",
      path: "Tasks/Task.md",
      title: "Task",
      properties: { type: "task" },
    };
    const ignored: PageCollectionCatalogRow = {
      id: "note",
      path: "Notes/Note.md",
      title: "Note",
      properties: { type: "note" },
    };
    const parsed = parsePageCollection(
      block({
        version: 2,
        view: "table",
        filters: [{ property: "type", operator: "equals", value: "task" }],
        columns: ["type"],
        sort: [],
      })
    );
    if (!parsed.ok) throw new Error(parsed.diagnostics[0]?.message);

    const projection = projectPageCollection(parsed.definition, [ignored, page]);

    expect(projection).toEqual({ view: "table", rows: [page] });
    expect(projection.rows[0]).toBe(page);
  });

  it("uses relation, rollup, and formula values in a v2 table without modifying source Pages", () => {
    const catalog: PageCollectionCatalogRow[] = [
      {
        id: "plan",
        path: "Projects/Plan.md",
        title: "Plan",
        aliases: ["Release plan"],
        properties: {
          type: "project",
          tasks: ["[[Tasks/A]]", "[[Tasks/B]]"],
        },
      },
      {
        id: "a",
        path: "Tasks/A.md",
        title: "A",
        properties: { type: "task", score: 2 },
      },
      {
        id: "b",
        path: "Tasks/B.md",
        title: "B",
        properties: { type: "task", score: 3 },
      },
    ];
    const before = structuredClone(catalog);
    const parsed = parsePageCollection(
      block({
        version: 2,
        view: "table",
        computed: {
          version: 1,
          properties: {
            tasks: { type: "relation" },
            total: {
              type: "rollup",
              relation: "tasks",
              property: "score",
              calculate: "sum",
            },
            label: {
              type: "formula",
              expression: {
                type: "concat",
                values: [
                  { type: "literal", value: "Total: " },
                  { type: "property", name: "total" },
                ],
              },
            },
          },
        },
        filters: [{ property: "total", operator: "equals", value: 5 }],
        columns: ["tasks", "total", "label"],
        sort: [{ property: "label", direction: "asc" }],
      })
    );
    if (!parsed.ok) throw new Error(parsed.diagnostics[0]?.message);

    const projection = projectPageCollection(parsed.definition, catalog);

    expect(projection).toEqual({
      view: "table",
      rows: [
        {
          ...catalog[0],
          properties: {
            type: "project",
            tasks: ["Tasks/A.md", "Tasks/B.md"],
            total: 5,
            label: "Total: 5",
          },
        },
      ],
      computedDiagnostics: [],
      relationNavigation: [
        {
          rowId: "plan",
          rowPath: "Projects/Plan.md",
          relations: {
            tasks: [
              { id: "a", path: "Tasks/A.md", title: "A" },
              { id: "b", path: "Tasks/B.md", title: "B" },
            ],
          },
        },
      ],
    });
    expect(projection.rows[0]).not.toBe(catalog[0]);
    expect(catalog).toEqual(before);
  });

  it("surfaces unresolved and ambiguous relation diagnostics without guessing targets", () => {
    const parsed = parsePageCollection(
      block({
        version: 2,
        view: "table",
        computed: {
          version: 1,
          properties: { owners: { type: "relation" } },
        },
        filters: [],
        columns: ["owners"],
        sort: [],
      })
    );
    if (!parsed.ok) throw new Error(parsed.diagnostics[0]?.message);
    const catalog: PageCollectionCatalogRow[] = [
      {
        id: "source",
        path: "Source.md",
        title: "Source",
        properties: { owners: ["[[Twin]]", "[[Missing]]"] },
      },
      { id: "one", path: "One/Twin.md", title: "Twin", properties: {} },
      { id: "two", path: "Two/Twin.md", title: "Twin", properties: {} },
    ];

    const projection = projectPageCollection(parsed.definition, catalog);
    const source = projection.rows.find(({ id }) => id === "source");
    const sourceNavigation = projection.relationNavigation?.find(({ rowId }) => rowId === "source");

    expect(source?.properties.owners).toEqual([]);
    expect(sourceNavigation?.relations.owners).toEqual([]);
    expect(projection.computedDiagnostics?.map(({ code }) => code)).toEqual([
      "ambiguous-relation",
      "unresolved-relation",
    ]);
    expect(projection.computedDiagnostics?.[0]).toMatchObject({
      rowId: "source",
      rowPath: "Source.md",
      property: "owners",
      target: "[[Twin]]",
      candidates: ["One/Twin.md", "Two/Twin.md"],
    });
  });

  it("projects deterministic board columns and keeps the missing-property column last", () => {
    const done: PageCollectionCatalogRow = {
      id: "done",
      path: "Tasks/Done.md",
      title: "Done",
      properties: { status: "done" },
    };
    const missing: PageCollectionCatalogRow = {
      id: "missing",
      path: "Tasks/Missing.md",
      title: "Missing",
      properties: {},
    };
    const todoA: PageCollectionCatalogRow = {
      id: "todo-a",
      path: "Tasks/Todo A.md",
      title: "Todo A",
      properties: { status: "todo" },
    };
    const todoB: PageCollectionCatalogRow = {
      id: "todo-b",
      path: "Tasks/Todo B.md",
      title: "Todo B",
      properties: { status: "todo" },
    };
    const parsed = parsePageCollection(
      block({
        version: 2,
        view: "board",
        groupBy: "status",
        filters: [],
        columns: ["status"],
        sort: [],
      })
    );
    if (!parsed.ok) throw new Error(parsed.diagnostics[0]?.message);

    const projection = projectPageCollection(parsed.definition, [todoB, missing, todoA, done]);

    expect(projection).toEqual({
      view: "board",
      groupBy: "status",
      rows: [done, missing, todoA, todoB],
      columns: [
        { key: 'string:"done"', value: "done", rows: [done] },
        { key: 'string:"todo"', value: "todo", rows: [todoA, todoB] },
        { key: "missing", value: null, rows: [missing] },
      ],
    });
    if (projection.view !== "board") throw new Error("expected board projection");
    expect(projection.columns.flatMap((column) => column.rows)).toEqual([
      done,
      todoA,
      todoB,
      missing,
    ]);
  });

  it("groups a v2 board by a derived formula property", () => {
    const parsed = parsePageCollection(
      block({
        version: 2,
        view: "board",
        groupBy: "lane",
        computed: {
          version: 1,
          properties: {
            lane: {
              type: "formula",
              expression: {
                type: "if",
                condition: {
                  type: "comparison",
                  operator: "==",
                  left: { type: "property", name: "status" },
                  right: { type: "literal", value: "done" },
                },
                then: { type: "literal", value: "Closed" },
                else: { type: "literal", value: "Open" },
              },
            },
          },
        },
        filters: [{ property: "lane", operator: "exists" }],
        columns: ["lane"],
        sort: [{ property: "priority", direction: "asc" }],
      })
    );
    if (!parsed.ok) throw new Error(parsed.diagnostics[0]?.message);

    const projection = projectPageCollection(parsed.definition, [
      {
        id: "done",
        path: "Done.md",
        title: "Done",
        properties: { status: "done", priority: 2 },
      },
      {
        id: "todo",
        path: "Todo.md",
        title: "Todo",
        properties: { status: "todo", priority: 1 },
      },
    ]);

    expect(projection.view).toBe("board");
    if (projection.view !== "board") throw new Error("expected board projection");
    expect(projection.rows.map(({ id, properties }) => [id, properties.lane])).toEqual([
      ["todo", "Open"],
      ["done", "Closed"],
    ]);
    expect(projection.columns.map(({ value, rows }) => [value, rows.map(({ id }) => id)])).toEqual([
      ["Closed", ["done"]],
      ["Open", ["todo"]],
    ]);
    expect(projection.computedDiagnostics).toEqual([]);
  });

  it("projects only real YYYY-MM-DD calendar days and an explicit unscheduled bucket", () => {
    const missing: PageCollectionCatalogRow = {
      id: "missing",
      path: "Tasks/A Missing.md",
      title: "Missing",
      properties: {},
    };
    const late: PageCollectionCatalogRow = {
      id: "late",
      path: "Tasks/B Late.md",
      title: "Late",
      properties: { due: "2026-07-02" },
    };
    const malformed: PageCollectionCatalogRow = {
      id: "malformed",
      path: "Tasks/C Malformed.md",
      title: "Malformed",
      properties: { due: "2026-7-01" },
    };
    const earlyA: PageCollectionCatalogRow = {
      id: "early-a",
      path: "Tasks/D Early A.md",
      title: "Early A",
      properties: { due: "2026-07-01" },
    };
    const impossible: PageCollectionCatalogRow = {
      id: "impossible",
      path: "Tasks/E Impossible.md",
      title: "Impossible",
      properties: { due: "2026-02-30" },
    };
    const earlyB: PageCollectionCatalogRow = {
      id: "early-b",
      path: "Tasks/F Early B.md",
      title: "Early B",
      properties: { due: "2026-07-01" },
    };
    const catalog = [missing, late, malformed, earlyA, impossible, earlyB];
    const parsed = parsePageCollection(
      block({
        version: 2,
        view: "calendar",
        dateBy: "due",
        filters: [],
        columns: ["due"],
        sort: [],
      })
    );
    if (!parsed.ok) throw new Error(parsed.diagnostics[0]?.message);

    const projection = projectPageCollection(parsed.definition, catalog);

    expect(projection).toEqual({
      view: "calendar",
      dateBy: "due",
      rows: catalog,
      days: [
        { date: "2026-07-01", rows: [earlyA, earlyB] },
        { date: "2026-07-02", rows: [late] },
      ],
      unscheduled: { key: "unscheduled", rows: [missing, malformed, impossible] },
    });
  });

  it("schedules a v2 calendar by a derived formula date and exposes stable diagnostics", () => {
    const parsed = parsePageCollection(
      block({
        version: 2,
        view: "calendar",
        dateBy: "scheduled",
        computed: {
          version: 1,
          properties: {
            scheduled: {
              type: "formula",
              expression: { type: "property", name: "planned" },
            },
          },
        },
        filters: [],
        columns: ["scheduled"],
        sort: [],
      })
    );
    if (!parsed.ok) throw new Error(parsed.diagnostics[0]?.message);

    const projection = projectPageCollection(parsed.definition, [
      {
        id: "missing",
        path: "A Missing.md",
        title: "Missing",
        properties: {},
      },
      {
        id: "planned",
        path: "B Planned.md",
        title: "Planned",
        properties: { planned: "2026-08-08" },
      },
    ]);

    expect(projection.view).toBe("calendar");
    if (projection.view !== "calendar") throw new Error("expected calendar projection");
    expect(projection.days.map(({ date, rows }) => [date, rows.map(({ id }) => id)])).toEqual([
      ["2026-08-08", ["planned"]],
    ]);
    expect(projection.unscheduled.rows.map(({ id }) => id)).toEqual(["missing"]);
    expect(projection.computedDiagnostics).toEqual([
      {
        code: "missing-property",
        rowId: "missing",
        rowPath: "A Missing.md",
        property: "scheduled",
        message: "Page A Missing.md has no source property planned.",
      },
    ]);
  });
});
