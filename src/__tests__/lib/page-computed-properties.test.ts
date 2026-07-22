import { describe, expect, it } from "vitest";

import {
  evaluatePageComputedProperties,
  parsePageComputedPropertiesDefinition,
  validatePageComputedPropertiesDefinition,
  type PageComputedPropertiesCatalogRow,
  type PageComputedPropertiesDefinition,
} from "@/lib/page-computed-properties";

const property = (name: string) => ({ type: "property", name }) as const;
const literal = (value: string | number | boolean | string[]) =>
  ({ type: "literal", value }) as const;

const DEFINITION = {
  version: 1,
  properties: {
    owners: { type: "relation" },
    doubled: {
      type: "formula",
      expression: {
        type: "arithmetic",
        operator: "*",
        left: property("points"),
        right: literal(2),
      },
    },
    large: {
      type: "formula",
      expression: {
        type: "comparison",
        operator: ">=",
        left: property("doubled"),
        right: literal(10),
      },
    },
    badge: {
      type: "formula",
      expression: {
        type: "if",
        condition: property("large"),
        then: {
          type: "concat",
          values: [literal("large:"), property("title")],
        },
        else: literal("small"),
      },
    },
    total_score: {
      type: "rollup",
      relation: "owners",
      property: "score",
      calculate: "sum",
    },
    min_score: {
      type: "rollup",
      relation: "owners",
      property: "score",
      calculate: "min",
    },
    max_score: {
      type: "rollup",
      relation: "owners",
      property: "score",
      calculate: "max",
    },
    tag_count: {
      type: "rollup",
      relation: "owners",
      property: "tags",
      calculate: "count",
    },
    owner_names: {
      type: "rollup",
      relation: "owners",
      property: "title",
      calculate: "join",
      separator: " + ",
    },
    owner_tags: {
      type: "rollup",
      relation: "owners",
      property: "tags",
      calculate: "unique",
    },
  },
} as const satisfies PageComputedPropertiesDefinition;

const CATALOG: PageComputedPropertiesCatalogRow[] = [
  {
    id: "roadmap",
    path: "Roadmap.md",
    title: "Roadmap",
    aliases: [],
    properties: {
      title: "Roadmap",
      points: 6,
      owners: ["[[People/Grace]]", "[[People/Ada]]"],
    },
  },
  {
    id: "grace",
    path: "People/Grace.md",
    title: "Grace Hopper",
    aliases: ["Grace"],
    properties: { title: "Grace", points: 2, score: 7, tags: ["compiler", "navy"] },
  },
  {
    id: "ada",
    path: "People/Ada.md",
    title: "Ada",
    aliases: [],
    properties: { title: "Ada", points: 1, score: 3, tags: ["math", "compiler"] },
  },
];

describe("parsePageComputedPropertiesDefinition", () => {
  it("parses the strict, versioned JSON grammar without executable expressions", () => {
    expect(parsePageComputedPropertiesDefinition(JSON.stringify(DEFINITION))).toEqual({
      ok: true,
      definition: DEFINITION,
    });
  });

  it.each([
    ["invalid JSON", "{]", "valid JSON"],
    ["wrong version", { ...DEFINITION, version: 2 }, "definition.version"],
    ["unknown root key", { ...DEFINITION, script: "globalThis.pwned = true" }, "definition.script"],
    [
      "unknown field key",
      { version: 1, properties: { owner: { type: "relation", source: "owner" } } },
      "definition.properties.owner.source",
    ],
    [
      "string expression",
      { version: 1, properties: { hacked: { type: "formula", expression: "process.exit()" } } },
      "expression",
    ],
    [
      "unknown AST operator",
      {
        version: 1,
        properties: {
          hacked: {
            type: "formula",
            expression: { type: "arithmetic", operator: "**", left: literal(2), right: literal(8) },
          },
        },
      },
      "operator",
    ],
    [
      "rollup without relation declaration",
      {
        version: 1,
        properties: {
          total: { type: "rollup", relation: "owners", property: "score", calculate: "sum" },
        },
      },
      "declared relation",
    ],
    [
      "separator on non-join rollup",
      {
        version: 1,
        properties: {
          owners: { type: "relation" },
          total: {
            type: "rollup",
            relation: "owners",
            property: "score",
            calculate: "sum",
            separator: ", ",
          },
        },
      },
      "separator",
    ],
  ])("rejects %s with a source-path diagnostic", (_name, source, message) => {
    const result =
      typeof source === "string"
        ? parsePageComputedPropertiesDefinition(source)
        : validatePageComputedPropertiesDefinition(source);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected an invalid computed-properties definition");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain(message);
  });

  it("rejects direct and transitive computed-property dependency cycles", () => {
    const result = validatePageComputedPropertiesDefinition({
      version: 1,
      properties: {
        a: { type: "formula", expression: property("b") },
        b: { type: "formula", expression: property("c") },
        c: { type: "formula", expression: property("a") },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected an invalid computed-properties definition");
    expect(result.diagnostics[0]?.message).toContain("a -> b -> c -> a");
  });

  it("rejects a rollup/formula dependency cycle", () => {
    const result = validatePageComputedPropertiesDefinition({
      version: 1,
      properties: {
        owners: { type: "relation" },
        total: {
          type: "rollup",
          relation: "owners",
          property: "adjusted",
          calculate: "sum",
        },
        adjusted: {
          type: "formula",
          expression: property("total"),
        },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected an invalid computed-properties definition");
    expect(result.diagnostics[0]?.message).toContain("adjusted -> total -> adjusted");
  });
});

describe("evaluatePageComputedProperties", () => {
  it("derives relations, formula dependencies, and every portable rollup without writes", () => {
    const before = structuredClone(CATALOG);
    const projection = evaluatePageComputedProperties(DEFINITION, CATALOG);
    const roadmap = projection.rows.find((row) => row.id === "roadmap");

    expect(roadmap).toMatchObject({
      id: "roadmap",
      sourceProperties: {
        title: "Roadmap",
        points: 6,
        owners: ["[[People/Grace]]", "[[People/Ada]]"],
      },
      derivedProperties: {
        owners: ["People/Ada.md", "People/Grace.md"],
        doubled: 12,
        large: true,
        badge: "large:Roadmap",
        total_score: 10,
        min_score: 3,
        max_score: 7,
        tag_count: 4,
        owner_names: "Ada + Grace",
        owner_tags: ["compiler", "math", "navy"],
      },
      relations: {
        owners: [
          { id: "ada", path: "People/Ada.md", title: "Ada" },
          { id: "grace", path: "People/Grace.md", title: "Grace Hopper" },
        ],
      },
    });
    expect(projection.diagnostics).toEqual([]);
    expect(CATALOG).toEqual(before);
  });

  it("fails closed for malformed, missing, and ambiguous relation links", () => {
    const catalog: PageComputedPropertiesCatalogRow[] = [
      {
        id: "source",
        path: "Source.md",
        title: "Source",
        aliases: [],
        properties: {
          owners: ["Ada", "[[Missing]]", "[[Twin]]", "[[People/Ada]]"],
        },
      },
      {
        id: "ada",
        path: "People/Ada.md",
        title: "Ada",
        aliases: [],
        properties: {},
      },
      { id: "t1", path: "One/Twin.md", title: "Twin", aliases: [], properties: {} },
      { id: "t2", path: "Two/Twin.md", title: "Twin", aliases: [], properties: {} },
    ];
    const definition = {
      version: 1,
      properties: { owners: { type: "relation" } },
    } as const satisfies PageComputedPropertiesDefinition;

    const projection = evaluatePageComputedProperties(definition, catalog);
    const source = projection.rows.find((row) => row.id === "source");

    expect(source?.derivedProperties.owners).toEqual(["People/Ada.md"]);
    expect(projection.diagnostics.map(({ code }) => code)).toEqual([
      "ambiguous-relation",
      "invalid-relation-value",
      "unresolved-relation",
    ]);
    expect(
      projection.diagnostics.find(({ code }) => code === "ambiguous-relation")?.candidates
    ).toEqual(["One/Twin.md", "Two/Twin.md"]);
  });

  it("reports formula and rollup type mismatches and omits unsafe partial values", () => {
    const catalog: PageComputedPropertiesCatalogRow[] = [
      {
        id: "source",
        path: "Source.md",
        title: "Source",
        aliases: [],
        properties: { title: "Source", points: "many", owners: "[[Target]]" },
      },
      {
        id: "target",
        path: "Target.md",
        title: "Target",
        aliases: [],
        properties: { score: "high" },
      },
    ];
    const projection = evaluatePageComputedProperties(DEFINITION, catalog);
    const source = projection.rows.find((row) => row.id === "source");

    expect(source?.derivedProperties).not.toHaveProperty("doubled");
    expect(source?.derivedProperties).not.toHaveProperty("total_score");
    expect(
      projection.diagnostics.some(
        ({ code, property }) => code === "type-mismatch" && property === "doubled"
      )
    ).toBe(true);
    expect(
      projection.diagnostics.some(
        ({ code, property }) => code === "type-mismatch" && property === "total_score"
      )
    ).toBe(true);
  });

  it("sorts Pages, relation targets, unique values, and diagnostics independently of catalog order", () => {
    const noisy = structuredClone(CATALOG);
    const roadmap = noisy.find((row) => row.id === "roadmap");
    if (!roadmap) throw new Error("missing fixture Page");
    roadmap.properties.owners = ["bad", "[[People/Grace]]", "[[Unknown]]", "[[People/Ada]]"];

    const projection = evaluatePageComputedProperties(DEFINITION, noisy.reverse());

    expect(projection.rows.map(({ path }) => path)).toEqual([
      "People/Ada.md",
      "People/Grace.md",
      "Roadmap.md",
    ]);
    expect(
      projection.rows.find(({ id }) => id === "roadmap")?.relations.owners.map(({ path }) => path)
    ).toEqual(["People/Ada.md", "People/Grace.md"]);
    expect(
      projection.rows.find(({ id }) => id === "roadmap")?.derivedProperties.owner_tags
    ).toEqual(["compiler", "math", "navy"]);
    expect(projection.diagnostics.map(({ code }) => code)).toEqual([
      "invalid-relation-value",
      "unresolved-relation",
    ]);
  });

  it("supports boolean logic and lazy if branches without executing unselected invalid work", () => {
    const definition = {
      version: 1,
      properties: {
        visible: {
          type: "formula",
          expression: {
            type: "boolean",
            operator: "and",
            operands: [
              property("published"),
              { type: "boolean", operator: "not", operand: property("archived") },
            ],
          },
        },
        result: {
          type: "formula",
          expression: {
            type: "if",
            condition: literal(true),
            then: literal("safe"),
            else: {
              type: "arithmetic",
              operator: "/",
              left: literal(1),
              right: literal(0),
            },
          },
        },
      },
    } as const satisfies PageComputedPropertiesDefinition;
    const catalog: PageComputedPropertiesCatalogRow[] = [
      {
        id: "page",
        path: "Page.md",
        title: "Page",
        aliases: [],
        properties: { published: true, archived: false },
      },
    ];

    const projection = evaluatePageComputedProperties(definition, catalog);

    expect(projection.rows[0]?.derivedProperties).toMatchObject({ visible: true, result: "safe" });
    expect(projection.diagnostics).toEqual([]);
  });
});
