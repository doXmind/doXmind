import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import zh from "@/messages/zh.json";

const lookup = (source: unknown, key: string) =>
  key
    .split(".")
    .reduce<unknown>((acc, part) => (acc as Record<string, unknown> | undefined)?.[part], source);

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!/node_modules|__tests__/.test(full)) sourceFiles(full, found);
    } else if (/\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

/**
 * A key used by a component but missing from BOTH catalogs renders as its own dotted path —
 * "settings.aboutCheckUpdates" sat on a button in the About pane. Comparing the two catalogs
 * to each other cannot see it, because they are missing it equally; only the code can say
 * which keys have to exist.
 *
 * A file may bind several namespaces, and they are often all called `t`, so a key is accepted
 * when it resolves under any namespace that file uses. That is looser than per-scope binding
 * and still catches a key that exists under none of them.
 */
describe("message keys used in the app", () => {
  const usages = sourceFiles("src").flatMap((file) => {
    const source = readFileSync(file, "utf8");
    // Only variables actually bound to useTranslations, so `toLocaleDateString("en-US")`
    // and friends are not mistaken for translator calls.
    const bindings = [
      ...source.matchAll(
        /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*useTranslations\(\s*(?:"([^"]*)")?\s*\)/g
      ),
    ];
    if (bindings.length === 0) return [];
    const namespaces = [...new Set(bindings.map((match) => match[2] ?? ""))];
    const names = [...new Set(bindings.map((match) => match[1]))];
    const call = new RegExp(
      `\\b(?:${names.map((name) => name.replace(/\$/g, "\\$")).join("|")})(?:\\.rich)?\\(\\s*"([^"]+)"`,
      "g"
    );
    return [...source.matchAll(call)].map((match) => ({ file, key: match[1], namespaces }));
  });

  it("finds the translator calls it is meant to be checking", () => {
    expect(usages.length).toBeGreaterThan(200);
  });

  it("resolves every key in both catalogs", () => {
    const unresolved = usages
      .filter(({ key, namespaces }) =>
        namespaces.every((namespace) => {
          const full = namespace ? `${namespace}.${key}` : key;
          return lookup(en, full) === undefined || lookup(zh, full) === undefined;
        })
      )
      .map(({ file, key, namespaces }) => `${file}: ${key} (tried ${namespaces.join(", ")})`);

    expect([...new Set(unresolved)]).toEqual([]);
  });
});
