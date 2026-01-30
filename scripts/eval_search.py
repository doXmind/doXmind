#!/usr/bin/env python3
"""Offline evaluation for search relevance.

Env vars:
  API_BASE_URL   Base URL (default http://localhost:8000)
  DOXMIND_API_KEY   Optional API key for X-API-Key header
  AUTH_TOKEN     Optional Bearer token for Authorization header

Input:
  data/mock_files/eval_samples.jsonl

Output:
  data/mock_files/eval_report.json (default)
"""

from __future__ import annotations

import argparse
import json
import math
import os
import pathlib
import re
import sys
import urllib.error
import urllib.request


ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data" / "mock_files"
SAMPLES_FILE = DATA_DIR / "eval_samples.jsonl"
DEFAULT_MAP_FILE = DATA_DIR / "imported_file_map.json"


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
    with urllib.request.urlopen(request, timeout=60) as response:
        content = response.read().decode("utf-8")
        return json.loads(content)


def load_jsonl(path: pathlib.Path) -> list[dict]:
    items: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        items.append(json.loads(line))
    return items


def normalize_text(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def tokenize(text: str) -> list[str]:
    normalized = normalize_text(text)
    if not normalized:
        return []
    return [t for t in normalized.split(" ") if t]


def token_overlap(snippet: str, content: str) -> float:
    snippet_tokens = tokenize(snippet)
    content_tokens = tokenize(content)
    if not snippet_tokens or not content_tokens:
        return 0.0
    snippet_set = set(snippet_tokens)
    content_set = set(content_tokens)
    overlap = snippet_set.intersection(content_set)
    return len(overlap) / len(snippet_set)


def snippet_match(content: str, snippet: str) -> bool:
    content_norm = normalize_text(content)
    snippet_norm = normalize_text(snippet)
    if not snippet_norm:
        return False

    if snippet_norm in content_norm:
        return True

    overlap_ratio = token_overlap(snippet_norm, content_norm)
    if len(tokenize(snippet_norm)) >= 4 and overlap_ratio >= 0.8:
        return True

    return False


def query_length_bucket(query: str) -> str:
    tokens = tokenize(query)
    count = len(tokens)
    if count <= 2:
        return "short"
    if count <= 5:
        return "medium"
    if count <= 9:
        return "long"
    return "very_long"


def query_special_term_bucket(query: str) -> str:
    if re.search(r"[A-Z]{2,}", query):
        return "has_acronym"
    if re.search(r"[0-9]", query):
        return "has_number"
    if re.search(r"[._/\\-]", query):
        return "has_symbol"
    return "plain"


def compute_metrics(relevance: list[int], total_relevant: int, k: int) -> dict[str, float]:
    cutoff = relevance[:k]
    rel_count = sum(cutoff)
    precision = rel_count / k if k > 0 else 0.0
    recall = rel_count / total_relevant if total_relevant > 0 else 0.0

    dcg = 0.0
    for idx, rel in enumerate(cutoff, start=1):
        if rel:
            dcg += 1.0 / math.log2(idx + 1)

    ideal_hits = min(total_relevant, k)
    idcg = sum(1.0 / math.log2(i + 1) for i in range(1, ideal_hits + 1))
    ndcg = dcg / idcg if idcg > 0 else 0.0

    mrr = 0.0
    for idx, rel in enumerate(cutoff, start=1):
        if rel:
            mrr = 1.0 / idx
            break

    return {
        "precision": precision,
        "recall": recall,
        "ndcg": ndcg,
        "mrr": mrr,
    }


def load_id_map(path: pathlib.Path | None) -> dict[str, str]:
    if path is None or not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    mapped: dict[str, str] = {}
    for row in data:
        mock_id = row.get("mock_file_id")
        created_id = row.get("created_file_id")
        if mock_id and created_id:
            mapped[mock_id] = created_id
    return mapped


def map_file_ids(file_ids: list[str], id_map: dict[str, str]) -> list[str]:
    if not id_map:
        return file_ids
    mapped = []
    for fid in file_ids:
        mapped.append(id_map.get(fid, fid))
    return mapped


def build_gold_index(gold: list[dict], id_map: dict[str, str]) -> dict[str, list[str]]:
    gold_map: dict[str, list[str]] = {}
    for entry in gold:
        file_id = entry.get("file_id")
        snippets = entry.get("snippets", [])
        if not file_id or not isinstance(file_id, str):
            continue
        mapped_id = id_map.get(file_id, file_id)
        gold_map[mapped_id] = [s for s in snippets if isinstance(s, str)]
    return gold_map


def evaluate_query(results: list[dict], gold_map: dict[str, list[str]], k: int) -> dict[str, float]:
    relevance: list[int] = []
    hit_file_ids: set[str] = set()

    for result in results[:k]:
        content = result.get("content", "")
        metadata = result.get("metadata", {}) or {}
        file_id = metadata.get("file_id")
        if not file_id or file_id not in gold_map:
            relevance.append(0)
            continue

        snippets = gold_map[file_id]
        is_relevant = any(snippet_match(content, snippet) for snippet in snippets)
        if is_relevant:
            hit_file_ids.add(file_id)
            relevance.append(1)
        else:
            relevance.append(0)

    total_relevant = len(gold_map)
    metrics = compute_metrics(relevance, total_relevant, k)
    metrics["recall"] = len(hit_file_ids) / total_relevant if total_relevant > 0 else 0.0
    return metrics


def run_eval(
    samples: list[dict],
    modes: list[dict],
    base_url: str,
    headers: dict[str, str],
    id_map: dict[str, str],
    k: int,
    progress_every: int,
    rerank_compare_k: int
) -> dict:
    endpoint = f"{base_url.rstrip('/')}/api/files/search"
    report: dict[str, dict] = {
        mode["name"]: {
            "metrics": [],
            "queries": [],
            "buckets": {},
        }
        for mode in modes
    }
    rerank_diffs: list[dict] = []

    total_samples = len(samples)
    for idx, sample in enumerate(samples, start=1):
        query = sample.get("query", "")
        candidate_files = sample.get("candidate_files", []) or []
        gold = sample.get("gold", []) or []

        gold_map = build_gold_index(gold, id_map)
        if not query or not gold_map:
            continue

        mapped_candidates = map_file_ids(candidate_files, id_map)
        file_ids_payload = mapped_candidates if mapped_candidates else None

        query_length = query_length_bucket(query)
        query_special = query_special_term_bucket(query)

        rerank_hybrid_candidates: list[dict] | None = None

        for mode in modes:
            payload = {
                "query": query,
                "file_ids": file_ids_payload,
                "top_k": k,
                "use_hybrid": mode["use_hybrid"],
                "use_reranking": mode["use_reranking"],
            }

            try:
                response = post_json(endpoint, payload, headers)
            except urllib.error.HTTPError as exc:
                body = exc.read().decode("utf-8") if exc.fp else ""
                raise RuntimeError(f"HTTP error for query '{query}': {exc.code} {body}") from exc
            except urllib.error.URLError as exc:
                raise RuntimeError(f"Connection error for query '{query}': {exc}") from exc

            results = response.get("results", []) or []
            metrics = evaluate_query(results, gold_map, k)

            report[mode["name"]]["metrics"].append(metrics)
            report[mode["name"]]["queries"].append({
                "query": query,
                "metrics": metrics,
            })

            bucket_key = f"length:{query_length}|term:{query_special}"
            bucket = report[mode["name"]]["buckets"].setdefault(
                bucket_key,
                {"precision": [], "recall": [], "ndcg": [], "mrr": []}
            )
            for key in ("precision", "recall", "ndcg", "mrr"):
                bucket[key].append(metrics[key])

            if mode["name"] == "hybrid":
                rerank_hybrid_candidates = results

            if mode["name"] == "rerank" and rerank_hybrid_candidates is not None:
                rerank_results = results[:k]
                hybrid_ids = [r.get("id") for r in rerank_hybrid_candidates[:rerank_compare_k]]
                rerank_ids = [r.get("id") for r in rerank_results]
                overlap = len(set(hybrid_ids).intersection(set(rerank_ids)))
                rerank_diffs.append({
                    "query": query,
                    "overlap_top_k": overlap,
                    "hybrid_top_k": hybrid_ids,
                    "rerank_top_k": rerank_ids,
                })

        if progress_every > 0 and idx % progress_every == 0:
            print(f"Processed {idx}/{total_samples} queries")

    summary: dict[str, dict[str, float]] = {}
    bucket_summary: dict[str, dict[str, dict[str, float]]] = {}
    for mode in modes:
        name = mode["name"]
        metrics_list = report[name]["metrics"]
        if not metrics_list:
            summary[name] = {"precision": 0.0, "recall": 0.0, "ndcg": 0.0, "mrr": 0.0}
            continue
        summary[name] = {
            "precision": sum(m["precision"] for m in metrics_list) / len(metrics_list),
            "recall": sum(m["recall"] for m in metrics_list) / len(metrics_list),
            "ndcg": sum(m["ndcg"] for m in metrics_list) / len(metrics_list),
            "mrr": sum(m["mrr"] for m in metrics_list) / len(metrics_list),
        }

        bucket_summary[name] = {}
        for bucket_key, bucket_values in report[name]["buckets"].items():
            bucket_summary[name][bucket_key] = {
                "precision": sum(bucket_values["precision"]) / len(bucket_values["precision"]),
                "recall": sum(bucket_values["recall"]) / len(bucket_values["recall"]),
                "ndcg": sum(bucket_values["ndcg"]) / len(bucket_values["ndcg"]),
                "mrr": sum(bucket_values["mrr"]) / len(bucket_values["mrr"]),
            }

    return {
        "summary": summary,
        "bucket_summary": bucket_summary,
        "details": report,
        "rerank_diffs": rerank_diffs,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Offline relevance evaluation")
    parser.add_argument("--base-url", default=os.environ.get("API_BASE_URL", "http://localhost:8000"))
    parser.add_argument("--samples", default=str(SAMPLES_FILE))
    parser.add_argument("--file-id-map", default=str(DEFAULT_MAP_FILE))
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--limit", type=int, default=0, help="Limit number of queries")
    parser.add_argument("--progress-every", type=int, default=20, help="Progress print interval")
    parser.add_argument("--rerank-compare-k", type=int, default=20, help="Hybrid candidates to compare")
    parser.add_argument("--output", default=str(DATA_DIR / "eval_report.json"))
    args = parser.parse_args()

    samples_path = pathlib.Path(args.samples)
    if not samples_path.exists():
        print(f"Missing samples file: {samples_path}", file=sys.stderr)
        return 1

    headers = build_headers()
    if "X-API-Key" not in headers and "Authorization" not in headers:
        print("Warning: no API key or auth token provided. Requests may fail.")

    id_map = load_id_map(pathlib.Path(args.file_id_map))
    samples = load_jsonl(samples_path)
    if args.limit > 0:
        samples = samples[:args.limit]

    modes = [
        {"name": "semantic", "use_hybrid": False, "use_reranking": False},
        {"name": "hybrid", "use_hybrid": True, "use_reranking": False},
        {"name": "rerank", "use_hybrid": True, "use_reranking": True},
    ]

    try:
        report = run_eval(
            samples,
            modes,
            args.base_url,
            headers,
            id_map,
            args.top_k,
            args.progress_every,
            args.rerank_compare_k
        )
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    output_path = pathlib.Path(args.output)
    output_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    summary = report["summary"]
    print("Evaluation summary")
    for mode in modes:
        name = mode["name"]
        metrics = summary[name]
        print(
            f"{name}: precision={metrics['precision']:.3f} "
            f"recall={metrics['recall']:.3f} ndcg={metrics['ndcg']:.3f} mrr={metrics['mrr']:.3f}"
        )
    print(f"Report written to: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
