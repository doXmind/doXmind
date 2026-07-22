"""Integration contract for Markdown-only Page commands."""

from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest

import api.workspace as workspace_module
from api.workspace import (
    _move_document_family,
    doc_create,
    doc_delete,
    inspect_page_recovery,
    read_attachment_recovery,
    read_doc,
    read_page_recovery,
    read_workspace_asset,
    stable_path_id,
    workspace_index_from_documents,
    workspace_index_path,
    workspace_index_rebuild,
    workspace_markdown_search,
    workspace_relocate_folder,
    workspace_relocate_page,
    workspace_scan,
    write_doc_workspace,
)
from services.legacy_sidecar import sidecar_path_for
from services.markdown_page_store import PageRevisionConflictError


def test_create_save_and_reopen_page_never_writes_a_sidecar(tmp_path: Path) -> None:
    created = doc_create(
        str(tmp_path),
        {
            "path": "Notes/Plan.md",
            "html": "<h1>ignored editor cache</h1>",
            "markdown": "# Plan",
            "meta": {"id": "page-1", "title": "Plan"},
            "extras": {"databases": {"legacy": {"rows": []}}},
        },
    )
    page_path = tmp_path / "Notes" / "Plan.md"

    assert created["id"] == "page-1"
    assert page_path.read_text(encoding="utf-8") == (
        '---\nid: page-1\ntitle: "Plan"\n---\n\n# Plan'
    )
    assert not sidecar_path_for(page_path).exists()

    saved = write_doc_workspace(
        str(tmp_path),
        "Notes/Plan.md",
        {"markdown": "# Plan\n\nNext", "html": "<p>not durable</p>"},
    )
    reopened = read_doc(page_path)

    assert saved["markdown"] == "# Plan\n\nNext"
    assert reopened["markdown"] == "# Plan\n\nNext"
    legacy_fields = {
        "html",
        "editorHtml",
        "browsingHtml",
        "browsingRendererVersion",
        "extras",
        "source",
        "sourceState",
        "correlation",
    }
    assert legacy_fields.isdisjoint(saved)
    assert legacy_fields.isdisjoint(reopened)
    assert not sidecar_path_for(page_path).exists()


def test_workspace_image_assets_are_local_typed_and_symlink_free(tmp_path: Path) -> None:
    assets = tmp_path / "assets"
    assets.mkdir()
    png = bytes.fromhex("89504e470d0a1a0a00000000")
    (assets / "pixel.png").write_bytes(png)

    assert read_workspace_asset(str(tmp_path), "assets/pixel.png") == {
        "path": "assets/pixel.png",
        "mime": "image/png",
        "base64": "iVBORw0KGgoAAAAA",
    }
    for name, mime, content in (
        ("pixel.apng", "image/apng", png),
        ("pixel.bmp", "image/bmp", b"BM\x00\x00"),
        ("pixel.ico", "image/x-icon", b"\x00\x00\x01\x00\x00\x00"),
    ):
        (assets / name).write_bytes(content)
        assert read_workspace_asset(str(tmp_path), f"assets/{name}") == {
            "path": f"assets/{name}",
            "mime": mime,
            "base64": base64.b64encode(content).decode("ascii"),
        }

    (assets / "fake.jpg").write_text("not a jpeg", encoding="utf-8")
    with pytest.raises(ValueError, match="content does not match image type"):
        read_workspace_asset(str(tmp_path), "assets/fake.jpg")
    with pytest.raises(ValueError, match="escapes workspace root"):
        read_workspace_asset(str(tmp_path), "../outside.png")

    real = tmp_path / "real-assets"
    real.mkdir()
    (real / "linked.png").write_bytes(png)
    (tmp_path / "linked-assets").symlink_to(real, target_is_directory=True)
    with pytest.raises(ValueError, match="symbolic-link image assets are not allowed"):
        read_workspace_asset(str(tmp_path), "linked-assets/linked.png")


def test_legacy_sidecar_never_supplies_page_identity(tmp_path: Path) -> None:
    page_path = tmp_path / "Legacy.md"
    page_path.write_text("needle\n", encoding="utf-8")
    sidecar_path = sidecar_path_for(page_path)
    sidecar_bytes = json.dumps(
        {
            "version": 1,
            "id": "legacy-sidecar-id",
            "html": "<p>legacy</p>",
            "markdown_hash": "sha256:stale",
        }
    ).encode()
    sidecar_path.write_bytes(sidecar_bytes)
    expected_id = stable_path_id("Legacy.md")

    scanned = workspace_scan(str(tmp_path))["documents"][0]
    searched = workspace_markdown_search(str(tmp_path), "needle")[0]
    index = workspace_index_rebuild(str(tmp_path))

    assert scanned["id"] == expected_id
    assert scanned["idSource"] == "path"
    assert searched["id"] == expected_id
    assert index["ids"] == {}
    assert sidecar_path.read_bytes() == sidecar_bytes


def test_workspace_scan_neither_probes_sidecars_nor_indexes_legacy_cache_dirs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    page = tmp_path / "Current.md"
    page.write_text("# Current\n", encoding="utf-8")
    legacy_sidecar = sidecar_path_for(page)
    legacy_bytes = b'{"id":"legacy"}'
    legacy_sidecar.write_bytes(legacy_bytes)
    hidden_page = tmp_path / ".doxmind" / "Cached.md"
    hidden_page.parent.mkdir()
    hidden_page.write_text("# Must stay hidden\n", encoding="utf-8")

    def fail_if_probed(_path: Path) -> Path:
        raise AssertionError("workspace scan must not probe legacy Page sidecars")

    def fail_if_recursive_globbed(_path: Path, _pattern: str):
        raise AssertionError("workspace scan must prune ignored directories before descending")

    monkeypatch.setattr(workspace_module, "sidecar_path_for", fail_if_probed)
    monkeypatch.setattr(Path, "rglob", fail_if_recursive_globbed)

    scanned = workspace_scan(str(tmp_path))["documents"]
    searched = workspace_markdown_search(str(tmp_path), "hidden")

    assert [document["path"] for document in scanned] == ["Current.md"]
    assert "hasSidecar" not in scanned[0]
    assert searched == []
    assert legacy_sidecar.read_bytes() == legacy_bytes


def test_frontmatter_identity_wins_everywhere_without_reading_legacy_sidecar(
    tmp_path: Path,
) -> None:
    page_path = tmp_path / "Portable.md"
    page_path.write_text(
        "---\nid: portable-page\ntitle: Portable title\n---\n\nneedle\n",
        encoding="utf-8",
    )
    sidecar_path_for(page_path).write_text(
        json.dumps({"version": 1, "id": "legacy-sidecar-id", "html": ""}),
        encoding="utf-8",
    )

    scanned = workspace_scan(str(tmp_path))["documents"][0]
    searched = workspace_markdown_search(str(tmp_path), "needle")[0]
    index = workspace_index_rebuild(str(tmp_path))

    assert scanned["id"] == "portable-page"
    assert scanned["idSource"] == "frontmatter"
    assert searched["id"] == "portable-page"
    assert index["ids"] == {"portable-page": "Portable.md"}


def test_workspace_index_rejects_legacy_sidecar_identity_records() -> None:
    index = workspace_index_from_documents(
        [
            {
                "documentType": "markdown",
                "idSource": "frontmatter",
                "id": "portable-page",
                "path": "Portable.md",
            },
            {
                "documentType": "markdown",
                "idSource": "sidecar",
                "id": "legacy-sidecar-id",
                "path": "Legacy.md",
            },
            {
                "documentType": "markdown",
                "idSource": "path",
                "id": stable_path_id("External.md"),
                "path": "External.md",
            },
        ]
    )

    assert index["ids"] == {"portable-page": "Portable.md"}


def test_workspace_scan_writes_derived_index_outside_markdown_tree(
    tmp_path: Path,
) -> None:
    (tmp_path / "Portable.md").write_text(
        "---\nid: portable-page\n---\n\nBody\n",
        encoding="utf-8",
    )

    workspace_scan(str(tmp_path))

    assert workspace_index_path(tmp_path).exists()
    assert not (tmp_path / ".doxmind").exists()


def test_workspace_scan_preserves_legacy_workspace_index_bytes(tmp_path: Path) -> None:
    legacy_index = tmp_path / ".doxmind" / "index.json"
    legacy_index.parent.mkdir()
    legacy_bytes = b'{"version":1,"ids":{"legacy":"Old.md"}}\n'
    legacy_index.write_bytes(legacy_bytes)
    (tmp_path / "Current.md").write_text(
        "---\nid: current\n---\n\nBody\n",
        encoding="utf-8",
    )

    workspace_scan(str(tmp_path))

    assert legacy_index.read_bytes() == legacy_bytes
    assert json.loads(workspace_index_path(tmp_path).read_text(encoding="utf-8")) == {
        "version": 1,
        "ids": {"current": "Current.md"},
    }


@pytest.mark.parametrize(
    "filename",
    [
        "Attachment.html",
        "Attachment.htm",
        "Attachment.pdf",
        "Attachment.xlsx",
        "Attachment.csv",
    ],
)
def test_page_write_rejects_attachment_paths_without_modifying_them(
    tmp_path: Path,
    filename: str,
) -> None:
    attachment_path = tmp_path / filename
    original = b"original attachment bytes"
    attachment_path.write_bytes(original)

    with pytest.raises(ValueError, match=r"\.md or \.markdown"):
        write_doc_workspace(
            str(tmp_path),
            filename,
            {"markdown": "# Must not replace attachment"},
        )

    assert attachment_path.read_bytes() == original


def test_page_move_rejects_destination_legacy_sidecar_without_mutating_any_artifact(
    tmp_path: Path,
) -> None:
    source = tmp_path / "Source.md"
    destination = tmp_path / "Destination.md"
    source_sidecar = sidecar_path_for(source)
    destination_sidecar = sidecar_path_for(destination)
    source_bytes = b"source page\n"
    source_sidecar_bytes = b'{"id":"source-legacy"}'
    destination_sidecar_bytes = b'{"id":"destination-orphan"}'
    source.write_bytes(source_bytes)
    source_sidecar.write_bytes(source_sidecar_bytes)
    destination_sidecar.write_bytes(destination_sidecar_bytes)

    with pytest.raises(ValueError, match="destination sidecar already exists"):
        _move_document_family(str(tmp_path), source.name, destination.name)

    assert source.read_bytes() == source_bytes
    assert not destination.exists()
    assert source_sidecar.read_bytes() == source_sidecar_bytes
    assert destination_sidecar.read_bytes() == destination_sidecar_bytes


@pytest.mark.parametrize("destination_suffix", [".bak", ".lock", ".corrupt-existing"])
def test_page_move_rejects_any_destination_sidecar_family_conflict_before_mutation(
    tmp_path: Path,
    destination_suffix: str,
) -> None:
    source = tmp_path / "Source.md"
    destination = tmp_path / "Destination.md"
    source_sidecar = sidecar_path_for(source)
    destination_sidecar = sidecar_path_for(destination)
    destination_artifact = destination_sidecar.with_name(
        f"{destination_sidecar.name}{destination_suffix}"
    )
    source_bytes = b"source page\n"
    source_sidecar_bytes = b"source recovery bytes"
    destination_artifact_bytes = b"destination recovery bytes"
    source.write_bytes(source_bytes)
    source_sidecar.write_bytes(source_sidecar_bytes)
    destination_artifact.write_bytes(destination_artifact_bytes)

    with pytest.raises(ValueError, match="destination sidecar already exists"):
        _move_document_family(str(tmp_path), source.name, destination.name)

    assert source.read_bytes() == source_bytes
    assert not destination.exists()
    assert source_sidecar.read_bytes() == source_sidecar_bytes
    assert destination_artifact.read_bytes() == destination_artifact_bytes


def test_page_rename_moves_complete_legacy_sidecar_family_byte_identically(
    tmp_path: Path,
) -> None:
    source = tmp_path / "Source.md"
    destination = tmp_path / "Renamed.md"
    source_bytes = b"source page\r\n"
    source.write_bytes(source_bytes)
    source_sidecar = sidecar_path_for(source)
    destination_sidecar = sidecar_path_for(destination)
    artifact_bytes = {
        "": b'exact {"version":1}',
        ".bak": b"backup\x00bytes",
        ".lock": b"persistent lock\n",
        ".corrupt-100": b"corrupt first",
        ".corrupt-200": b"corrupt second",
    }
    for suffix, raw in artifact_bytes.items():
        source_sidecar.with_name(f"{source_sidecar.name}{suffix}").write_bytes(raw)

    moved = _move_document_family(str(tmp_path), source.name, destination.name)

    assert moved["path"] == destination.name
    assert destination.read_bytes() == source_bytes
    assert not source.exists()
    for suffix, raw in artifact_bytes.items():
        old_artifact = source_sidecar.with_name(f"{source_sidecar.name}{suffix}")
        new_artifact = destination_sidecar.with_name(f"{destination_sidecar.name}{suffix}")
        assert not old_artifact.exists()
        assert new_artifact.read_bytes() == raw


def test_page_move_to_another_folder_carries_complete_legacy_sidecar_family(
    tmp_path: Path,
) -> None:
    source = tmp_path / "Source.md"
    destination = tmp_path / "Archive" / "Source.md"
    source.write_bytes(b"portable page\n")
    source_sidecar = sidecar_path_for(source)
    destination_sidecar = sidecar_path_for(destination)
    artifact_bytes = {
        ".bak": b"backup bytes",
        ".lock": b"lock bytes",
        ".corrupt-300": b"forensic bytes",
    }
    for suffix, raw in artifact_bytes.items():
        source_sidecar.with_name(f"{source_sidecar.name}{suffix}").write_bytes(raw)

    moved = _move_document_family(str(tmp_path), source.name, "Archive/Source.md")

    assert moved["path"] == "Archive/Source.md"
    assert destination.read_bytes() == b"portable page\n"
    for suffix, raw in artifact_bytes.items():
        old_artifact = source_sidecar.with_name(f"{source_sidecar.name}{suffix}")
        new_artifact = destination_sidecar.with_name(f"{destination_sidecar.name}{suffix}")
        assert not old_artifact.exists()
        assert new_artifact.read_bytes() == raw


def test_page_move_rolls_back_page_and_moved_artifacts_when_one_artifact_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = tmp_path / "Source.md"
    destination = tmp_path / "Archive" / "Source.md"
    source_bytes = b"source page\r\n"
    source.write_bytes(source_bytes)
    source_sidecar = sidecar_path_for(source)
    destination_sidecar = sidecar_path_for(destination)
    artifact_bytes = {
        "": b"exact bytes",
        ".bak": b"backup bytes",
        ".lock": b"lock bytes",
        ".corrupt-400": b"forensic bytes",
    }
    for suffix, raw in artifact_bytes.items():
        source_sidecar.with_name(f"{source_sidecar.name}{suffix}").write_bytes(raw)

    real_rename = Path.rename
    failing_artifact = source_sidecar.with_name(f"{source_sidecar.name}.lock")
    failure_injected = False

    def fail_one_artifact_once(path: Path, target: Path) -> Path:
        nonlocal failure_injected
        if path == failing_artifact and not failure_injected:
            failure_injected = True
            raise OSError("injected artifact move failure")
        return real_rename(path, target)

    monkeypatch.setattr(Path, "rename", fail_one_artifact_once)

    with pytest.raises(RuntimeError, match="rollback"):
        _move_document_family(str(tmp_path), source.name, "Archive/Source.md")

    assert source.read_bytes() == source_bytes
    assert not destination.exists()
    for suffix, raw in artifact_bytes.items():
        old_artifact = source_sidecar.with_name(f"{source_sidecar.name}{suffix}")
        new_artifact = destination_sidecar.with_name(f"{destination_sidecar.name}{suffix}")
        assert old_artifact.read_bytes() == raw
        assert not new_artifact.exists()


def test_page_relocation_commits_family_and_revision_checked_repairs_together(
    tmp_path: Path,
) -> None:
    notes = tmp_path / "Notes"
    notes.mkdir()
    target = notes / "Target.md"
    daily = notes / "Daily.md"
    target_source = b"---\nid: target-1\n---\n\n# Target\n"
    daily_source = b"---\nid: daily-1\ncustom: keep\n---\n\nSee [[Target]].\n"
    target.write_bytes(target_source)
    daily.write_bytes(daily_source)
    recovery = sidecar_path_for(target)
    recovery.write_bytes(b"\x00recovery\xff")
    target_read = read_doc(target)
    daily_read = read_doc(daily)

    result = workspace_relocate_page(
        str(tmp_path),
        "Notes/Target.md",
        "Archive/Roadmap.md",
        target_read["revision"],
        [
            {"path": "Notes/Daily.md", "expectedRevision": daily_read["revision"]},
            {"path": "Notes/Target.md", "expectedRevision": target_read["revision"]},
        ],
        "# Roadmap\n",
        [
            {
                "path": "Notes/Daily.md",
                "expectedRevision": daily_read["revision"],
                "markdown": "See [[../Archive/Roadmap]].\n",
            }
        ],
    )

    assert result["document"]["path"] == "Archive/Roadmap.md"
    assert result["revision"] != target_read["revision"]
    assert result["writes"][0]["path"] == "Notes/Daily.md"
    assert daily.read_bytes() == (
        b"---\nid: daily-1\ncustom: keep\n---\n\nSee [[../Archive/Roadmap]].\n"
    )
    assert (tmp_path / "Archive" / "Roadmap.md").read_bytes() == (
        b"---\nid: target-1\n---\n\n# Roadmap\n"
    )
    assert sidecar_path_for(tmp_path / "Archive" / "Roadmap.md").read_bytes() == b"\x00recovery\xff"
    assert not target.exists()


def test_page_relocation_rejects_stale_repair_before_moving_any_bytes(tmp_path: Path) -> None:
    target = tmp_path / "Target.md"
    daily = tmp_path / "Daily.md"
    target.write_bytes(b"---\nid: target-1\n---\n\nTarget\n")
    daily.write_bytes(b"---\nid: daily-1\n---\n\n[[Target]]\n")
    target_lock = sidecar_path_for(target).with_name(".Target.doxmind.lock")
    target_lock.write_bytes(b"lock")
    target_read = read_doc(target)
    daily_read = read_doc(daily)
    daily.write_bytes(daily.read_bytes() + b"external\n")

    with pytest.raises(PageRevisionConflictError, match="page_revision_conflict"):
        workspace_relocate_page(
            str(tmp_path),
            "Target.md",
            "Archive/Roadmap.md",
            target_read["revision"],
            [
                {"path": "Daily.md", "expectedRevision": daily_read["revision"]},
                {"path": "Target.md", "expectedRevision": target_read["revision"]},
            ],
            None,
            [
                {
                    "path": "Daily.md",
                    "expectedRevision": daily_read["revision"],
                    "markdown": "[[Archive/Roadmap]]\n",
                }
            ],
        )

    assert target.read_bytes() == b"---\nid: target-1\n---\n\nTarget\n"
    assert daily.read_bytes().endswith(b"external\n")
    assert target_lock.read_bytes() == b"lock"
    assert not (tmp_path / "Archive").exists()


def test_page_relocation_rejects_page_added_after_topology_snapshot(tmp_path: Path) -> None:
    target = tmp_path / "Target.md"
    daily = tmp_path / "Daily.md"
    target.write_text("Target\n", encoding="utf-8")
    daily.write_text("[[Target]]\n", encoding="utf-8")
    target_read = read_doc(target)
    daily_read = read_doc(daily)
    (tmp_path / "Late.md").write_text("[[Target]]\n", encoding="utf-8")

    with pytest.raises(ValueError, match=r"unplanned Pages Late\.md"):
        workspace_relocate_page(
            str(tmp_path),
            "Target.md",
            "Archive/Roadmap.md",
            target_read["revision"],
            [
                {"path": "Daily.md", "expectedRevision": daily_read["revision"]},
                {"path": "Target.md", "expectedRevision": target_read["revision"]},
            ],
            None,
            [],
        )

    assert target.read_text(encoding="utf-8") == "Target\n"
    assert not (tmp_path / "Archive").exists()


def test_page_relocation_rolls_back_repairs_and_family_on_write_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target = tmp_path / "Target.md"
    first = tmp_path / "First.md"
    second = tmp_path / "Second.md"
    target_source = b"---\nid: target-1\n---\n\nTarget\n"
    first_source = b"---\nid: first-1\n---\n\n[[Target]]\n"
    second_source = b"---\nid: second-1\n---\n\n[[Target]]\n"
    target.write_bytes(target_source)
    first.write_bytes(first_source)
    second.write_bytes(second_source)
    target_backup = sidecar_path_for(target).with_name(".Target.doxmind.bak")
    target_backup.write_bytes(b"backup")
    target_read = read_doc(target)
    first_read = read_doc(first)
    second_read = read_doc(second)
    real_write = workspace_module.MarkdownPageStore.write
    injected = False

    def fail_second_write_once(self, path, markdown, meta_patch=None, expected_revision=None):
        nonlocal injected
        if path == second and not injected:
            injected = True
            raise OSError("injected repair failure")
        return real_write(self, path, markdown, meta_patch, expected_revision)

    monkeypatch.setattr(workspace_module.MarkdownPageStore, "write", fail_second_write_once)

    with pytest.raises(RuntimeError, match="rolled back"):
        workspace_relocate_page(
            str(tmp_path),
            "Target.md",
            "Archive/Roadmap.md",
            target_read["revision"],
            [
                {"path": "First.md", "expectedRevision": first_read["revision"]},
                {"path": "Second.md", "expectedRevision": second_read["revision"]},
                {"path": "Target.md", "expectedRevision": target_read["revision"]},
            ],
            None,
            [
                {
                    "path": "First.md",
                    "expectedRevision": first_read["revision"],
                    "markdown": "[[Archive/Roadmap]]\n",
                },
                {
                    "path": "Second.md",
                    "expectedRevision": second_read["revision"],
                    "markdown": "[[Archive/Roadmap]]\n",
                },
            ],
        )

    assert target.read_bytes() == target_source
    assert first.read_bytes() == first_source
    assert second.read_bytes() == second_source
    assert target_backup.read_bytes() == b"backup"
    assert not (tmp_path / "Archive").exists()


def test_folder_relocation_commits_subtree_and_external_repairs_together(tmp_path: Path) -> None:
    notes = tmp_path / "Notes"
    notes.mkdir()
    target = notes / "Target.md"
    daily = tmp_path / "Daily.md"
    target_source = b"---\nid: target-1\n---\n\n[[../Daily]]\n"
    daily_source = b"---\nid: daily-1\ncustom: keep\n---\n\n[[Notes/Target]]\n"
    target.write_bytes(target_source)
    daily.write_bytes(daily_source)
    target_lock = sidecar_path_for(target).with_name(".Target.doxmind.lock")
    target_lock.write_bytes(b"lock")
    target_read = read_doc(target)
    daily_read = read_doc(daily)

    result = workspace_relocate_folder(
        str(tmp_path),
        "Notes",
        "Archive/Notes",
        [
            {"path": "Daily.md", "expectedRevision": daily_read["revision"]},
            {"path": "Notes/Target.md", "expectedRevision": target_read["revision"]},
        ],
        [
            {
                "sourcePath": "Notes/Target.md",
                "destinationPath": "Archive/Notes/Target.md",
                "expectedRevision": target_read["revision"],
                "markdown": "[[../../Daily]]\n",
            },
            {
                "sourcePath": "Daily.md",
                "destinationPath": "Daily.md",
                "expectedRevision": daily_read["revision"],
                "markdown": "[[Archive/Notes/Target]]\n",
            },
        ],
    )

    assert result["path"] == "Archive/Notes"
    assert [write["path"] for write in result["writes"]] == [
        "Archive/Notes/Target.md",
        "Daily.md",
    ]
    assert (tmp_path / "Archive/Notes/Target.md").read_bytes() == (
        b"---\nid: target-1\n---\n\n[[../../Daily]]\n"
    )
    assert daily.read_bytes() == (
        b"---\nid: daily-1\ncustom: keep\n---\n\n[[Archive/Notes/Target]]\n"
    )
    assert (tmp_path / "Archive/Notes/.Target.doxmind.lock").read_bytes() == b"lock"
    assert not notes.exists()


def test_folder_relocation_rejects_stale_topology_before_moving(tmp_path: Path) -> None:
    notes = tmp_path / "Notes"
    notes.mkdir()
    target = notes / "Target.md"
    daily = tmp_path / "Daily.md"
    target.write_bytes(b"Target\n")
    daily.write_bytes(b"[[Notes/Target]]\n")
    target_read = read_doc(target)
    daily_read = read_doc(daily)
    daily.write_bytes(daily.read_bytes() + b"external\n")

    with pytest.raises(PageRevisionConflictError, match="page_revision_conflict"):
        workspace_relocate_folder(
            str(tmp_path),
            "Notes",
            "Archive/Notes",
            [
                {"path": "Daily.md", "expectedRevision": daily_read["revision"]},
                {"path": "Notes/Target.md", "expectedRevision": target_read["revision"]},
            ],
            [],
        )

    assert target.read_bytes() == b"Target\n"
    assert daily.read_bytes().endswith(b"external\n")
    assert not (tmp_path / "Archive").exists()


def test_folder_relocation_rejects_page_added_after_topology_snapshot(tmp_path: Path) -> None:
    notes = tmp_path / "Notes"
    notes.mkdir()
    target = notes / "Target.md"
    target.write_text("Target\n", encoding="utf-8")
    target_read = read_doc(target)
    (tmp_path / "Late.md").write_text("[[Notes/Target]]\n", encoding="utf-8")

    with pytest.raises(ValueError, match=r"unplanned Pages Late\.md"):
        workspace_relocate_folder(
            str(tmp_path),
            "Notes",
            "Archive/Notes",
            [{"path": "Notes/Target.md", "expectedRevision": target_read["revision"]}],
            [],
        )

    assert target.read_text(encoding="utf-8") == "Target\n"
    assert not (tmp_path / "Archive").exists()


def test_folder_relocation_rolls_back_subtree_and_external_repairs(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    notes = tmp_path / "Notes"
    notes.mkdir()
    target = notes / "Target.md"
    daily = tmp_path / "Daily.md"
    target_source = b"---\nid: target-1\n---\n\n[[../Daily]]\n"
    daily_source = b"---\nid: daily-1\n---\n\n[[Notes/Target]]\n"
    target.write_bytes(target_source)
    daily.write_bytes(daily_source)
    target_backup = sidecar_path_for(target).with_name(".Target.doxmind.bak")
    target_backup.write_bytes(b"backup")
    target_read = read_doc(target)
    daily_read = read_doc(daily)
    real_write = workspace_module.MarkdownPageStore.write
    injected = False

    def fail_external_write_once(self, path, markdown, meta_patch=None, expected_revision=None):
        nonlocal injected
        if path == daily and not injected:
            injected = True
            raise OSError("injected folder repair failure")
        return real_write(self, path, markdown, meta_patch, expected_revision)

    monkeypatch.setattr(workspace_module.MarkdownPageStore, "write", fail_external_write_once)

    with pytest.raises(RuntimeError, match="rolled back"):
        workspace_relocate_folder(
            str(tmp_path),
            "Notes",
            "Archive/Notes",
            [
                {"path": "Daily.md", "expectedRevision": daily_read["revision"]},
                {"path": "Notes/Target.md", "expectedRevision": target_read["revision"]},
            ],
            [
                {
                    "sourcePath": "Notes/Target.md",
                    "destinationPath": "Archive/Notes/Target.md",
                    "expectedRevision": target_read["revision"],
                    "markdown": "[[../../Daily]]\n",
                },
                {
                    "sourcePath": "Daily.md",
                    "destinationPath": "Daily.md",
                    "expectedRevision": daily_read["revision"],
                    "markdown": "[[Archive/Notes/Target]]\n",
                },
            ],
        )

    assert target.read_bytes() == target_source
    assert daily.read_bytes() == daily_source
    assert target_backup.read_bytes() == b"backup"
    assert not (tmp_path / "Archive").exists()


def test_page_move_continues_best_effort_rollback_after_one_rollback_step_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = tmp_path / "Source.md"
    destination = tmp_path / "Archive" / "Source.md"
    source_bytes = b"source bytes"
    source.write_bytes(source_bytes)
    source_sidecar = sidecar_path_for(source)
    destination_sidecar = sidecar_path_for(destination)
    artifact_bytes = {
        "": b"exact bytes",
        ".bak": b"backup bytes",
        ".lock": b"lock bytes",
    }
    source_artifacts = {
        suffix: source_sidecar.with_name(f"{source_sidecar.name}{suffix}")
        for suffix in artifact_bytes
    }
    destination_artifacts = {
        suffix: destination_sidecar.with_name(f"{destination_sidecar.name}{suffix}")
        for suffix in artifact_bytes
    }
    for suffix, path in source_artifacts.items():
        path.write_bytes(artifact_bytes[suffix])

    real_rename = Path.rename

    def fail_forward_and_one_rollback(path: Path, target: Path) -> Path:
        if path == source_artifacts[".lock"]:
            raise OSError("injected forward failure")
        if path == destination_artifacts[".bak"]:
            raise OSError("injected rollback failure")
        return real_rename(path, target)

    monkeypatch.setattr(Path, "rename", fail_forward_and_one_rollback)

    with pytest.raises(RuntimeError, match=r"rollback incomplete .*\.bak"):
        _move_document_family(str(tmp_path), source.name, "Archive/Source.md")

    assert source.read_bytes() == source_bytes
    assert not destination.exists()
    assert source_artifacts[""].read_bytes() == artifact_bytes[""]
    assert source_artifacts[".lock"].read_bytes() == artifact_bytes[".lock"]
    assert destination_artifacts[".bak"].read_bytes() == artifact_bytes[".bak"]


def test_page_delete_moves_complete_legacy_sidecar_family_to_trash_byte_identically(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = tmp_path / "Delete.md"
    source_bytes = b"portable page\r\n"
    source.write_bytes(source_bytes)
    source_sidecar = sidecar_path_for(source)
    artifact_bytes = {
        "": b"exact bytes",
        ".bak": b"backup\x00bytes",
        ".lock": b"persistent lock bytes",
        ".corrupt-500": b"forensic first",
        ".corrupt-600": b"forensic second",
    }
    for suffix, raw in artifact_bytes.items():
        source_sidecar.with_name(f"{source_sidecar.name}{suffix}").write_bytes(raw)

    fake_trash = tmp_path / "Fake Trash"
    fake_trash.mkdir()

    def move_to_fake_trash(path: Path) -> None:
        path.rename(fake_trash / path.name)

    monkeypatch.setattr(workspace_module, "_move_to_os_trash", move_to_fake_trash)

    deleted = doc_delete(str(tmp_path), source.name)

    assert deleted == {"path": source.name, "sidecarPath": source_sidecar.name}
    assert not source.exists()
    assert (fake_trash / source.name).read_bytes() == source_bytes
    for suffix, raw in artifact_bytes.items():
        source_artifact = source_sidecar.with_name(f"{source_sidecar.name}{suffix}")
        assert not source_artifact.exists()
        assert (fake_trash / source_artifact.name).read_bytes() == raw


def test_page_delete_without_sidecar_trashes_only_the_markdown_file(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = tmp_path / "Only.md"
    source.write_bytes(b"markdown only\n")
    fake_trash = tmp_path / "Fake Trash"
    fake_trash.mkdir()
    trashed_paths: list[Path] = []

    def move_to_fake_trash(path: Path) -> None:
        trashed_paths.append(path)
        path.rename(fake_trash / path.name)

    monkeypatch.setattr(workspace_module, "_move_to_os_trash", move_to_fake_trash)

    deleted = doc_delete(str(tmp_path), source.name)

    assert deleted == {"path": source.name, "sidecarPath": None}
    assert trashed_paths == [source]
    assert [path.name for path in fake_trash.iterdir()] == [source.name]
    assert not sidecar_path_for(source).exists()


def test_page_delete_attempts_remaining_legacy_artifacts_after_one_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = tmp_path / "Partial.md"
    source.write_bytes(b"page bytes")
    source_sidecar = sidecar_path_for(source)
    artifacts = {
        "": b"exact bytes",
        ".bak": b"backup bytes",
        ".lock": b"lock bytes",
        ".corrupt-700": b"forensic bytes",
    }
    artifact_paths = {
        suffix: source_sidecar.with_name(f"{source_sidecar.name}{suffix}") for suffix in artifacts
    }
    for suffix, path in artifact_paths.items():
        path.write_bytes(artifacts[suffix])

    fake_trash = tmp_path / "Fake Trash"
    fake_trash.mkdir()

    def fail_backup_only(path: Path) -> None:
        if path == artifact_paths[".bak"]:
            raise OSError("injected Trash failure")
        path.rename(fake_trash / path.name)

    monkeypatch.setattr(workspace_module, "_move_to_os_trash", fail_backup_only)

    with pytest.raises(RuntimeError, match=r"\.Partial\.doxmind\.bak"):
        doc_delete(str(tmp_path), source.name)

    assert not source.exists()
    assert artifact_paths[".bak"].read_bytes() == artifacts[".bak"]
    for suffix in ("", ".lock", ".corrupt-700"):
        path = artifact_paths[suffix]
        assert not path.exists()
        assert (fake_trash / path.name).read_bytes() == artifacts[suffix]


def test_metadata_only_write_persists_frontmatter_without_changing_body(tmp_path: Path) -> None:
    page = tmp_path / "Pinned.md"
    body = "Body\n\n\n"
    page.write_text(f"---\nid: page-pinned\n---\n\n{body}", encoding="utf-8")

    saved = write_doc_workspace(
        str(tmp_path),
        "Pinned.md",
        {"meta": {"favorite": True, "title": "Pinned"}},
    )
    reopened = read_doc(page)

    assert saved["meta"]["favorite"] is True
    assert reopened["meta"]["favorite"] is True
    assert reopened["meta"]["title"] == "Pinned"
    assert reopened["markdown"] == body
    assert page.read_text(encoding="utf-8").endswith(body)
    scanned = workspace_scan(str(tmp_path))["documents"][0]
    assert scanned["favorite"] is True


def test_workspace_write_upsert_creates_a_stable_frontmatter_id(tmp_path: Path) -> None:
    saved = write_doc_workspace(
        str(tmp_path),
        "Fresh.md",
        {"markdown": "body", "meta": {"id": "claimed-id", "favorite": True}},
    )
    reopened = read_doc(tmp_path / "Fresh.md")

    assert saved["meta"]["id"] == "claimed-id"
    assert reopened["meta"]["id"] == "claimed-id"
    assert reopened["meta"]["favorite"] is True
    assert (tmp_path / "Fresh.md").read_text(encoding="utf-8") == (
        "---\nid: claimed-id\nfavorite: true\n---\n\nbody"
    )


@pytest.mark.parametrize(
    "source_id",
    [
        "123",
        "{ nested: object }",
        '""',
    ],
)
def test_existing_page_metadata_patch_never_rewrites_invalid_source_id(
    tmp_path: Path, source_id: str
) -> None:
    page = tmp_path / "External.md"
    original = (
        "---\r\n"
        "# hand-authored comment\r\n"
        f"id: {source_id}\r\n"
        "custom:\r\n"
        "  nested: keep\r\n"
        "---\r\n"
        "\r\n"
        "Body\r\n\r\n"
    )
    page.write_bytes(original.encode("utf-8"))

    saved = write_doc_workspace(
        str(tmp_path),
        "External.md",
        {"meta": {"id": "path:External.md", "favorite": True}},
    )

    expected = original.replace("---\r\n\r\nBody", "favorite: true\r\n---\r\n\r\nBody", 1)
    assert page.read_bytes() == expected.encode("utf-8")
    assert saved["meta"].get("id") is None
    assert saved["meta"]["favorite"] is True
    assert workspace_scan(str(tmp_path))["documents"][0]["id"] == stable_path_id("External.md")


@pytest.mark.parametrize(
    ("name", "source_bytes", "editor_key", "editor"),
    [
        (
            "Spec.pdf",
            b"%PDF-1.4\n%%EOF\n",
            "pdf_editor",
            {"version": 1, "highlights": [{"id": "h1"}]},
        ),
        (
            "Budget.xlsx",
            b"PK\x03\x04workbook",
            "excel_editor",
            {"version": 1, "cells": {"sheet-1!0,0": {"value": 42}}},
        ),
    ],
)
def test_attachment_recovery_export_reads_legacy_state_without_writing(
    tmp_path: Path,
    name: str,
    source_bytes: bytes,
    editor_key: str,
    editor: dict[str, object],
) -> None:
    source = tmp_path / name
    source.write_bytes(source_bytes)
    sidecar = sidecar_path_for(source)
    sidecar_bytes = json.dumps({"version": 1, editor_key: editor}).encode("utf-8")
    sidecar.write_bytes(sidecar_bytes)
    lock = sidecar.with_name(f"{sidecar.name}.lock")
    lock.write_bytes(b"keep lock")

    recovery = read_attachment_recovery(str(tmp_path), name)

    assert recovery == {"editor": editor}
    assert source.read_bytes() == source_bytes
    assert sidecar.read_bytes() == sidecar_bytes
    assert lock.read_bytes() == b"keep lock"
    assert not sidecar.with_name(f"{sidecar.name}.bak").exists()


def test_page_recovery_inspection_inventories_complete_family_without_writing(
    tmp_path: Path,
) -> None:
    page = tmp_path / "Notes.markdown"
    page.write_bytes(b"# Portable\n")
    sidecar = sidecar_path_for(page)
    artifact_bytes = {
        "": b'{"version":1}\n',
        ".bak": b"\x00\x01\x02",
        ".lock": b"",
        ".corrupt-200": b"second",
        ".corrupt-100": b"first",
    }
    for suffix, raw in artifact_bytes.items():
        sidecar.with_name(f"{sidecar.name}{suffix}").write_bytes(raw)
    before = {
        path.name: (path.stat().st_mtime_ns, path.read_bytes()) for path in tmp_path.iterdir()
    }

    inspection = inspect_page_recovery(str(tmp_path), page.name)

    assert inspection == {
        "recoveryStatus": "available",
        "artifacts": [
            ".Notes.doxmind",
            ".Notes.doxmind.bak",
            ".Notes.doxmind.lock",
            ".Notes.doxmind.corrupt-100",
            ".Notes.doxmind.corrupt-200",
        ],
    }
    assert {
        path.name: (path.stat().st_mtime_ns, path.read_bytes()) for path in tmp_path.iterdir()
    } == before


def test_page_recovery_read_returns_every_artifacts_exact_raw_bytes_without_writing(
    tmp_path: Path,
) -> None:
    page = tmp_path / "Raw.md"
    page.write_bytes(b"portable page\n")
    sidecar = sidecar_path_for(page)
    artifact_bytes = {
        "": b"\x00\xff```\n",
        ".bak": b"",
        ".lock": b"lock\r\n",
        ".corrupt-z": b"\xde\xad\xbe\xef",
    }
    for suffix, raw in artifact_bytes.items():
        sidecar.with_name(f"{sidecar.name}{suffix}").write_bytes(raw)
    before = {
        path.name: (path.stat().st_mtime_ns, path.read_bytes()) for path in tmp_path.iterdir()
    }

    recovery = read_page_recovery(str(tmp_path), page.name)

    assert recovery == {
        "artifacts": [
            {
                "path": f"{sidecar.name}{suffix}",
                "bytes": list(raw),
            }
            for suffix, raw in artifact_bytes.items()
        ]
    }
    assert {
        path.name: (path.stat().st_mtime_ns, path.read_bytes()) for path in tmp_path.iterdir()
    } == before


def test_page_recovery_commands_report_none_for_an_ordinary_page(tmp_path: Path) -> None:
    page = tmp_path / "Clean.md"
    page.write_bytes(b"# Clean\n")

    assert workspace_module._invoke(
        "workspace_inspect_page_recovery",
        {"root": str(tmp_path), "path": page.name},
    ) == {"recoveryStatus": "none", "artifacts": []}
    assert workspace_module._invoke(
        "workspace_read_page_recovery",
        {"root": str(tmp_path), "path": page.name},
    ) == {"artifacts": []}


def test_page_recovery_rejects_attachments_and_symbolic_link_artifacts(
    tmp_path: Path,
) -> None:
    attachment = tmp_path / "Spec.pdf"
    attachment.write_bytes(b"%PDF\n")
    with pytest.raises(ValueError, match=r"\.md or \.markdown"):
        inspect_page_recovery(str(tmp_path), attachment.name)

    page = tmp_path / "Page.md"
    page.write_bytes(b"page\n")
    outside = tmp_path / "outside"
    outside.write_bytes(b"secret\n")
    sidecar_path_for(page).symlink_to(outside)
    with pytest.raises(ValueError, match="symbolic link"):
        read_page_recovery(str(tmp_path), page.name)


def test_page_recovery_rejects_a_symbolic_link_page(tmp_path: Path) -> None:
    actual = tmp_path / "Actual.md"
    actual.write_bytes(b"actual page\n")
    linked = tmp_path / "Linked.md"
    linked.symlink_to(actual)

    with pytest.raises(ValueError, match="symbolic link"):
        inspect_page_recovery(str(tmp_path), linked.name)


def test_workspace_write_rejects_stale_revision_without_overwriting_external_edit(
    tmp_path: Path,
) -> None:
    page = tmp_path / "Concurrent.md"
    page.write_text("first", encoding="utf-8")
    opened = read_doc(page)
    page.write_text("external", encoding="utf-8")

    with pytest.raises(PageRevisionConflictError, match="page_revision_conflict"):
        write_doc_workspace(
            str(tmp_path),
            "Concurrent.md",
            {
                "markdown": "stale local",
                "expectedRevision": opened["revision"],
            },
        )

    assert page.read_text(encoding="utf-8") == "external"


def test_whitespace_only_page_read_preserves_exact_markdown(tmp_path: Path) -> None:
    page = tmp_path / "Whitespace.md"
    page.write_bytes(b" \r\n\r\n")

    opened = read_doc(page)

    assert {"extras", "source", "sourceState", "correlation"}.isdisjoint(opened)
    assert opened["markdown"] == " \r\n\r\n"
    assert opened["revision"].startswith("sha256:")
