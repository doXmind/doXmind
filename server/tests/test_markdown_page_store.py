"""Behavior tests for the Markdown-only Page store."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from services.legacy_sidecar import sidecar_path_for
from services.markdown_page_store import MarkdownPageStore, PageRevisionConflictError
from services.markdown_source import extract_frontmatter_block

SOURCE_CONTRACT = json.loads(
    (Path(__file__).parents[2] / "tests/fixtures/page-source-contract.json").read_text(
        encoding="utf-8"
    )
)
PROPERTIES_CONTRACT = json.loads(
    (Path(__file__).parents[2] / "tests/fixtures/page-properties-contract.json").read_text(
        encoding="utf-8"
    )
)


def test_page_source_corpus_is_byte_preserving(tmp_path: Path) -> None:
    from api.workspace import workspace_scan

    store = MarkdownPageStore()
    for fixture in SOURCE_CONTRACT:
        page_path = tmp_path / fixture["filename"]
        source = fixture["source"]
        page_path.write_bytes(source.encode("utf-8"))

        page = store.read(page_path)

        assert (extract_frontmatter_block(source) is not None) is fixture["frontmatter"], fixture[
            "name"
        ]
        assert page.markdown == fixture["body"], fixture["name"]
        assert page.meta.get("id") == fixture["id"], fixture["name"]
        assert page.meta.get("title") == fixture["title"], fixture["name"]
        assert page_path.read_bytes() == source.encode("utf-8"), fixture["name"]

    scan = workspace_scan(str(tmp_path))
    documents = {document["path"]: document for document in scan["documents"]}
    for fixture in SOURCE_CONTRACT:
        document = documents[fixture["filename"]]
        assert document["idSource"] == ("path" if fixture["id"] is None else "frontmatter"), (
            fixture["name"]
        )
        assert document["title"] == fixture["scanTitle"], fixture["name"]


def test_page_properties_obey_shared_source_preserving_contract(tmp_path: Path) -> None:
    store = MarkdownPageStore()
    for fixture in PROPERTIES_CONTRACT["safe"]:
        page_path = tmp_path / fixture["filename"]
        page_path.write_bytes(fixture["source"].encode("utf-8"))
        opened = store.read(page_path)

        assert opened.meta["tags"] == fixture["tags"], fixture["name"]
        assert opened.meta["aliases"] == fixture["aliases"], fixture["name"]
        for key, value in fixture["properties"].items():
            assert opened.meta[key] == value, f"{fixture['name']}: {key}"

        revision = store.write(page_path, opened.markdown, fixture["patch"], opened.revision)
        saved = store.read(page_path)
        assert saved.revision == revision
        for key, value in fixture["expectedProperties"].items():
            assert saved.meta[key] == value, f"{fixture['name']}: {key}"
        assert page_path.read_bytes() == fixture["expectedSource"].encode("utf-8"), fixture["name"]

    for fixture in PROPERTIES_CONTRACT["reject"]:
        page_path = tmp_path / fixture["filename"]
        page_path.write_bytes(fixture["source"].encode("utf-8"))
        with pytest.raises(ValueError, match="cannot safely patch Page property"):
            store.write(page_path, store.read(page_path).markdown, fixture["patch"])
        assert page_path.read_bytes() == fixture["source"].encode("utf-8")

    for fixture in PROPERTIES_CONTRACT["invalid"]:
        page_path = tmp_path / f"{fixture['name']}.md"
        source = "---\nid: invalid-list\n---\n\nBody\n"
        page_path.write_text(source, encoding="utf-8")
        with pytest.raises(ValueError, match=re.escape(fixture["error"])):
            store.write(page_path, "Body\n", fixture["patch"])
        assert page_path.read_text(encoding="utf-8") == source


def test_external_page_gains_frontmatter_only_on_property_write(tmp_path: Path) -> None:
    page_path = tmp_path / "External.md"
    page_path.write_text("Body\n", encoding="utf-8")
    store = MarkdownPageStore()

    store.write(page_path, "Body changed\n")
    assert page_path.read_text(encoding="utf-8") == "Body changed\n"

    store.write(page_path, "Body changed\n", {"tags": ["local"]})
    saved = store.read(page_path)
    assert saved.meta["tags"] == ["local"]
    assert re.fullmatch(r"[0-9a-f-]{36}", saved.meta["id"])
    assert page_path.read_text(encoding="utf-8") == (
        f'---\nid: {saved.meta["id"]}\ntags: ["local"]\n---\n\nBody changed\n'
    )
    assert not sidecar_path_for(page_path).exists()


def test_new_page_save_writes_only_markdown(tmp_path: Path) -> None:
    page_path = tmp_path / "Plan.md"

    MarkdownPageStore().write(page_path, "# Plan\n\nFirst step")

    assert page_path.read_text(encoding="utf-8") == "# Plan\n\nFirst step"
    assert not sidecar_path_for(page_path).exists()


def test_page_save_preserves_hand_authored_frontmatter_and_legacy_sidecar(
    tmp_path: Path,
) -> None:
    page_path = tmp_path / "Notes.md"
    page_path.write_text(
        '---\n# mine\ntitle: "Quoted"\ntags: [a, b]\n---\n\nold\n',
        encoding="utf-8",
    )
    legacy_sidecar = sidecar_path_for(page_path)
    legacy_bytes = b'{"version":1,"html":"legacy"}\n'
    legacy_sidecar.write_bytes(legacy_bytes)

    MarkdownPageStore().write(page_path, "new")

    assert page_path.read_text(encoding="utf-8") == (
        '---\n# mine\ntitle: "Quoted"\ntags: [a, b]\n---\n\nnew'
    )
    assert legacy_sidecar.read_bytes() == legacy_bytes


def test_page_read_uses_markdown_even_when_a_legacy_sidecar_exists(tmp_path: Path) -> None:
    page_path = tmp_path / "External.md"
    page_path.write_text("---\nid: page-1\n---\n\n# File wins\n", encoding="utf-8")
    legacy_sidecar = sidecar_path_for(page_path)
    legacy_bytes = b'{"version":1,"id":"other","html":"<p>Sidecar</p>"}\n'
    legacy_sidecar.write_bytes(legacy_bytes)

    page = MarkdownPageStore().read(page_path)

    assert page.markdown == "# File wins\n"
    assert page.meta["id"] == "page-1"
    assert legacy_sidecar.read_bytes() == legacy_bytes


@pytest.mark.parametrize("id_source", ["123", "{ imported: true }", '""'])
def test_non_string_or_empty_external_id_is_not_page_identity_and_round_trips(
    tmp_path: Path, id_source: str
) -> None:
    page_path = tmp_path / "External-id.md"
    original = f"---\nid: {id_source}\ncustom: keep\n---\n\nBody\n".encode()
    page_path.write_bytes(original)
    store = MarkdownPageStore()

    page = store.read(page_path)

    assert "id" not in page.meta
    assert page.markdown == "Body\n"
    store.write(page_path, page.markdown)
    assert page_path.read_bytes() == original


def test_created_page_persists_identity_in_markdown_frontmatter(tmp_path: Path) -> None:
    page_path = tmp_path / "Stable.md"

    MarkdownPageStore().create(page_path, "page-1", "# Stable")

    assert page_path.read_text(encoding="utf-8") == ("---\nid: page-1\n---\n\n# Stable")
    assert not sidecar_path_for(page_path).exists()


@pytest.mark.parametrize(
    "body",
    [
        "",
        "Alpha",
        "Alpha\n",
        "Alpha\n\n\n",
        "first\r\n\r\nlast\r\n\r\n",
    ],
)
def test_page_body_round_trips_exactly_without_frontmatter(tmp_path: Path, body: str) -> None:
    page_path = tmp_path / "Exact.md"
    page_path.write_bytes(body.encode("utf-8"))

    store = MarkdownPageStore()
    assert store.read(page_path).markdown == body
    store.write(page_path, body)

    assert page_path.read_bytes() == body.encode("utf-8")


def test_page_body_and_frontmatter_separator_round_trip_with_crlf(tmp_path: Path) -> None:
    page_path = tmp_path / "Windows.markdown"
    prefix = b"---\r\nid: page-crlf\r\ntitle: Mine\r\n---\r\n\r\n"
    body = b"Alpha\r\n\r\n\r\n"
    original = prefix + body
    page_path.write_bytes(original)

    store = MarkdownPageStore()
    page = store.read(page_path)
    assert page.markdown.encode("utf-8") == body
    assert page.meta["id"] == "page-crlf"
    store.write(page_path, page.markdown)

    assert page_path.read_bytes() == original


def test_created_page_preserves_body_eof_exactly(tmp_path: Path) -> None:
    page_path = tmp_path / "Created.md"
    body = "Alpha\n\n\n"

    store = MarkdownPageStore()
    store.create(page_path, "page-created", body)

    assert store.read(page_path).markdown == body
    assert page_path.read_bytes() == b"---\nid: page-created\n---\n\nAlpha\n\n\n"


def test_metadata_patch_preserves_unknown_frontmatter_and_exact_body(tmp_path: Path) -> None:
    page_path = tmp_path / "Properties.md"
    body = b"Body\r\n\r\n"
    page_path.write_bytes(b'---\r\n# mine\r\nid: "page-1"\r\ncustom: [a, b]\r\n---\r\n\r\n' + body)

    MarkdownPageStore().write(
        page_path,
        body.decode("utf-8"),
        {"favorite": True, "title": "Pinned"},
    )

    saved = page_path.read_bytes()
    assert b"# mine\r\n" in saved
    assert b"custom: [a, b]\r\n" in saved
    assert b'title: "Pinned"\r\n' in saved
    assert b"favorite: true\r\n" in saved
    assert saved.endswith(body)


def test_create_persists_supported_page_metadata_in_frontmatter(tmp_path: Path) -> None:
    page_path = tmp_path / "Meta.md"

    MarkdownPageStore().create(
        page_path,
        "page-meta",
        "Body",
        {
            "title": "Meta",
            "favorite": True,
            "status": "draft",
            "priority": 3,
            "published": False,
            "topics": ["local", "markdown"],
        },
    )

    source = page_path.read_text(encoding="utf-8")
    assert 'title: "Meta"' in source
    assert "favorite: true" in source
    assert 'status: "draft"' in source
    assert "priority: 3" in source
    assert "published: false" in source
    assert 'topics: ["local","markdown"]' in source
    reopened = MarkdownPageStore().read(page_path)
    assert reopened.meta["id"] == "page-meta"
    assert reopened.meta["favorite"] is True
    assert reopened.meta["status"] == "draft"
    assert reopened.meta["priority"] == 3
    assert reopened.meta["published"] is False
    assert reopened.meta["topics"] == ["local", "markdown"]


def test_stale_revision_cannot_overwrite_external_edit(tmp_path: Path) -> None:
    page_path = tmp_path / "Concurrent.md"
    page_path.write_text("first", encoding="utf-8")
    store = MarkdownPageStore()
    opened = store.read(page_path)
    page_path.write_text("external", encoding="utf-8")

    with pytest.raises(PageRevisionConflictError, match="page_revision_conflict"):
        store.write(page_path, "stale local", expected_revision=opened.revision)

    assert page_path.read_text(encoding="utf-8") == "external"


def test_successful_revision_write_returns_the_new_revision(tmp_path: Path) -> None:
    page_path = tmp_path / "Revision.md"
    page_path.write_text("first", encoding="utf-8")
    store = MarkdownPageStore()
    opened = store.read(page_path)

    revision = store.write(page_path, "second", expected_revision=opened.revision)

    assert revision == store.read(page_path).revision
    assert revision != opened.revision


@pytest.mark.parametrize("name", ["Page.html", "Page.txt", "Page.pdf"])
def test_store_rejects_non_markdown_paths_without_modifying_them(tmp_path: Path, name: str) -> None:
    path = tmp_path / name
    original = b"attachment bytes"
    path.write_bytes(original)
    store = MarkdownPageStore()

    with pytest.raises(ValueError, match=r"\.md or \.markdown"):
        store.read(path)
    with pytest.raises(ValueError, match=r"\.md or \.markdown"):
        store.write(path, "changed")
    with pytest.raises(ValueError, match=r"\.md or \.markdown"):
        store.create(path, "page-1", "changed")

    assert path.read_bytes() == original
