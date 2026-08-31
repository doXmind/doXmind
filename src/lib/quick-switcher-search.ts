import type { FileItem } from "@/types";
import { SCORE_PREFIX, scoreFuzzyText } from "@/lib/fuzzy-match";

/** A Page's containing folder, shown only when its name alone would be ambiguous. */
export function quickSwitcherFolder(file: FileItem): string {
  const path = file.storageHandle?.relPath ?? file.storageHandle?.path ?? "";
  const cut = path.lastIndexOf("/");
  return cut > 0 ? path.slice(0, cut) : "";
}

/** Names carried by more than one Page, so the list can disambiguate exactly those rows. */
export function duplicateNames(files: readonly FileItem[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const file of files) {
    const key = file.name.toLocaleLowerCase();
    if (seen.has(key)) repeated.add(key);
    seen.add(key);
  }
  return repeated;
}

/**
 * Pages matching `query`, best first.
 *
 * An empty query keeps the recency order the caller supplied, which is what makes the switcher a
 * most-recently-used ring before the user types anything. Once they do, the folder path scores too,
 * so `projects/road` finds a Page the filename alone would not.
 */
export function searchQuickSwitcherFiles(
  files: readonly FileItem[],
  query: string
): readonly FileItem[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return files;
  return files
    .map((file, index) => ({ file, index, score: scoreQuickSwitcherFile(file, normalized) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.file);
}

function scoreQuickSwitcherFile(file: FileItem, query: string): number {
  const name = scoreFuzzyText(file.name.toLocaleLowerCase(), query);
  if (name === SCORE_PREFIX) return name;
  // A path hit is real but weaker than the filename's: typing `roadmap` should not rank every
  // Page inside a `roadmap/` folder above the Page actually called Roadmap.
  const folder = quickSwitcherFolder(file);
  const path = folder ? scoreFuzzyText(`${folder}/${file.name}`.toLocaleLowerCase(), query) : 0;
  return Math.max(name, path ? path / 2 : 0);
}
