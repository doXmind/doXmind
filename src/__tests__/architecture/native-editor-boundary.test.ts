import fs from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, expectTypeOf, it } from "vitest";

import type { DocumentContent } from "@/lib/storage";
import type { FileItem } from "@/types";

const PROJECT_ROOT = process.cwd();
const SOURCE_ROOT = path.join(PROJECT_ROOT, "src");
const NATIVE_ENTRY = path.join(SOURCE_ROOT, "editor/markdown-block/markdown-block-runtime.tsx");

describe("native editor dependency boundary", () => {
  it("has no statically reachable TipTap, ProseMirror, or legacy HTML importer", () => {
    const visited = new Set<string>();
    const violations: string[] = [];
    const pending = [NATIVE_ENTRY];

    while (pending.length > 0) {
      const filename = pending.pop();
      if (!filename || visited.has(filename)) continue;
      visited.add(filename);

      const source = fs.readFileSync(filename, "utf8");
      const sourceFile = ts.createSourceFile(
        filename,
        source,
        ts.ScriptTarget.Latest,
        true,
        filename.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      );

      for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement) || isTypeOnlyImport(statement)) continue;
        const specifier = statement.moduleSpecifier;
        if (!ts.isStringLiteral(specifier)) continue;
        if (
          specifier.text.startsWith("@tiptap/") ||
          specifier.text.startsWith("prosemirror-") ||
          specifier.text === "@/lib/markdown"
        ) {
          violations.push(`${path.relative(PROJECT_ROOT, filename)} -> ${specifier.text}`);
          continue;
        }
        const resolved = resolveLocalModule(filename, specifier.text);
        if (resolved) pending.push(resolved);
      }
    }

    expect(violations).toEqual([]);
    expect(visited).toContain(NATIVE_ENTRY);
  });

  it("keeps active Page contracts Markdown-only in memory", () => {
    expectTypeOf<DocumentContent>().not.toHaveProperty("html");
    expectTypeOf<DocumentContent>().not.toHaveProperty("editorHtml");
    expectTypeOf<DocumentContent>().not.toHaveProperty("browsingHtml");
    expectTypeOf<DocumentContent>().not.toHaveProperty("source");
    expectTypeOf<DocumentContent>().not.toHaveProperty("sourceState");
    expectTypeOf<DocumentContent>().not.toHaveProperty("extras");
    expectTypeOf<DocumentContent>().not.toHaveProperty("correlation");
    expectTypeOf<DocumentContent>().not.toHaveProperty("browsingRendererVersion");

    expectTypeOf<FileItem>().not.toHaveProperty("editorHtml");
    expectTypeOf<FileItem>().not.toHaveProperty("browsingHtml");
    expectTypeOf<FileItem>().not.toHaveProperty("contentMarkdown");
    expectTypeOf<FileItem>().not.toHaveProperty("sourceState");
    expectTypeOf<FileItem>().not.toHaveProperty("browsingRendererVersion");

    expect(fs.existsSync(path.join(SOURCE_ROOT, "lib/markdown.ts"))).toBe(false);
  });

  it("keeps removed editor and attachment stacks out of package manifests", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8")
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const packageLock = JSON.parse(
      fs.readFileSync(path.join(PROJECT_ROOT, "package-lock.json"), "utf8")
    ) as { packages?: Record<string, unknown> };
    const forbidden = (name: string) =>
      name.startsWith("@tiptap/") ||
      name.startsWith("prosemirror-") ||
      ["hyperformula", "pdf-lib", "pdfjs-dist"].includes(name);

    const directDependencies = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ];
    const lockedDependencies = Object.keys(packageLock.packages ?? {})
      .filter((key) => key.startsWith("node_modules/"))
      .map((key) => key.slice("node_modules/".length));

    expect(directDependencies.filter(forbidden)).toEqual([]);
    expect(lockedDependencies.filter(forbidden)).toEqual([]);
  });

  it("includes native editor sources in the Tailwind production scan", () => {
    const tailwindConfig = fs.readFileSync(path.join(PROJECT_ROOT, "tailwind.config.ts"), "utf8");

    expect(tailwindConfig).toContain('"./src/editor/**/*.{js,ts,jsx,tsx,mdx}"');
  });

  it("does not ship retired database, mobile-editor, Word, or paid-theme product surfaces", () => {
    for (const locale of ["en", "zh"]) {
      const messages = JSON.parse(
        fs.readFileSync(path.join(SOURCE_ROOT, `messages/${locale}.json`), "utf8")
      ) as Record<string, unknown>;
      expect(messages).not.toHaveProperty("mobile");
      expect(messages).not.toHaveProperty("database");
      const serialized = JSON.stringify(messages);
      for (const retiredKey of [
        "databaseDesc",
        "previousPrompts",
        "exportAsWord",
        "wordFormat",
        "voiceInput",
      ]) {
        expect(serialized).not.toContain(`\"${retiredKey}\"`);
      }
    }

    const themeSources = [
      "lib/themes/types.ts",
      "lib/themes/registry.ts",
      "hooks/use-theme-manager.ts",
    ]
      .map((relative) => fs.readFileSync(path.join(SOURCE_ROOT, relative), "utf8"))
      .join("\n");
    expect(themeSources).not.toMatch(/ThemeTier|premiumThemes|isPremiumUser|tier:\s*["']pro/);
  });
});

function isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name) return false;
  const bindings = clause.namedBindings;
  return (
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.every((element) => element.isTypeOnly)
  );
}

function resolveLocalModule(importer: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = path.join(SOURCE_ROOT, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(importer), specifier);
  } else {
    return null;
  }

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}
