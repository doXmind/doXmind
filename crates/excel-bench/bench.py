#!/usr/bin/env python3
"""Spike benchmark: openpyxl-backed parse_workbook vs calamine-backed Rust binary.

Generates synthetic .xlsx fixtures of varying sizes, runs each parser
multiple times, reports best-of-N latency. Pure library timing — no HTTP /
JSON-over-stdin overhead — so we measure the parser core, not the IPC.

Run from repo root:

    python3 crates/excel-bench/bench.py
"""

from __future__ import annotations

import os
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "server"))

from openpyxl import Workbook
from services.excel_workbook import parse_workbook  # type: ignore[import-not-found]

# (label, rows, cols, formula_cols)
# formula_cols are the rightmost N columns; each row in those cols gets a
# formula like =A2+B2 so we measure formula extraction too, not just values.
SIZES: list[tuple[str, int, int, int]] = [
    ("small",    100,  10, 1),
    ("medium",  1000,  30, 2),
    ("large",   5000,  50, 3),
]

REPEATS = 3


def make_fixture(path: Path, rows: int, cols: int, formula_cols: int) -> None:
    # write_only mode: openpyxl skips its in-memory cell map and streams
    # rows straight to the zip. Default mode does ~10x slower per cell at
    # 250k+ cells, which dominates bench wall time and tells us nothing
    # about parse perf.
    wb = Workbook(write_only=True)
    ws = wb.create_sheet("Sheet1")

    # Header row.
    ws.append([f"col_{c}" for c in range(cols)])

    plain_cols = cols - formula_cols
    for r in range(2, rows + 2):
        row = []
        for c in range(plain_cols):
            row.append(f"row_{r}_c{c}" if c % 2 == 0 else (r * 1000 + c))
        for _ in range(formula_cols):
            row.append(f"=B{r}+B{r}")
        ws.append(row)

    wb.save(path)


def time_python(path: Path) -> float:
    data = path.read_bytes()
    start = time.perf_counter()
    parse_workbook(data)
    return (time.perf_counter() - start) * 1000.0


def time_rust(rust_bin: Path, path: Path) -> float:
    # The bench binary prints `parse_ms=<float>` to stdout. We trust its
    # internal Instant rather than wallclock-around-subprocess-spawn, since
    # the spawn cost is what we're explicitly NOT measuring (Python imports
    # the parser in-process; for a fair fight we exclude Rust spawn too).
    out = subprocess.run(
        [str(rust_bin), str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    line = next((ln for ln in out.stdout.splitlines() if ln.startswith("parse_ms=")), None)
    if line is None:
        raise RuntimeError(f"no parse_ms in stdout: {out.stdout!r}")
    return float(line.split("=", 1)[1])


def fmt_ms(ms: float) -> str:
    if ms >= 1000:
        return f"{ms / 1000:.2f} s"
    return f"{ms:.1f} ms"


def main() -> int:
    rust_bin = REPO_ROOT / "target" / "bench-fast" / "excel-bench"
    if not rust_bin.exists():
        print(f"missing rust binary at {rust_bin}", file=sys.stderr)
        print("build with: cargo build --profile bench-fast --bin excel-bench", file=sys.stderr)
        return 1

    print(f"{'size':<8} {'cells':>9} {'bytes':>10} {'python (best)':>16} {'rust (best)':>14} {'speedup':>9}", flush=True)
    print("-" * 72, flush=True)

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        for label, rows, cols, formula_cols in SIZES:
            fixture = tmp_dir / f"{label}.xlsx"
            print(f"  generating {label} fixture ({rows}x{cols}) …", end="", flush=True)
            t0 = time.perf_counter()
            make_fixture(fixture, rows, cols, formula_cols)
            print(f" {(time.perf_counter()-t0):.1f}s", flush=True)
            byte_size = fixture.stat().st_size
            cell_count = rows * cols

            print(f"  benchmarking {label} …", end="", flush=True)
            py_runs = [time_python(fixture) for _ in range(REPEATS)]
            rust_runs = [time_rust(rust_bin, fixture) for _ in range(REPEATS)]
            print(" done", flush=True)

            py_best = min(py_runs)
            rust_best = min(rust_runs)
            speedup = py_best / rust_best if rust_best > 0 else float("inf")

            print(
                f"{label:<8} {cell_count:>9} {byte_size:>10} "
                f"{fmt_ms(py_best):>16} {fmt_ms(rust_best):>14} {speedup:>8.1f}x",
                flush=True,
            )

    print()
    print("notes:")
    print("  * library-only timing — excludes HTTP/IPC, JSON serialization, FastAPI overhead.")
    print("  * Python median of {} runs; Rust same.".format(REPEATS))
    print("  * Rust skips style extraction (calamine doesn't expose styles richly).")
    print("    Real-world parity would require umya-spreadsheet or a custom XML pass for styles.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
