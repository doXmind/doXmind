#!/usr/bin/env node
// Generate a deterministic Markdown stress document for outline perf testing.
//
// Default output: src/__tests__/fixtures/outline-stress.md
// Default size:   900 headings, levels cycling through 1,2,3
//
// Same flags ⇒ byte-identical output. No timestamps, no Date.now(), no
// unseeded randomness. The fixture interleaves short paragraphs and
// occasional fenced-code / display-math blocks so it also exercises custom
// node views in the editor.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const DEFAULT_COUNT = 900;
const DEFAULT_LEVELS = "1,2,3";
const DEFAULT_OUT = "src/__tests__/fixtures/outline-stress.md";

const CODE_BLOCK_EVERY = 50;
const MATH_BLOCK_EVERY = 75;

function parseArgs(argv) {
  const args = { count: DEFAULT_COUNT, levels: DEFAULT_LEVELS, out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--count") {
      const n = Number.parseInt(value, 10);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--count requires a positive integer (got: ${value})`);
      }
      args.count = n;
      i += 1;
    } else if (flag === "--levels") {
      if (typeof value !== "string" || value.length === 0) {
        throw new Error(`--levels requires a comma-separated list (got: ${value})`);
      }
      args.levels = value;
      i += 1;
    } else if (flag === "--out") {
      if (typeof value !== "string" || value.length === 0) {
        throw new Error(`--out requires a path (got: ${value})`);
      }
      args.out = value;
      i += 1;
    } else {
      throw new Error(`unknown flag: ${flag}`);
    }
  }
  return args;
}

function parseLevels(csv) {
  const parts = csv.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error(`--levels must contain at least one level (got: "${csv}")`);
  }
  const levels = parts.map((p) => {
    const n = Number.parseInt(p, 10);
    if (!Number.isInteger(n) || n < 1 || n > 6) {
      throw new Error(`--levels entries must be integers 1..6 (got: "${p}")`);
    }
    return n;
  });
  return levels;
}

function headingText(idx, level) {
  return `Heading ${idx + 1} (L${level})`;
}

function paragraphFor(headingIdx, paragraphIdx) {
  const seeds = [
    "Deterministic prose anchored to heading",
    "Stress fixture paragraph for heading",
    "Outline benchmark filler tied to heading",
    "Generated placeholder content under heading",
  ];
  const lead = seeds[(headingIdx + paragraphIdx) % seeds.length];
  return `${lead} ${headingIdx + 1}, paragraph ${paragraphIdx + 1}.`;
}

function codeBlockFor(headingIdx) {
  return [
    "```ts",
    `// generated snippet anchored to heading ${headingIdx + 1}`,
    `export const sample${headingIdx + 1} = (n: number): number => n * ${headingIdx + 1};`,
    "```",
  ];
}

function mathBlockFor(headingIdx) {
  return [
    "$$",
    `S_{${headingIdx + 1}} = \\sum_{k=1}^{${headingIdx + 1}} \\frac{1}{k^2}`,
    "$$",
  ];
}

function buildDocument({ count, levels }) {
  const lines = [];
  for (let i = 0; i < count; i++) {
    const level = levels[i % levels.length];
    const hashes = "#".repeat(level);
    lines.push(`${hashes} ${headingText(i, level)}`);
    lines.push("");

    // Deterministic 1–2 paragraphs based on index parity.
    const paragraphCount = (i % 2 === 0) ? 1 : 2;
    for (let p = 0; p < paragraphCount; p++) {
      lines.push(paragraphFor(i, p));
      lines.push("");
    }

    if ((i + 1) % CODE_BLOCK_EVERY === 0) {
      lines.push(...codeBlockFor(i));
      lines.push("");
    }
    if ((i + 1) % MATH_BLOCK_EVERY === 0) {
      lines.push(...mathBlockFor(i));
      lines.push("");
    }
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const levels = parseLevels(args.levels);
  const doc = buildDocument({ count: args.count, levels });

  const outPath = resolve(root, args.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, doc, "utf8");
  process.stdout.write(`wrote ${outPath}: ${args.count} headings\n`);
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message || err}\n`);
  process.exit(1);
});
