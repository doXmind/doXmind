//! Markdown→HTML conformance (#152): pin the Rust importer against a committed
//! snapshot so drift is caught. Shared corpus + Python/marked snapshots are
//! under `conformance/`; divergences are catalogued in `conformance/REPORT.md`.
//!
//! Refresh after an intentional change:
//!   DOXMIND_UPDATE_CONFORMANCE=1 cargo test -p doxmind-sidecar --test markdown_conformance

use std::fs;
use std::path::PathBuf;

#[test]
fn rust_importer_matches_snapshot() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let corpus: Vec<serde_json::Value> =
        serde_json::from_str(&fs::read_to_string(root.join("conformance/corpus.json")).unwrap())
            .unwrap();
    let expected_path = root.join("conformance/expected/rust.json");

    if std::env::var("DOXMIND_UPDATE_CONFORMANCE").as_deref() == Ok("1") {
        let mut out = serde_json::Map::new();
        for case in &corpus {
            out.insert(
                case["name"].as_str().unwrap().to_string(),
                serde_json::Value::String(doxmind_sidecar::markdown_to_html(
                    case["md"].as_str().unwrap(),
                )),
            );
        }
        fs::write(
            &expected_path,
            serde_json::to_string_pretty(&out).unwrap() + "\n",
        )
        .unwrap();
        return;
    }

    let expected: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&expected_path).unwrap()).unwrap();
    for case in &corpus {
        let name = case["name"].as_str().unwrap();
        let got = doxmind_sidecar::markdown_to_html(case["md"].as_str().unwrap());
        assert_eq!(got, expected[name].as_str().unwrap(), "case: {name}");
    }
}
