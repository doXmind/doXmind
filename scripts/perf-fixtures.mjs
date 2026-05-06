#!/usr/bin/env node
// Generate deterministic markdown fixtures for performance scenarios.
//
// Writes:
//   testdata/perf/small.md  — ~100 lines, baseline.
//   testdata/perf/large.md  — ~6000 lines with KaTeX, mermaid, database blocks,
//                             and 200 internal page-links so the database-id
//                             extraction and link-resolution costs surface.
//
// PDF/XLSX fixtures are NOT generated here — bring your own large PDF /
// workbook and drop them in testdata/perf/. The README at the bottom of
// this file documents what to drop in.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const outDir = resolve(root, "testdata/perf");

const SMALL_LINES = 100;
const LARGE_LINES = 6000;
const LARGE_MATH_BLOCKS = 60;
const LARGE_MERMAID_BLOCKS = 5;
const LARGE_DATABASE_BLOCKS = 3;
const LARGE_INTERNAL_LINKS = 200;

function paragraph(idx) {
  // Stable Lorem-ish that varies per index so paragraph dedupe doesn't
  // accidentally compress the file.
  const seed = (idx * 2654435761) >>> 0;
  const rotor = "abcdefghijklmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < 20; i++) {
    const wordLen = 3 + ((seed >> (i % 11)) & 7);
    let word = "";
    for (let j = 0; j < wordLen; j++) {
      word += rotor[(seed + j * (i + 1)) % rotor.length];
    }
    out += word + " ";
  }
  return out.trim() + ".";
}

function buildSmall() {
  const lines = [
    "---",
    "title: Perf Small",
    "id: 11111111-1111-1111-1111-111111111111",
    "---",
    "",
    "# Perf Small",
    "",
    "Baseline fixture for switch / first-paint measurement.",
    "",
    "| col1 | col2 | col3 |",
    "| --- | --- | --- |",
    "| a | b | c |",
    "| d | e | f |",
    "",
  ];
  while (lines.length < SMALL_LINES) {
    lines.push(paragraph(lines.length));
    if (lines.length % 5 === 0) lines.push("");
  }
  return lines.join("\n");
}

function buildLarge() {
  const lines = [
    "---",
    "title: Perf Large",
    "id: 22222222-2222-2222-2222-222222222222",
    "---",
    "",
    "# Perf Large",
    "",
    "Large fixture: KaTeX + mermaid + database blocks + many internal links.",
    "",
  ];

  // Sprinkle math, mermaid, database, and links every N lines so the
  // structure looks plausibly real (not all clustered at the top).
  const mathEvery = Math.floor(LARGE_LINES / LARGE_MATH_BLOCKS);
  const mermaidEvery = Math.floor(LARGE_LINES / LARGE_MERMAID_BLOCKS);
  const dbEvery = Math.floor(LARGE_LINES / LARGE_DATABASE_BLOCKS);
  const linkEvery = Math.floor(LARGE_LINES / LARGE_INTERNAL_LINKS);

  let mathIdx = 0;
  let mermaidIdx = 0;
  let dbIdx = 0;
  let linkIdx = 0;

  for (let i = 0; i < LARGE_LINES; i++) {
    if (mathIdx < LARGE_MATH_BLOCKS && i > 0 && i % mathEvery === 0) {
      lines.push("");
      lines.push("$$");
      lines.push(`f_{${mathIdx}}(x) = \\sum_{k=0}^{${mathIdx + 3}} \\frac{x^k}{k!}`);
      lines.push("$$");
      lines.push("");
      mathIdx += 1;
      continue;
    }
    if (mermaidIdx < LARGE_MERMAID_BLOCKS && i > 0 && i % mermaidEvery === 0) {
      lines.push("");
      lines.push("```mermaid");
      lines.push("flowchart LR");
      lines.push(`  A${mermaidIdx} --> B${mermaidIdx} --> C${mermaidIdx}`);
      lines.push("```");
      lines.push("");
      mermaidIdx += 1;
      continue;
    }
    if (dbIdx < LARGE_DATABASE_BLOCKS && i > 0 && i % dbEvery === 0) {
      const id = `db00${dbIdx}-0000-0000-0000-000000000000`;
      lines.push("");
      lines.push(`<!-- database:${id} -->`);
      lines.push(`<div data-database-id="${id}"></div>`);
      lines.push("");
      dbIdx += 1;
      continue;
    }
    if (linkIdx < LARGE_INTERNAL_LINKS && i > 0 && i % linkEvery === 0) {
      lines.push(`See also: [[link-target-${linkIdx}]]`);
      linkIdx += 1;
      continue;
    }
    if (i % 80 === 0) {
      lines.push("");
      lines.push(`## Section ${Math.floor(i / 80)}`);
      lines.push("");
    }
    lines.push(paragraph(i));
  }

  return lines.join("\n");
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const small = buildSmall();
  const large = buildLarge();
  await writeFile(resolve(outDir, "small.md"), small, "utf8");
  await writeFile(resolve(outDir, "large.md"), large, "utf8");
  await writeFile(
    resolve(outDir, "README.txt"),
    [
      "Perf fixtures (regenerate with `node scripts/perf-fixtures.mjs`).",
      "",
      "Files generated:",
      `  small.md (${small.length} bytes)`,
      `  large.md (${large.length} bytes, ~${LARGE_LINES} lines)`,
      "",
      "Drop your own (don't commit):",
      "  medium.pdf  — 20-page mixed PDF",
      "  large.pdf   — 200+ page text-heavy PDF",
      "  medium.xlsx — 10 sheets, ~50k cells, mixed formulas + styles",
      "",
      "Then enable perf logging and open the workspace:",
      "  DOXMIND_PERF=1 npm run dev:all",
      "  open the testdata/perf folder in doXmind, append ?perf=1 to the URL.",
      "",
      "Aggregate backend log:",
      "  node scripts/perf-summary.mjs",
    ].join("\n"),
    "utf8"
  );
  process.stdout.write(`wrote ${outDir}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message || err}\n`);
  process.exit(1);
});
