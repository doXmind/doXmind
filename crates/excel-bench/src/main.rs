//! Spike: parse an .xlsx with calamine and emit a JSON shape close to the
//! Python `parse_workbook` pipeline. Goal is benchmarking the hot path
//! (load + iterate cells + capture formulas/merges/dimensions), NOT
//! reproducing every style attribute — calamine's stable surface doesn't
//! expose enough of the styles tree for that, and full ECMA-376 styles
//! would need a different crate (umya-spreadsheet) which has its own
//! perf profile.
//!
//! Usage:
//!   excel-bench <path-to-xlsx> [--json]
//!
//! Without --json: prints `parse_ms=<float>` to stdout (the bench driver
//! parses this).
//! With --json: prints the full parsed structure to stdout for correctness
//! diffing against the Python output.

use std::env;
use std::path::PathBuf;
use std::process;
use std::time::Instant;

use calamine::{open_workbook, Data, Reader, Xlsx};
use serde::Serialize;

const MAX_SHEETS: usize = 64;
const MAX_ROWS: usize = 5000;
const MAX_COLS: usize = 200;

#[derive(Serialize)]
struct WorkbookDto {
    version: u32,
    sheets: Vec<SheetDto>,
    truncated: TruncatedDto,
}

#[derive(Serialize)]
struct SheetDto {
    id: String,
    name: String,
    index: usize,
    #[serde(rename = "rowCount")]
    row_count: usize,
    #[serde(rename = "colCount")]
    col_count: usize,
    merges: Vec<MergeDto>,
    cells: Vec<CellDto>,
}

#[derive(Serialize)]
struct MergeDto {
    top: usize,
    left: usize,
    bottom: usize,
    right: usize,
}

#[derive(Serialize)]
struct CellDto {
    row: usize,
    col: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    formula: Option<String>,
}

#[derive(Serialize)]
struct TruncatedDto {
    sheets: bool,
    #[serde(rename = "rowsBy")]
    rows_by: std::collections::BTreeMap<String, bool>,
    #[serde(rename = "colsBy")]
    cols_by: std::collections::BTreeMap<String, bool>,
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: excel-bench <path-to-xlsx> [--json]");
        process::exit(2);
    }
    let path = PathBuf::from(&args[1]);
    let emit_json = args.iter().any(|a| a == "--json");

    let start = Instant::now();
    let dto = match parse(&path) {
        Ok(dto) => dto,
        Err(err) => {
            eprintln!("parse failed: {err}");
            process::exit(1);
        }
    };
    let elapsed = start.elapsed();

    if emit_json {
        // Stream to stdout so massive sheets don't blow up RSS through a
        // single intermediate String.
        let stdout = std::io::stdout();
        let handle = stdout.lock();
        serde_json::to_writer(handle, &dto).expect("json serialize");
        println!();
    }
    eprintln!("parse_ms={:.3}", elapsed.as_secs_f64() * 1000.0);
    println!("parse_ms={:.3}", elapsed.as_secs_f64() * 1000.0);
}

fn parse(path: &PathBuf) -> Result<WorkbookDto, String> {
    // Two passes mirror the Python implementation's `data_only` toggle: one
    // pass with formulas (so we capture the raw `=A1+B1` strings), one with
    // cached values (so the editor can render results without recomputing).
    let mut wb_formulas: Xlsx<_> =
        open_workbook(path).map_err(|e| format!("open formulas: {e}"))?;
    let mut wb_values: Xlsx<_> = open_workbook(path).map_err(|e| format!("open values: {e}"))?;

    let names = wb_formulas.sheet_names();
    let truncated_sheets = names.len() > MAX_SHEETS;

    let mut sheets = Vec::new();
    let mut rows_by = std::collections::BTreeMap::new();
    let mut cols_by = std::collections::BTreeMap::new();

    for (index, name) in names.iter().enumerate().take(MAX_SHEETS) {
        let sheet_id = format!("sheet-{index}");
        // Cell values + their formulas live on different ranges; calamine
        // gives them via worksheet_range and worksheet_formula respectively.
        let value_range = wb_values
            .worksheet_range(name)
            .map_err(|e| format!("read values for {name}: {e}"))?;
        let formula_range = wb_formulas
            .worksheet_formula(name)
            .map_err(|e| format!("read formulas for {name}: {e}"))?;

        let raw_rows = value_range.height();
        let raw_cols = value_range.width();
        let row_count = raw_rows.min(MAX_ROWS);
        let col_count = raw_cols.min(MAX_COLS);

        let mut cells = Vec::new();
        for row_idx in 0..row_count {
            for col_idx in 0..col_count {
                let value_cell = value_range.get((row_idx, col_idx));
                let formula_cell = formula_range.get((row_idx, col_idx));
                let formula = formula_cell.and_then(|f| {
                    if f.is_empty() {
                        None
                    } else {
                        Some(f.clone())
                    }
                });
                let value = value_cell.and_then(data_to_json);
                if value.is_none() && formula.is_none() {
                    continue;
                }
                cells.push(CellDto {
                    row: row_idx,
                    col: col_idx,
                    value,
                    formula,
                });
            }
        }

        let merges = match wb_formulas.worksheet_merge_cells(name) {
            Some(Ok(ranges)) => ranges
                .into_iter()
                .map(|d| MergeDto {
                    top: d.start.0 as usize,
                    left: d.start.1 as usize,
                    bottom: d.end.0 as usize,
                    right: d.end.1 as usize,
                })
                .collect(),
            _ => Vec::new(),
        };

        if raw_rows > row_count {
            rows_by.insert(sheet_id.clone(), true);
        }
        if raw_cols > col_count {
            cols_by.insert(sheet_id.clone(), true);
        }

        sheets.push(SheetDto {
            id: sheet_id,
            name: name.clone(),
            index,
            row_count,
            col_count,
            merges,
            cells,
        });
    }

    Ok(WorkbookDto {
        version: 1,
        sheets,
        truncated: TruncatedDto {
            sheets: truncated_sheets,
            rows_by,
            cols_by,
        },
    })
}

fn data_to_json(cell: &Data) -> Option<serde_json::Value> {
    match cell {
        Data::Empty => None,
        Data::String(s) => Some(serde_json::Value::String(s.clone())),
        Data::Float(f) => serde_json::Number::from_f64(*f).map(serde_json::Value::Number),
        Data::Int(i) => Some(serde_json::Value::Number((*i).into())),
        Data::Bool(b) => Some(serde_json::Value::Bool(*b)),
        Data::DateTime(dt) => Some(serde_json::Value::String(dt.to_string())),
        Data::DateTimeIso(s) => Some(serde_json::Value::String(s.clone())),
        Data::DurationIso(s) => Some(serde_json::Value::String(s.clone())),
        Data::Error(e) => Some(serde_json::Value::String(format!("{e:?}"))),
    }
}
