"use client";

// Tiny in-app perf panel for development. Mount with `?perf=1` in the URL
// (or call `localStorage.DOXMIND_PERF = "1"` and refresh). Shows the latest
// `perfMeasure` results with mean / p95 grouped by name.
//
// This is opt-in: when the URL param / localStorage flag is missing, the
// surrounding `if` short-circuits before any rendering work happens.

import { useEffect, useState } from "react";

import { perfClear, perfEnabled, perfSnapshot, type PerfRecord } from "@/lib/perf";

type Group = {
  name: string;
  count: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  lastMs: number;
};

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

function aggregate(records: PerfRecord[]): Group[] {
  const buckets = new Map<string, number[]>();
  for (const r of records) {
    const arr = buckets.get(r.name);
    if (arr) arr.push(r.durationMs);
    else buckets.set(r.name, [r.durationMs]);
  }
  const groups: Group[] = [];
  for (const [name, durations] of buckets) {
    const sorted = [...durations].sort((a, b) => a - b);
    const sum = durations.reduce((s, d) => s + d, 0);
    groups.push({
      name,
      count: durations.length,
      meanMs: sum / durations.length,
      p50Ms: quantile(sorted, 0.5),
      p95Ms: quantile(sorted, 0.95),
      lastMs: durations[durations.length - 1],
    });
  }
  groups.sort((a, b) => b.p95Ms - a.p95Ms);
  return groups;
}

export function PerfOverlay() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!perfEnabled()) return;
    let raf = 0;
    const refresh = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setGroups(aggregate(perfSnapshot())));
    };
    refresh();
    window.addEventListener("doxmind:perf", refresh);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("doxmind:perf", refresh);
    };
  }, []);

  if (!perfEnabled()) return null;

  return (
    <div
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        zIndex: 99999,
        maxHeight: collapsed ? 32 : "60vh",
        width: 460,
        overflow: "auto",
        background: "rgba(15,15,20,0.92)",
        color: "#e5e7eb",
        font: "11px/1.4 ui-monospace, SFMono-Regular, monospace",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 8,
        boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
        padding: collapsed ? "4px 8px" : 8,
        backdropFilter: "blur(6px)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: collapsed ? 0 : 6,
        }}
      >
        <strong style={{ fontWeight: 600 }}>doxmind perf · {groups.length} spans</strong>
        <span style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={() => {
              perfClear();
              setGroups([]);
            }}
            style={btn}
          >
            clear
          </button>
          <button type="button" onClick={() => setCollapsed((c) => !c)} style={btn}>
            {collapsed ? "expand" : "hide"}
          </button>
        </span>
      </div>
      {!collapsed && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "#9ca3af", textAlign: "left" }}>
              <th style={th}>name</th>
              <th style={thNum}>n</th>
              <th style={thNum}>p50</th>
              <th style={thNum}>p95</th>
              <th style={thNum}>last</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.name}>
                <td style={td} title={g.name}>
                  {g.name}
                </td>
                <td style={tdNum}>{g.count}</td>
                <td style={tdNum}>{g.p50Ms.toFixed(1)}</td>
                <td style={tdNum}>{g.p95Ms.toFixed(1)}</td>
                <td style={tdNum}>{g.lastMs.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const btn: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  color: "#e5e7eb",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 4,
  padding: "1px 6px",
  cursor: "pointer",
  font: "inherit",
};

const th: React.CSSProperties = { padding: "2px 4px", fontWeight: 500 };
const thNum: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = {
  padding: "2px 4px",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: 240,
};
const tdNum: React.CSSProperties = {
  ...td,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};
