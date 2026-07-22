import { resolveKnowledgeWikiPage, type KnowledgePage } from "@/lib/knowledge-index";

export type PageComputedPropertyValue = string | number | boolean | string[];

export interface PageComputedPropertiesCatalogRow {
  id: string;
  path: string;
  title: string;
  aliases: string[];
  properties: Record<string, PageComputedPropertyValue>;
}

export interface PageRelationPropertyDefinition {
  type: "relation";
}

export interface PageFormulaLiteralExpression {
  type: "literal";
  value: PageComputedPropertyValue;
}

export interface PageFormulaPropertyExpression {
  type: "property";
  name: string;
}

export interface PageFormulaArithmeticExpression {
  type: "arithmetic";
  operator: "+" | "-" | "*" | "/" | "%";
  left: PageFormulaExpression;
  right: PageFormulaExpression;
}

export interface PageFormulaComparisonExpression {
  type: "comparison";
  operator: "==" | "!=" | "<" | "<=" | ">" | ">=";
  left: PageFormulaExpression;
  right: PageFormulaExpression;
}

export type PageFormulaBooleanExpression =
  | {
      type: "boolean";
      operator: "and" | "or";
      operands: readonly PageFormulaExpression[];
    }
  | {
      type: "boolean";
      operator: "not";
      operand: PageFormulaExpression;
    };

export interface PageFormulaConcatExpression {
  type: "concat";
  values: readonly PageFormulaExpression[];
}

export interface PageFormulaIfExpression {
  type: "if";
  condition: PageFormulaExpression;
  then: PageFormulaExpression;
  else: PageFormulaExpression;
}

export type PageFormulaExpression =
  | PageFormulaLiteralExpression
  | PageFormulaPropertyExpression
  | PageFormulaArithmeticExpression
  | PageFormulaComparisonExpression
  | PageFormulaBooleanExpression
  | PageFormulaConcatExpression
  | PageFormulaIfExpression;

export interface PageFormulaPropertyDefinition {
  type: "formula";
  expression: PageFormulaExpression;
}

export interface PageRollupPropertyDefinition {
  type: "rollup";
  relation: string;
  property: string;
  calculate: "count" | "sum" | "min" | "max" | "join" | "unique";
  separator?: string;
}

export type PageComputedPropertyDefinition =
  PageRelationPropertyDefinition | PageFormulaPropertyDefinition | PageRollupPropertyDefinition;

/** Portable JSON schema version. Bump only for an intentionally incompatible grammar. */
export interface PageComputedPropertiesDefinition {
  version: 1;
  properties: Readonly<Record<string, PageComputedPropertyDefinition>>;
}

export interface PageComputedPropertiesDefinitionDiagnostic {
  code: "invalid-json" | "invalid-definition";
  message: string;
}

export type PageComputedPropertiesDefinitionResult =
  | { ok: true; definition: PageComputedPropertiesDefinition }
  | { ok: false; diagnostics: [PageComputedPropertiesDefinitionDiagnostic] };

export interface PageComputedRelationTarget {
  id: string;
  path: string;
  title: string;
}

export interface PageComputedPropertiesProjectionRow {
  id: string;
  path: string;
  title: string;
  aliases: string[];
  /** A clone of canonical frontmatter values; never mutated or normalized. */
  sourceProperties: Record<string, PageComputedPropertyValue>;
  /** Zero-write relation, formula, and rollup values. */
  derivedProperties: Record<string, PageComputedPropertyValue>;
  /** Resolved relation targets for navigation and inspection. */
  relations: Record<string, PageComputedRelationTarget[]>;
}

export interface PageComputedPropertyDiagnostic {
  code:
    | "invalid-relation-value"
    | "unresolved-relation"
    | "ambiguous-relation"
    | "missing-property"
    | "type-mismatch"
    | "invalid-operation"
    | "dependency-cycle";
  rowId: string;
  rowPath: string;
  property: string;
  message: string;
  target?: string;
  candidates?: string[];
}

export interface PageComputedPropertiesProjection {
  rows: PageComputedPropertiesProjectionRow[];
  diagnostics: PageComputedPropertyDiagnostic[];
}

const PROPERTY_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const EXACT_WIKI_RELATION = /^\[\[([^\[\]|#^\r\n]+)\]\]$/;
const MAX_FORMULA_DEPTH = 64;
const MAX_FORMULA_NODES = 1_000;

/** Parse one complete JSON document containing the portable v1 definition. */
export function parsePageComputedPropertiesDefinition(
  source: string
): PageComputedPropertiesDefinitionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return invalidDefinition("invalid-json", "Computed-properties source must be valid JSON.");
  }
  return validatePageComputedPropertiesDefinition(parsed);
}

/** Validate an already parsed value without evaluating or writing any Page. */
export function validatePageComputedPropertiesDefinition(
  value: unknown
): PageComputedPropertiesDefinitionResult {
  const message = validateDefinition(value);
  if (message) return invalidDefinition("invalid-definition", message);
  return { ok: true, definition: value as PageComputedPropertiesDefinition };
}

/**
 * Evaluate a validated definition over a complete Page catalog.
 *
 * Input Pages and definition objects remain untouched. Rows, relation targets,
 * unique values, and diagnostics have explicit stable ordering.
 */
export function evaluatePageComputedProperties(
  definition: PageComputedPropertiesDefinition,
  catalog: readonly PageComputedPropertiesCatalogRow[]
): PageComputedPropertiesProjection {
  const context = createEvaluationContext(definition, catalog);
  const rows = context.pages.map((page) => projectPage(context, page));
  context.diagnostics.sort(compareDiagnostics);
  return { rows, diagnostics: context.diagnostics };
}

interface EvaluationContext {
  definition: PageComputedPropertiesDefinition;
  pages: PageComputedPropertiesCatalogRow[];
  knowledgePages: KnowledgePage[];
  pagesByIdentity: Map<string, PageComputedPropertiesCatalogRow>;
  memo: Map<string, EvaluationResult>;
  active: string[];
  relations: Map<string, PageComputedRelationTarget[]>;
  diagnostics: PageComputedPropertyDiagnostic[];
  diagnosticKeys: Set<string>;
}

type EvaluationResult = { ok: true; value: PageComputedPropertyValue } | { ok: false };

function createEvaluationContext(
  definition: PageComputedPropertiesDefinition,
  catalog: readonly PageComputedPropertiesCatalogRow[]
): EvaluationContext {
  const pages = [...catalog].sort(comparePages);
  const knowledgePages = pages.map(({ id, path, title, aliases }) => ({
    id,
    path,
    title,
    aliases: [...aliases],
  }));
  return {
    definition,
    pages,
    knowledgePages,
    pagesByIdentity: new Map(pages.map((page) => [pageIdentity(page), page])),
    memo: new Map(),
    active: [],
    relations: new Map(),
    diagnostics: [],
    diagnosticKeys: new Set(),
  };
}

function projectPage(
  context: EvaluationContext,
  page: PageComputedPropertiesCatalogRow
): PageComputedPropertiesProjectionRow {
  const derivedProperties: Record<string, PageComputedPropertyValue> = {};
  const relations: Record<string, PageComputedRelationTarget[]> = {};
  for (const name of Object.keys(context.definition.properties).sort(compareText)) {
    const result = evaluateField(context, page, name);
    if (result.ok) derivedProperties[name] = cloneValue(result.value);
    if (context.definition.properties[name]?.type === "relation") {
      relations[name] = (context.relations.get(fieldIdentity(page, name)) ?? []).map((target) => ({
        ...target,
      }));
    }
  }
  return {
    id: page.id,
    path: page.path,
    title: page.title,
    aliases: [...page.aliases],
    sourceProperties: cloneProperties(page.properties),
    derivedProperties,
    relations,
  };
}

function evaluateField(
  context: EvaluationContext,
  page: PageComputedPropertiesCatalogRow,
  name: string
): EvaluationResult {
  const key = fieldIdentity(page, name);
  const memoized = context.memo.get(key);
  if (memoized) return memoized;
  const cycleStart = context.active.indexOf(key);
  if (cycleStart >= 0) {
    const cycle = [...context.active.slice(cycleStart), key]
      .map((entry) => entry.slice(entry.lastIndexOf("\0") + 1))
      .join(" -> ");
    addDiagnostic(context, page, name, "dependency-cycle", `Dependency cycle: ${cycle}.`);
    return { ok: false };
  }

  const field = context.definition.properties[name];
  if (!field) return readSourceProperty(context, page, name, name);
  context.active.push(key);
  let result: EvaluationResult;
  if (field.type === "relation") {
    result = evaluateRelation(context, page, name);
  } else if (field.type === "formula") {
    result = evaluateExpression(context, page, name, field.expression);
  } else {
    result = evaluateRollup(context, page, name, field);
  }
  context.active.pop();
  context.memo.set(key, result);
  return result;
}

function evaluateRelation(
  context: EvaluationContext,
  page: PageComputedPropertiesCatalogRow,
  name: string
): EvaluationResult {
  const raw = page.properties[name];
  const links = raw === undefined ? [] : typeof raw === "string" ? [raw] : raw;
  if (!Array.isArray(links)) {
    addDiagnostic(
      context,
      page,
      name,
      "invalid-relation-value",
      `Relation ${name} must be an exact Wiki Link string or string array.`
    );
    context.relations.set(fieldIdentity(page, name), []);
    return { ok: false };
  }

  const targets = new Map<string, PageComputedRelationTarget>();
  for (const link of links) {
    const match = EXACT_WIKI_RELATION.exec(link);
    const targetText = match?.[1]?.trim();
    if (!targetText) {
      addDiagnostic(
        context,
        page,
        name,
        "invalid-relation-value",
        `Relation ${name} contains a value that is not an exact Page Wiki Link: ${JSON.stringify(link)}.`,
        link
      );
      continue;
    }
    const resolution = resolveKnowledgeWikiPage(context.knowledgePages, page.path, targetText);
    if (resolution.status === "unresolved") {
      addDiagnostic(
        context,
        page,
        name,
        "unresolved-relation",
        `Relation ${name} cannot resolve ${link}.`,
        link
      );
      continue;
    }
    if (resolution.status === "ambiguous") {
      const candidates = resolution.candidates.map(({ path }) => path).sort(compareText);
      addDiagnostic(
        context,
        page,
        name,
        "ambiguous-relation",
        `Relation ${name} matches multiple Pages for ${link}.`,
        link,
        candidates
      );
      continue;
    }
    const target = resolution.page;
    if (!target) continue;
    targets.set(pageIdentity(target), { id: target.id, path: target.path, title: target.title });
  }
  const resolved = [...targets.values()].sort(compareRelationTargets);
  context.relations.set(fieldIdentity(page, name), resolved);
  return { ok: true, value: resolved.map(({ path }) => path) };
}

function evaluateExpression(
  context: EvaluationContext,
  page: PageComputedPropertiesCatalogRow,
  field: string,
  expression: PageFormulaExpression
): EvaluationResult {
  if (expression.type === "literal") return { ok: true, value: cloneValue(expression.value) };
  if (expression.type === "property") {
    if (Object.hasOwn(context.definition.properties, expression.name)) {
      return evaluateField(context, page, expression.name);
    }
    return readSourceProperty(context, page, expression.name, field);
  }
  if (expression.type === "arithmetic") {
    const left = evaluateExpression(context, page, field, expression.left);
    if (!left.ok) return left;
    const right = evaluateExpression(context, page, field, expression.right);
    if (!right.ok) return right;
    if (typeof left.value !== "number" || typeof right.value !== "number") {
      return typeMismatch(context, page, field, "Arithmetic operands must both be numbers.");
    }
    if ((expression.operator === "/" || expression.operator === "%") && right.value === 0) {
      addDiagnostic(
        context,
        page,
        field,
        "invalid-operation",
        `${expression.operator === "/" ? "Division" : "Modulo"} by zero is undefined.`
      );
      return { ok: false };
    }
    const value = calculateArithmetic(expression.operator, left.value, right.value);
    if (!Number.isFinite(value)) {
      addDiagnostic(
        context,
        page,
        field,
        "invalid-operation",
        "Arithmetic result must be a finite number."
      );
      return { ok: false };
    }
    return { ok: true, value };
  }
  if (expression.type === "comparison") {
    const left = evaluateExpression(context, page, field, expression.left);
    if (!left.ok) return left;
    const right = evaluateExpression(context, page, field, expression.right);
    if (!right.ok) return right;
    const compared = compareFormulaValues(expression.operator, left.value, right.value);
    if (compared === null) {
      return typeMismatch(
        context,
        page,
        field,
        `Comparison ${expression.operator} received incompatible values.`
      );
    }
    return { ok: true, value: compared };
  }
  if (expression.type === "boolean") {
    if (expression.operator === "not") {
      const operand = evaluateExpression(context, page, field, expression.operand);
      if (!operand.ok) return operand;
      if (typeof operand.value !== "boolean") {
        return typeMismatch(context, page, field, "Boolean not requires a boolean operand.");
      }
      return { ok: true, value: !operand.value };
    }
    for (const operandExpression of expression.operands) {
      const operand = evaluateExpression(context, page, field, operandExpression);
      if (!operand.ok) return operand;
      if (typeof operand.value !== "boolean") {
        return typeMismatch(context, page, field, "Boolean operands must be booleans.");
      }
      if (expression.operator === "and" && !operand.value) return { ok: true, value: false };
      if (expression.operator === "or" && operand.value) return { ok: true, value: true };
    }
    return { ok: true, value: expression.operator === "and" };
  }
  if (expression.type === "concat") {
    let value = "";
    for (const partExpression of expression.values) {
      const part = evaluateExpression(context, page, field, partExpression);
      if (!part.ok) return part;
      if (Array.isArray(part.value)) {
        return typeMismatch(context, page, field, "Concat values must be scalar values.");
      }
      value += String(part.value);
    }
    return { ok: true, value };
  }
  const condition = evaluateExpression(context, page, field, expression.condition);
  if (!condition.ok) return condition;
  if (typeof condition.value !== "boolean") {
    return typeMismatch(context, page, field, "If condition must be a boolean.");
  }
  return evaluateExpression(
    context,
    page,
    field,
    condition.value ? expression.then : expression.else
  );
}

function evaluateRollup(
  context: EvaluationContext,
  page: PageComputedPropertiesCatalogRow,
  name: string,
  definition: PageRollupPropertyDefinition
): EvaluationResult {
  const relation = evaluateField(context, page, definition.relation);
  if (!relation.ok) return relation;
  const targets = context.relations.get(fieldIdentity(page, definition.relation)) ?? [];
  const values: Array<string | number | boolean> = [];
  for (const target of targets) {
    const targetPage = context.pagesByIdentity.get(pageIdentity(target));
    if (!targetPage) continue;
    const result = Object.hasOwn(context.definition.properties, definition.property)
      ? evaluateField(context, targetPage, definition.property)
      : readSourceProperty(context, targetPage, definition.property, name);
    if (!result.ok) return result;
    if (Array.isArray(result.value)) values.push(...result.value);
    else values.push(result.value);
  }

  if (definition.calculate === "count") return { ok: true, value: values.length };
  if (definition.calculate === "sum") {
    if (!values.every((value): value is number => typeof value === "number")) {
      return typeMismatch(context, page, name, `Rollup ${name} sum requires numeric values.`);
    }
    return { ok: true, value: values.reduce((total, value) => total + value, 0) };
  }
  if (definition.calculate === "min" || definition.calculate === "max") {
    if (!values.every((value): value is number => typeof value === "number")) {
      return typeMismatch(
        context,
        page,
        name,
        `Rollup ${name} ${definition.calculate} requires numeric values.`
      );
    }
    if (values.length === 0) return { ok: false };
    return {
      ok: true,
      value: definition.calculate === "min" ? Math.min(...values) : Math.max(...values),
    };
  }
  if (!values.every((value): value is string => typeof value === "string")) {
    return typeMismatch(
      context,
      page,
      name,
      `Rollup ${name} ${definition.calculate} requires string values.`
    );
  }
  if (definition.calculate === "join") {
    return { ok: true, value: values.join(definition.separator ?? ", ") };
  }
  return { ok: true, value: [...new Set(values)].sort(compareText) };
}

function readSourceProperty(
  context: EvaluationContext,
  page: PageComputedPropertiesCatalogRow,
  name: string,
  diagnosticProperty: string
): EvaluationResult {
  if (Object.hasOwn(page.properties, name)) {
    return { ok: true, value: cloneValue(page.properties[name] as PageComputedPropertyValue) };
  }
  addDiagnostic(
    context,
    page,
    diagnosticProperty,
    "missing-property",
    `Page ${page.path} has no source property ${name}.`
  );
  return { ok: false };
}

function typeMismatch(
  context: EvaluationContext,
  page: PageComputedPropertiesCatalogRow,
  property: string,
  message: string
): EvaluationResult {
  addDiagnostic(context, page, property, "type-mismatch", message);
  return { ok: false };
}

function calculateArithmetic(operator: string, left: number, right: number): number {
  if (operator === "+") return left + right;
  if (operator === "-") return left - right;
  if (operator === "*") return left * right;
  if (operator === "/") return left / right;
  return left % right;
}

function compareFormulaValues(
  operator: PageFormulaComparisonExpression["operator"],
  left: PageComputedPropertyValue,
  right: PageComputedPropertyValue
): boolean | null {
  if (operator === "==" || operator === "!=") {
    if (valueKind(left) !== valueKind(right)) return null;
    const equal = equalValues(left, right);
    return operator === "==" ? equal : !equal;
  }
  if (
    (typeof left !== "number" || typeof right !== "number") &&
    (typeof left !== "string" || typeof right !== "string")
  ) {
    return null;
  }
  const compared =
    typeof left === "number" ? left - (right as number) : compareText(left, String(right));
  if (operator === "<") return compared < 0;
  if (operator === "<=") return compared <= 0;
  if (operator === ">") return compared > 0;
  return compared >= 0;
}

function addDiagnostic(
  context: EvaluationContext,
  page: PageComputedPropertiesCatalogRow,
  property: string,
  code: PageComputedPropertyDiagnostic["code"],
  message: string,
  target?: string,
  candidates?: string[]
): void {
  const diagnostic: PageComputedPropertyDiagnostic = {
    code,
    rowId: page.id,
    rowPath: page.path,
    property,
    message,
    ...(target === undefined ? {} : { target }),
    ...(candidates === undefined ? {} : { candidates: [...candidates] }),
  };
  const key = JSON.stringify(diagnostic);
  if (context.diagnosticKeys.has(key)) return;
  context.diagnosticKeys.add(key);
  context.diagnostics.push(diagnostic);
}

function validateDefinition(value: unknown): string | null {
  if (!isPlainObject(value)) return "definition must be a JSON object.";
  const rootError = requireExactKeys(value, "definition", ["version", "properties"]);
  if (rootError) return rootError;
  if (value.version !== 1) return "definition.version must be exactly 1.";
  if (!isPlainObject(value.properties)) return "definition.properties must be a JSON object.";

  const definitions = value.properties;
  for (const name of Object.keys(definitions).sort(compareText)) {
    if (!isPropertyKey(name)) {
      return `definition.properties.${name} is not a legal, non-reserved property key.`;
    }
    const message = validatePropertyDefinition(definitions[name], `definition.properties.${name}`);
    if (message) return message;
  }
  for (const name of Object.keys(definitions).sort(compareText)) {
    const field = definitions[name] as Record<string, unknown>;
    if (field.type !== "rollup") continue;
    const relation = definitions[field.relation as string];
    if (!isPlainObject(relation) || relation.type !== "relation") {
      return `definition.properties.${name}.relation must name a declared relation property.`;
    }
  }

  const cycle = findDependencyCycle(definitions);
  return cycle ? `Computed-property dependency cycle: ${cycle.join(" -> ")}.` : null;
}

function validatePropertyDefinition(value: unknown, path: string): string | null {
  if (!isPlainObject(value)) return `${path} must be a JSON object.`;
  if (value.type === "relation") return requireExactKeys(value, path, ["type"]);
  if (value.type === "formula") {
    const keysError = requireExactKeys(value, path, ["type", "expression"]);
    if (keysError) return keysError;
    return validateExpression(value.expression, `${path}.expression`, { count: 0 }, 0);
  }
  if (value.type === "rollup") {
    const calculate = value.calculate;
    const allowedCalculations = new Set(["count", "sum", "min", "max", "join", "unique"]);
    const expectedKeys =
      calculate === "join"
        ? ["type", "relation", "property", "calculate", "separator"]
        : ["type", "relation", "property", "calculate"];
    const keysError = requireExactKeys(
      value,
      path,
      expectedKeys,
      calculate === "join" ? ["separator"] : []
    );
    if (keysError) return keysError;
    if (!isPropertyKey(value.relation)) return `${path}.relation must be a legal property key.`;
    if (!isPropertyKey(value.property)) return `${path}.property must be a legal property key.`;
    if (!allowedCalculations.has(calculate as string)) {
      return `${path}.calculate must be count, sum, min, max, join, or unique.`;
    }
    if (
      calculate === "join" &&
      value.separator !== undefined &&
      typeof value.separator !== "string"
    ) {
      return `${path}.separator must be a string.`;
    }
    return null;
  }
  return `${path}.type must be relation, formula, or rollup.`;
}

function validateExpression(
  value: unknown,
  path: string,
  budget: { count: number },
  depth: number
): string | null {
  budget.count += 1;
  if (depth > MAX_FORMULA_DEPTH) return `${path} exceeds the maximum formula depth.`;
  if (budget.count > MAX_FORMULA_NODES) return `${path} exceeds the maximum formula size.`;
  if (!isPlainObject(value)) return `${path} must be a formula AST JSON object.`;

  if (value.type === "literal") {
    const keysError = requireExactKeys(value, path, ["type", "value"]);
    if (keysError) return keysError;
    return isPropertyValue(value.value)
      ? null
      : `${path}.value must be a string, finite number, boolean, or string array.`;
  }
  if (value.type === "property") {
    const keysError = requireExactKeys(value, path, ["type", "name"]);
    if (keysError) return keysError;
    return isPropertyKey(value.name) ? null : `${path}.name must be a legal property key.`;
  }
  if (value.type === "arithmetic" || value.type === "comparison") {
    const keysError = requireExactKeys(value, path, ["type", "operator", "left", "right"]);
    if (keysError) return keysError;
    const operators =
      value.type === "arithmetic"
        ? new Set(["+", "-", "*", "/", "%"])
        : new Set(["==", "!=", "<", "<=", ">", ">="]);
    if (!operators.has(value.operator as string)) return `${path}.operator is not supported.`;
    return (
      validateExpression(value.left, `${path}.left`, budget, depth + 1) ??
      validateExpression(value.right, `${path}.right`, budget, depth + 1)
    );
  }
  if (value.type === "boolean") {
    if (value.operator === "not") {
      const keysError = requireExactKeys(value, path, ["type", "operator", "operand"]);
      if (keysError) return keysError;
      return validateExpression(value.operand, `${path}.operand`, budget, depth + 1);
    }
    const keysError = requireExactKeys(value, path, ["type", "operator", "operands"]);
    if (keysError) return keysError;
    if (value.operator !== "and" && value.operator !== "or") {
      return `${path}.operator must be and, or, or not.`;
    }
    if (!Array.isArray(value.operands) || value.operands.length === 0) {
      return `${path}.operands must be a non-empty array.`;
    }
    for (let index = 0; index < value.operands.length; index += 1) {
      const message = validateExpression(
        value.operands[index],
        `${path}.operands[${index}]`,
        budget,
        depth + 1
      );
      if (message) return message;
    }
    return null;
  }
  if (value.type === "concat") {
    const keysError = requireExactKeys(value, path, ["type", "values"]);
    if (keysError) return keysError;
    if (!Array.isArray(value.values)) return `${path}.values must be an array.`;
    for (let index = 0; index < value.values.length; index += 1) {
      const message = validateExpression(
        value.values[index],
        `${path}.values[${index}]`,
        budget,
        depth + 1
      );
      if (message) return message;
    }
    return null;
  }
  if (value.type === "if") {
    const keysError = requireExactKeys(value, path, ["type", "condition", "then", "else"]);
    if (keysError) return keysError;
    return (
      validateExpression(value.condition, `${path}.condition`, budget, depth + 1) ??
      validateExpression(value.then, `${path}.then`, budget, depth + 1) ??
      validateExpression(value.else, `${path}.else`, budget, depth + 1)
    );
  }
  return `${path}.type must be literal, property, arithmetic, comparison, boolean, concat, or if.`;
}

function findDependencyCycle(definitions: Record<string, unknown>): string[] | null {
  const dependencies = new Map<string, string[]>();
  for (const name of Object.keys(definitions).sort(compareText)) {
    const field = definitions[name] as PageComputedPropertyDefinition;
    const names = new Set<string>();
    if (field.type === "formula") collectFormulaDependencies(field.expression, names);
    if (field.type === "rollup") {
      names.add(field.relation);
      names.add(field.property);
    }
    dependencies.set(
      name,
      [...names].filter((dependency) => Object.hasOwn(definitions, dependency)).sort(compareText)
    );
  }

  const visited = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];
  const visit = (name: string): string[] | null => {
    if (active.has(name)) {
      const start = stack.indexOf(name);
      return [...stack.slice(start), name];
    }
    if (visited.has(name)) return null;
    active.add(name);
    stack.push(name);
    for (const dependency of dependencies.get(name) ?? []) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    stack.pop();
    active.delete(name);
    visited.add(name);
    return null;
  };
  for (const name of [...dependencies.keys()].sort(compareText)) {
    const cycle = visit(name);
    if (cycle) return cycle;
  }
  return null;
}

function collectFormulaDependencies(expression: PageFormulaExpression, names: Set<string>): void {
  if (expression.type === "property") {
    names.add(expression.name);
    return;
  }
  if (expression.type === "literal") return;
  if (expression.type === "arithmetic" || expression.type === "comparison") {
    collectFormulaDependencies(expression.left, names);
    collectFormulaDependencies(expression.right, names);
    return;
  }
  if (expression.type === "boolean") {
    if (expression.operator === "not") collectFormulaDependencies(expression.operand, names);
    else expression.operands.forEach((operand) => collectFormulaDependencies(operand, names));
    return;
  }
  if (expression.type === "concat") {
    expression.values.forEach((value) => collectFormulaDependencies(value, names));
    return;
  }
  collectFormulaDependencies(expression.condition, names);
  collectFormulaDependencies(expression.then, names);
  collectFormulaDependencies(expression.else, names);
}

function requireExactKeys(
  value: Record<string, unknown>,
  path: string,
  expected: readonly string[],
  optional: readonly string[] = []
): string | null {
  const allowed = new Set(expected);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) return `${path}.${unknown} is not part of this schema version.`;
  const optionalKeys = new Set(optional);
  const missing = expected.find((key) => !optionalKeys.has(key) && !Object.hasOwn(value, key));
  return missing ? `${path}.${missing} is required.` : null;
}

function isPropertyKey(value: unknown): value is string {
  return typeof value === "string" && value !== "id" && PROPERTY_KEY_PATTERN.test(value);
}

function isPropertyValue(value: unknown): value is PageComputedPropertyValue {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (Array.isArray(value) && value.every((item) => typeof item === "string"))
  );
}

function cloneProperties(
  properties: Record<string, PageComputedPropertyValue>
): Record<string, PageComputedPropertyValue> {
  return Object.fromEntries(
    Object.keys(properties)
      .sort(compareText)
      .map((name) => [name, cloneValue(properties[name] as PageComputedPropertyValue)])
  );
}

function cloneValue(value: PageComputedPropertyValue): PageComputedPropertyValue {
  return Array.isArray(value) ? [...value] : value;
}

function equalValues(left: PageComputedPropertyValue, right: PageComputedPropertyValue): boolean {
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

function valueKind(value: PageComputedPropertyValue): string {
  return Array.isArray(value) ? "strings" : typeof value;
}

function pageIdentity(page: Pick<PageComputedPropertiesCatalogRow, "id" | "path">): string {
  return `${page.path}\0${page.id}`;
}

function fieldIdentity(
  page: Pick<PageComputedPropertiesCatalogRow, "id" | "path">,
  property: string
): string {
  return `${pageIdentity(page)}\0${property}`;
}

function comparePages(
  left: PageComputedPropertiesCatalogRow,
  right: PageComputedPropertiesCatalogRow
): number {
  return compareText(left.path, right.path) || compareText(left.id, right.id);
}

function compareRelationTargets(
  left: PageComputedRelationTarget,
  right: PageComputedRelationTarget
): number {
  return compareText(left.path, right.path) || compareText(left.id, right.id);
}

function compareDiagnostics(
  left: PageComputedPropertyDiagnostic,
  right: PageComputedPropertyDiagnostic
): number {
  return (
    compareText(left.rowPath, right.rowPath) ||
    compareText(left.property, right.property) ||
    compareText(left.code, right.code) ||
    compareText(left.message, right.message)
  );
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

function invalidDefinition(
  code: PageComputedPropertiesDefinitionDiagnostic["code"],
  message: string
): PageComputedPropertiesDefinitionResult {
  return { ok: false, diagnostics: [{ code, message }] };
}
