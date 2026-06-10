"""Markdown→HTML conformance (#152): pin the Python importer against a committed
snapshot so drift is caught. Shared corpus + Rust/marked snapshots are under
`conformance/`; divergences are catalogued in `conformance/REPORT.md`.

Refresh after an intentional change:
    DOXMIND_UPDATE_CONFORMANCE=1 pytest tests/test_markdown_conformance.py
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from services.sidecar_io import markdown_to_html

ROOT = Path(__file__).resolve().parents[2]
CORPUS = json.loads((ROOT / "conformance" / "corpus.json").read_text())
EXPECTED_PATH = ROOT / "conformance" / "expected" / "python.json"


def test_update_or_compare() -> None:
    if os.environ.get("DOXMIND_UPDATE_CONFORMANCE") == "1":
        out = {c["name"]: markdown_to_html(c["md"]) for c in CORPUS}
        EXPECTED_PATH.write_text(json.dumps(out, indent=2) + "\n")
        pytest.skip("snapshot updated")
    expected = json.loads(EXPECTED_PATH.read_text())
    for case in CORPUS:
        assert markdown_to_html(case["md"]) == expected[case["name"]], case["name"]
