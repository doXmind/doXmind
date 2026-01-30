#!/usr/bin/env python3
"""Import mock files into the backend via API.

Env vars:
  API_BASE_URL   Base URL (default http://localhost:8000)
  DOXMIND_API_KEY   Optional API key for X-API-Key header
  AUTH_TOKEN     Optional Bearer token for Authorization header

Outputs:
  data/mock_files/imported_file_map.json
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request


ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data" / "mock_files"
MAPPING_FILE = DATA_DIR / "mapping.json"
OUTPUT_FILE = DATA_DIR / "imported_file_map.json"


def build_headers() -> dict[str, str]:
    headers = {
        "Content-Type": "application/json",
    }
    api_key = os.environ.get("DOXMIND_API_KEY")
    auth_token = os.environ.get("AUTH_TOKEN")

    if api_key:
        headers["X-API-Key"] = api_key
    if auth_token:
        headers["Authorization"] = f"Bearer {auth_token}"

    return headers


def post_json(url: str, payload: dict, headers: dict[str, str]) -> dict:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=30) as response:
        content = response.read().decode("utf-8")
        return json.loads(content)


def main() -> int:
    parser = argparse.ArgumentParser(description="Import mock files into backend")
    parser.add_argument("--base-url", default=os.environ.get("API_BASE_URL", "http://localhost:8000"))
    parser.add_argument("--limit", type=int, default=0, help="Limit number of files to import")
    parser.add_argument("--dry-run", action="store_true", help="Print actions without uploading")
    args = parser.parse_args()

    if not MAPPING_FILE.exists():
        print(f"Missing mapping file: {MAPPING_FILE}", file=sys.stderr)
        return 1

    headers = build_headers()
    if "X-API-Key" not in headers and "Authorization" not in headers:
        print("Warning: no API key or auth token provided. Requests may fail.")

    try:
        mapping = json.loads(MAPPING_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"Invalid mapping JSON: {exc}", file=sys.stderr)
        return 1

    limit = args.limit if args.limit > 0 else len(mapping)
    base_url = args.base_url.rstrip("/")
    endpoint = f"{base_url}/api/files/"

    imported: list[dict[str, str]] = []

    for index, entry in enumerate(mapping[:limit], start=1):
        file_id = entry.get("file_id")
        filename = entry.get("filename")
        if not file_id or not filename:
            print(f"Skipping invalid mapping entry: {entry}", file=sys.stderr)
            continue

        file_path = DATA_DIR / filename
        if not file_path.exists():
            print(f"Missing file: {file_path}", file=sys.stderr)
            continue

        content = file_path.read_text(encoding="utf-8")
        payload = {
            "name": filename,
            "content": content,
        }

        if args.dry_run:
            print(f"[dry-run] {file_id} -> {filename}")
            continue

        try:
            response = post_json(endpoint, payload, headers)
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8") if exc.fp else ""
            print(f"HTTP error importing {filename}: {exc.code} {body}", file=sys.stderr)
            return 1
        except urllib.error.URLError as exc:
            print(f"Connection error: {exc}", file=sys.stderr)
            return 1

        created_id = response.get("id")
        if not created_id:
            print(f"Unexpected response for {filename}: {response}", file=sys.stderr)
            return 1

        imported.append({
            "mock_file_id": file_id,
            "created_file_id": created_id,
            "filename": filename,
        })

        print(f"Imported {index}/{limit}: {filename} -> {created_id}")

    if args.dry_run:
        return 0

    OUTPUT_FILE.write_text(json.dumps(imported, indent=2), encoding="utf-8")
    print(f"Wrote mapping: {OUTPUT_FILE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
