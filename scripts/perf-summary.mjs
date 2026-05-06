#!/usr/bin/env node
// Aggregate the backend perf log written by server/lib/timing.py.
//
// Default log path: ~/.doxmind/perf.log (override with $DOXMIND_PERF_LOG or
// the first CLI arg). Outputs a compact table with count, p50, p95, max
// per span name. Pipe into `column -t` for nicer alignment if you want.
//
// Usage:
//   node scripts/perf-summary.mjs
//   node scripts/perf-summary.mjs path/to/perf.log
//   node scripts/perf-summary.mjs --json | jq '.["doc_read.total"]'

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

const args = process.argv.slice(2).filter((a) => a !== "--json");
const wantJson = process.argv.includes("--json");
const logPath = resolve(
  args[0] || process.env.DOXMIND_PERF_LOG || resolve(homedir(), ".doxmind/perf.log")
);

function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

async function main() {
  let raw;
  try {
    raw = await readFile(logPath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      process.stderr.write(
        `no perf log at ${logPath}\nrun the backend with DOXMIND_PERF=1 first.\n`
      );
      process.exit(1);
    }
    throw err;
  }

  const buckets = new Map();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const { name, ms } = row;
    if (typeof name !== "string" || typeof ms !== "number") continue;
    const arr = buckets.get(name);
    if (arr) arr.push(ms);
    else buckets.set(name, [ms]);
  }

  if (buckets.size === 0) {
    process.stderr.write(`perf log at ${logPath} has no usable rows\n`);
    process.exit(1);
  }

  const stats = {};
  for (const [name, durations] of buckets) {
    const sorted = [...durations].sort((a, b) => a - b);
    stats[name] = {
      count: durations.length,
      p50: +quantile(sorted, 0.5).toFixed(2),
      p95: +quantile(sorted, 0.95).toFixed(2),
      max: +sorted[sorted.length - 1].toFixed(2),
      total: +durations.reduce((s, d) => s + d, 0).toFixed(2),
    };
  }

  if (wantJson) {
    process.stdout.write(JSON.stringify(stats, null, 2) + "\n");
    return;
  }

  const rows = Object.entries(stats).sort((a, b) => b[1].p95 - a[1].p95);
  const widthName = Math.min(40, Math.max(8, ...rows.map(([n]) => n.length)));
  const fmtRow = (name, count, p50, p95, max, total) =>
    [
      name.padEnd(widthName),
      String(count).padStart(6),
      p50.padStart(8),
      p95.padStart(8),
      max.padStart(8),
      total.padStart(10),
    ].join("  ");

  process.stdout.write(fmtRow("name", "n", "p50ms", "p95ms", "maxms", "totalms") + "\n");
  process.stdout.write("-".repeat(widthName + 6 + 8 + 8 + 8 + 10 + 10) + "\n");
  for (const [name, s] of rows) {
    process.stdout.write(
      fmtRow(name, s.count, s.p50.toFixed(2), s.p95.toFixed(2), s.max.toFixed(2), s.total.toFixed(2)) +
        "\n"
    );
  }
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message || err}\n`);
  process.exit(1);
});
