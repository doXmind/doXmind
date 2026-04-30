import hashlib
import json
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import DatabaseBlock, DatabaseRow, DatabaseView, File


@pytest.mark.asyncio
async def test_export_library_to_workspace_preserves_tree_and_sidecars(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
):
    folder_id = str(uuid.uuid4())
    doc_id = str(uuid.uuid4())
    trash_id = str(uuid.uuid4())
    db_id = str(uuid.uuid4())

    folder = File(id=folder_id, name="Projects", is_folder=True, position=0)
    doc = File(
        id=doc_id,
        name="Plan.md",
        content=f'<h1>Plan</h1><div data-type="database-block" data-database-id="{db_id}"></div>',
        content_markdown=f"# Plan\n\n<!-- database:{db_id} -->\n",
        parent_id=folder_id,
        position=0,
        icon="doc",
    )
    trashed = File(
        id=trash_id,
        name="Deleted",
        content_markdown="do not export",
        deleted_at=datetime.now(UTC),
    )
    database = DatabaseBlock(
        id=db_id,
        title="Tasks",
        properties_schema=[{"id": "name", "name": "Name", "type": "text"}],
    )
    row = DatabaseRow(
        id=str(uuid.uuid4()),
        database_id=db_id,
        properties={"name": "Ship"},
        position=0,
    )
    view = DatabaseView(
        id=str(uuid.uuid4()),
        database_id=db_id,
        name="Table",
        type="table",
        config={},
        position=0,
    )
    db_session.add_all([folder, doc, trashed, database, row, view])
    await db_session.commit()

    output_root = tmp_path / "workspace"
    response = await client.post(
        "/api/migration/export-library",
        json={"output_root": str(output_root)},
    )

    assert response.status_code == 200
    summary = response.json()
    assert summary["folders_exported"] == 1
    assert summary["documents_exported"] == 1
    assert summary["sidecars_written"] == 1
    assert summary["databases_embedded"] == 1
    assert summary["skipped_trash"] == 1
    assert summary["written_markdown"] == ["Projects/Plan.md"]

    markdown_path = output_root / "Projects" / "Plan.md"
    assert markdown_path.exists()
    markdown = markdown_path.read_text(encoding="utf-8")
    assert f"id: {doc_id}" in markdown
    assert "title: Plan.md" in markdown
    assert f"<!-- database:{db_id} -->" in markdown
    assert not (output_root / "Deleted.md").exists()

    sidecar = json.loads((output_root / "Projects" / ".Plan.doxmind").read_text())
    assert sidecar["version"] == 1
    assert sidecar["id"] == doc_id
    assert sidecar["html"] == doc.content
    assert sidecar["markdown_hash"] == hashlib.sha256(markdown.encode("utf-8")).hexdigest()
    assert sidecar["extras"]["databases"][db_id]["title"] == "Tasks"
    assert sidecar["extras"]["databases"][db_id]["rows"][0]["properties"] == {"name": "Ship"}


@pytest.mark.asyncio
async def test_export_library_refuses_non_empty_workspace_without_overwrite(
    client: AsyncClient,
    tmp_path: Path,
):
    output_root = tmp_path / "workspace"
    output_root.mkdir()
    (output_root / "existing.md").write_text("# Existing\n", encoding="utf-8")

    response = await client.post(
        "/api/migration/export-library",
        json={"output_root": str(output_root)},
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "BAD_REQUEST"


@pytest.mark.asyncio
async def test_export_library_rewrites_current_image_urls(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
):
    image_name = "image.png"
    image_source = Path.home() / ".doxmind" / "uploads" / "images" / image_name
    image_source.parent.mkdir(parents=True, exist_ok=True)
    image_source.write_bytes(b"png")

    doc_id = str(uuid.uuid4())
    doc = File(
        id=doc_id,
        name="Images.md",
        content_markdown=f"![diagram](/api/images/{image_name})\n",
    )
    db_session.add(doc)
    await db_session.commit()

    output_root = tmp_path / "workspace"
    response = await client.post(
        "/api/migration/export-library",
        json={"output_root": str(output_root)},
    )

    assert response.status_code == 200
    markdown = (output_root / "Images.md").read_text(encoding="utf-8")
    assert "![diagram](./assets/image.png)" in markdown
    assert (output_root / "assets" / image_name).read_bytes() == b"png"
