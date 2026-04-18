"""Database block API routes for Notion-style inline databases."""

import contextlib
import copy
import csv
import io
import logging
import os
import tempfile
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from db.database import (
    ConversationDataFile,
    DatabaseBlock,
    DatabaseRow,
    DatabaseView,
    File,
    get_db,
)
from dependencies import get_conversation_by_file_id
from services.auth_service import TokenData, require_auth
from services.data_parser_service import get_data_parser_service

logger = logging.getLogger(__name__)

router = APIRouter()


def get_user_id(token: TokenData) -> str | None:
    """Get user ID from token for data isolation.

    Returns None only for special dev/api-key users (which share data).
    Real users always get their user_id for proper isolation.
    """
    if token.sub in ("dev-user", "api-key-user", "anonymous"):
        return None
    return token.sub


# =============================================================================
# Pydantic Models
# =============================================================================


class PropertyOptions(BaseModel):
    choices: list[dict] | None = None
    format: str | None = None
    includeTime: bool | None = None
    dateFormat: str | None = None


class PropertyDef(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    type: str
    position: int = 0
    options: PropertyOptions | None = None


class CreateDatabaseRequest(BaseModel):
    title: str = "Untitled Database"
    properties_schema: list[dict] | None = None
    rows: list[dict] | None = None
    views: list[dict] | None = None


class UpdateDatabaseRequest(BaseModel):
    title: str | None = None
    icon: str | None = None


class AddPropertyRequest(BaseModel):
    name: str
    type: str
    options: PropertyOptions | None = None


class UpdatePropertyRequest(BaseModel):
    name: str | None = None
    type: str | None = None
    options: PropertyOptions | None = None


class ReorderPropertiesRequest(BaseModel):
    property_ids: list[str]


class AddRowRequest(BaseModel):
    properties: dict | None = None


class UpdateRowRequest(BaseModel):
    properties: dict


class ReorderRowsRequest(BaseModel):
    row_ids: list[str]


class SendToChatRequest(BaseModel):
    file_id: str  # Editor file ID (used to resolve/create conversation)


class CreateViewRequest(BaseModel):
    name: str
    type: str = "table"
    config: dict | None = None


class UpdateViewRequest(BaseModel):
    name: str | None = None
    config: dict | None = None


# =============================================================================
# Helper
# =============================================================================


def _db_to_dict(db: DatabaseBlock) -> dict:
    """Serialize a DatabaseBlock with all its rows and views."""
    return {
        "id": db.id,
        "title": db.title,
        "icon": db.icon,
        "properties_schema": db.properties_schema or [],
        "rows": [
            {
                "id": r.id,
                "database_id": r.database_id,
                "properties": r.properties or {},
                "position": r.position,
                "page_file_id": r.page_file_id,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            }
            for r in (db.rows or [])
        ],
        "views": [
            {
                "id": v.id,
                "database_id": v.database_id,
                "name": v.name,
                "type": v.type,
                "config": v.config or {},
                "position": v.position,
                "created_at": v.created_at.isoformat() if v.created_at else None,
                "updated_at": v.updated_at.isoformat() if v.updated_at else None,
            }
            for v in (db.views or [])
        ],
        "created_at": db.created_at.isoformat() if db.created_at else None,
        "updated_at": db.updated_at.isoformat() if db.updated_at else None,
    }


async def _get_db_or_404(
    database_id: str, user_id: str | None, session: AsyncSession
) -> DatabaseBlock:
    """Fetch a database block with rows and views, or raise 404."""
    query = (
        select(DatabaseBlock)
        .where(DatabaseBlock.id == database_id)
        .options(selectinload(DatabaseBlock.rows), selectinload(DatabaseBlock.views))
    )
    if user_id is not None:
        query = query.where(DatabaseBlock.user_id == user_id)
    result = await session.execute(query)
    db = result.scalar_one_or_none()
    if not db:
        raise HTTPException(status_code=404, detail="Database not found")
    return db


# =============================================================================
# Database CRUD
# =============================================================================


@router.post("/")
async def create_database(
    body: CreateDatabaseRequest,
    token: TokenData = Depends(require_auth),
    session: AsyncSession = Depends(get_db),
):
    """Create a new database block with default or custom properties and views.

    Supports three creation modes:
    - Default: hardcoded Name + Status schema with sample rows
    - Template/CSV: client provides properties_schema, rows, and views
    """
    user_id = get_user_id(token)

    if body.properties_schema:
        # ── Custom schema (template or CSV import) ──
        schema = body.properties_schema

        db_block = DatabaseBlock(
            id=str(uuid.uuid4()),
            user_id=user_id,
            title=body.title,
            properties_schema=schema,
        )
        session.add(db_block)

        # Views from request, or default Table view
        if body.views:
            for i, v in enumerate(body.views):
                session.add(
                    DatabaseView(
                        database_id=db_block.id,
                        name=v.get("name", "Table View"),
                        type=v.get("type", "table"),
                        config=v.get("config") or {},
                        position=i,
                    )
                )
        else:
            session.add(
                DatabaseView(
                    database_id=db_block.id,
                    name="Table View",
                    type="table",
                    config={},
                    position=0,
                )
            )

        # Rows from request — bulk insert in batches for performance
        if body.rows:
            BATCH_SIZE = 1000
            now = datetime.now(UTC)
            rows_to_insert = [
                {
                    "id": str(uuid.uuid4()),
                    "database_id": db_block.id,
                    "properties": (row_data.get("properties") if isinstance(row_data, dict) else {})
                    or {},
                    "position": i,
                    "created_at": now,
                    "updated_at": now,
                }
                for i, row_data in enumerate(body.rows)
            ]
            for batch_start in range(0, len(rows_to_insert), BATCH_SIZE):
                batch = rows_to_insert[batch_start : batch_start + BATCH_SIZE]
                await session.execute(insert(DatabaseRow), batch)
    else:
        # ── Default schema: Name (text) + Status (select) ──
        name_prop_id = str(uuid.uuid4())
        status_prop_id = str(uuid.uuid4())
        default_schema = [
            {
                "id": name_prop_id,
                "name": "Name",
                "type": "text",
                "position": 0,
            },
            {
                "id": status_prop_id,
                "name": "Status",
                "type": "select",
                "position": 1,
                "options": {
                    "choices": [
                        {"id": str(uuid.uuid4()), "name": "To Do", "color": "gray"},
                        {"id": str(uuid.uuid4()), "name": "In Progress", "color": "blue"},
                        {"id": str(uuid.uuid4()), "name": "Done", "color": "green"},
                    ]
                },
            },
        ]

        db_block = DatabaseBlock(
            id=str(uuid.uuid4()),
            user_id=user_id,
            title=body.title,
            properties_schema=default_schema,
        )
        session.add(db_block)

        # Views: use body.views if provided, else default Table + Board
        if body.views:
            for i, v in enumerate(body.views):
                config = v.get("config") or {}
                # Auto-configure board groupBy if not specified
                if v.get("type") == "board" and "groupByPropertyId" not in config:
                    config["groupByPropertyId"] = status_prop_id
                session.add(
                    DatabaseView(
                        database_id=db_block.id,
                        name=v.get("name", "Table View"),
                        type=v.get("type", "table"),
                        config=config,
                        position=i,
                    )
                )
        else:
            table_view = DatabaseView(
                database_id=db_block.id,
                name="Table View",
                type="table",
                config={},
                position=0,
            )
            board_view = DatabaseView(
                database_id=db_block.id,
                name="Board View",
                type="board",
                config={"groupByPropertyId": status_prop_id},
                position=1,
            )
            session.add_all([table_view, board_view])

        # Add 3 sample rows
        for i, (name, status) in enumerate(
            [
                ("Task 1", "To Do"),
                ("Task 2", "In Progress"),
                ("Task 3", "Done"),
            ]
        ):
            status_choice = next(
                (c for c in default_schema[1]["options"]["choices"] if c["name"] == status),
                None,
            )
            row = DatabaseRow(
                database_id=db_block.id,
                properties={
                    name_prop_id: name,
                    status_prop_id: status_choice["id"] if status_choice else None,
                },
                position=i,
            )
            session.add(row)

    await session.commit()

    # For large imports, return lightweight response without rows
    row_count = len(body.rows) if body.rows else 0
    if body.properties_schema and row_count > 100:
        await session.refresh(db_block)
        views_result = await session.execute(
            select(DatabaseView)
            .where(DatabaseView.database_id == db_block.id)
            .order_by(DatabaseView.position)
        )
        views = views_result.scalars().all()
        return {
            "id": db_block.id,
            "title": db_block.title,
            "icon": db_block.icon,
            "properties_schema": db_block.properties_schema or [],
            "rows": [],
            "row_count": row_count,
            "views": [
                {
                    "id": v.id,
                    "database_id": v.database_id,
                    "name": v.name,
                    "type": v.type,
                    "config": v.config or {},
                    "position": v.position,
                    "created_at": v.created_at.isoformat() if v.created_at else None,
                    "updated_at": v.updated_at.isoformat() if v.updated_at else None,
                }
                for v in views
            ],
            "created_at": db_block.created_at.isoformat() if db_block.created_at else None,
            "updated_at": db_block.updated_at.isoformat() if db_block.updated_at else None,
        }

    # Re-fetch with relationships loaded
    db_block = await _get_db_or_404(db_block.id, user_id, session)
    return _db_to_dict(db_block)


@router.get("/{database_id}")
async def get_database(
    database_id: str,
    token: TokenData = Depends(require_auth),
    session: AsyncSession = Depends(get_db),
):
    """Get a database block metadata and views. Rows are loaded separately via pagination."""
    user_id = get_user_id(token)

    # Load database with views only (skip rows for performance)
    query = (
        select(DatabaseBlock)
        .where(DatabaseBlock.id == database_id)
        .options(selectinload(DatabaseBlock.views))
    )
    if user_id is not None:
        query = query.where(DatabaseBlock.user_id == user_id)
    result = await session.execute(query)
    db = result.scalar_one_or_none()
    if not db:
        raise HTTPException(status_code=404, detail="Database not found")

    # Count rows separately
    count_query = (
        select(func.count()).select_from(DatabaseRow).where(DatabaseRow.database_id == database_id)
    )
    row_count = (await session.execute(count_query)).scalar() or 0

    return {
        "id": db.id,
        "title": db.title,
        "icon": db.icon,
        "properties_schema": db.properties_schema or [],
        "rows": [],
        "row_count": row_count,
        "views": [
            {
                "id": v.id,
                "database_id": v.database_id,
                "name": v.name,
                "type": v.type,
                "config": v.config or {},
                "position": v.position,
                "created_at": v.created_at.isoformat() if v.created_at else None,
                "updated_at": v.updated_at.isoformat() if v.updated_at else None,
            }
            for v in (db.views or [])
        ],
        "created_at": db.created_at.isoformat() if db.created_at else None,
        "updated_at": db.updated_at.isoformat() if db.updated_at else None,
    }


@router.put("/{database_id}")
async def update_database(
    database_id: str,
    body: UpdateDatabaseRequest,
    token: TokenData = Depends(require_auth),
    session: AsyncSession = Depends(get_db),
):
    """Update database title or icon."""
    user_id = get_user_id(token)
    db = await _get_db_or_404(database_id, user_id, session)
    if body.title is not None:
        db.title = body.title
    if body.icon is not None:
        db.icon = body.icon
    await session.commit()
    return _db_to_dict(db)


@router.delete("/{database_id}")
async def delete_database(
    database_id: str,
    token: TokenData = Depends(require_auth),
    session: AsyncSession = Depends(get_db),
):
    """Delete a database block and all its rows/views, plus any auto-exported data files."""
    user_id = get_user_id(token)
    db = await _get_db_or_404(database_id, user_id, session)

    # Clean up page files linked to rows
    for row in db.rows:
        if row.page_file_id:
            page_file = await session.get(File, row.page_file_id)
            if page_file:
                await session.delete(page_file)

    # Clean up any auto-exported data files linked to this database
    data_files_result = await session.execute(
        select(ConversationDataFile).where(ConversationDataFile.source_database_id == database_id)
    )
    for data_file in data_files_result.scalars().all():
        if data_file.storage_path and os.path.exists(data_file.storage_path):
            with contextlib.suppress(OSError):
                os.remove(data_file.storage_path)
        await session.delete(data_file)

    await session.delete(db)
    await session.commit()
    return {"status": "deleted"}


# =============================================================================
# Property Management
# =============================================================================


@router.post("/{database_id}/properties")
async def add_property(
    database_id: str,
    body: AddPropertyRequest,
    token: TokenData = Depends(require_auth),
    session: AsyncSession = Depends(get_db),
):
    """Add a new property column to the database."""
    user_id = get_user_id(token)
    db = await _get_db_or_404(database_id, user_id, session)
    schema = list(db.properties_schema or [])

    new_prop = {
        "id": str(uuid.uuid4()),
        "name": body.name,
        "type": body.type,
        "position": len(schema),
    }
    if body.options:
        new_prop["options"] = body.options.model_dump(exclude_none=True)

    schema.append(new_prop)
    db.properties_schema = schema
    await session.commit()
    return _db_to_dict(db)


@router.put("/{database_id}/properties/{prop_id}")
async def update_property(
    database_id: str,
    prop_id: str,
    body: UpdatePropertyRequest,
    token: TokenData = Depends(require_auth),
    session: AsyncSession = Depends(get_db),
):
    """Update a property's name, type, or options."""
    user_id = get_user_id(token)
    db = await _get_db_or_404(database_id, user_id, session)
    schema = copy.deepcopy(db.properties_schema or [])

    prop = next((p for p in schema if p["id"] == prop_id), None)
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    if body.name is not None:
        prop["name"] = body.name
    if body.type is not None:
        prop["type"] = body.type
    if body.options is not None:
        prop["options"] = body.options.model_dump(exclude_none=True)

    db.properties_schema = schema
    await session.commit()
    return _db_to_dict(db)


@router.delete("/{database_id}/properties/{prop_id}")
async def delete_property(
    database_id: str,
    prop_id: str,
    token: TokenData = Depends(require_auth),
    session: AsyncSession = Depends(get_db),
):
    """Remove a property column and clean up row data."""
    user_id = get_user_id(token)
    db = await _get_db_or_404(database_id, user_id, session)
    schema = [p for p in (db.properties_schema or []) if p["id"] != prop_id]

    if len(schema) == len(db.properties_schema or []):
        raise HTTPException(status_code=404, detail="Property not found")

    # Reindex positions
    for i, p in enumerate(schema):
        p["position"] = i

    db.properties_schema = schema

    # Remove the property value from all rows
    for row in db.rows:
        props = dict(row.properties or {})
        props.pop(prop_id, None)
        row.properties = props

    await session.commit()
    return _db_to_dict(db)


@router.put("/{database_id}/properties/reorder")
async def reorder_properties(
    database_id: str,
    body: ReorderPropertiesRequest,
    token: TokenData = Depends(require_auth),
    session: AsyncSession = Depends(get_db),
):
    """Reorder property columns."""
    user_id = get_user_id(token)
    db = await _get_db_or_404(database_id, user_id, session)
    schema = list(db.properties_schema or [])
    prop_map = {p["id"]: p for p in schema}

    reordered = []
    for i, pid in enumerate(body.property_ids):
        if pid in prop_map:
            prop_map[pid]["position"] = i
            reordered.append(prop_map[pid])

    # Append any properties not in the reorder list (with incrementing positions)
    reordered_ids = {r["id"] for r in reordered}
    for p in schema:
        if p["id"] not in reordered_ids:
            p["position"] = len(reordered)
            reordered.append(p)

    db.properties_schema = reordered
    await session.commit()
    return _db_to_dict(db)


# =============================================================================
# Row Management
# =============================================================================


@router.get("/{database_id}/rows")
async def list_rows(
    database_id: str,
    limit: int = Query(500, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    token: TokenData = Depends(require_auth),
    session: AsyncSession = Depends(get_db),
):
    """Get paginated rows for a database."""
    user_id = get_user_id(token)

    # Verify database exists and user has access (without loading rows)
    db_query = select(DatabaseBlock).where(DatabaseBlock.id == database_id)
    if user_id is not None:
        db_query = db_query.where(DatabaseBlock.user_id == user_id)
    result = await session.execute(db_query)
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Database not found")

    # Count total rows
    count_query = (
        select(func.count()).select_from(DatabaseRow).where(DatabaseRow.database_id == database_id)
    )
    total = (await session.execute(count_query)).scalar() or 0

    # Fetch paginated rows
    rows_query = (
        select(DatabaseRow)
        .where(DatabaseRow.database_id == database_id)
        .order_by(DatabaseRow.position)
        .limit(limit)
        .offset(offset)
    )
    rows_result = await session.execute(rows_query)
    rows = rows_result.scalars().all()

    return {
        "rows": [
            {
                "id": r.id,
                "database_id": r.database_id,
                "properties": r.properties or {},
                "position": r.position,
                "page_file_id": r.page_file_id,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            }
            for r in rows
        ],
        "total": total,
        "has_more": offset + limit < total,
    }


@router.post("/{database_id}/rows")
async def add_row(
    database_id: str,
    body: AddRowRequest,
    token: TokenData = Depends(require_auth),
    session: AsyncSession = Depends(get_db),
):
    """Add a new row to the database."""
    user_id = get_user_id(token)
    db = await _get_db_or_404(database_id, user_id, session)

    max_pos = max((r.position for r in db.rows), default=-1)
    row = DatabaseRow(
        database_id=database_id,
        properties=body.properties or {},
        position=max_pos + 1,
    )
    session.add(row)
    await session.commit()

    # Re-fetch to get updated rows list
    db = await _get_db_or_404(database_id, user_id, session)
    return _db_to_dict(db)


@router.put("/{database_id}/rows/{row_id}")
async def update_row(
    database_id: str,
    row_id: str,
    body: UpdateRowRequest,
    token: TokenData = Depends(require_auth),
    session: AsyncSession = Depends(get_db),
):
    """Update cell values in a row."""
    user_id = get_user_id(token)
    db = await _get_db_or_404(database_id, user_id, session)

    row = next((r for r in db.rows if r.id == row_id), None)
    if not row:
        raise HTTPException(status_code=404, detail="Row not found")

    # Merge new values into existing properties
    current = dict(row.properties or {})
    current.update(body.properties)
    row.properties = current
    await session.commit()
    return _db_to_dict(db)


@router.delete("/{database_id}/rows/{row_id}")
async def delete_row(
    database_id: str,
    row_id: str,
    token: TokenData = Depends(require_auth),
    session: AsyncSession = Depends(get_db),
):
    """Delete a row from the database."""
    user_id = get_user_id(token)
    db = await _get_db_or_404(database_id, user_id, session)

    row = next((r for r in db.rows if r.id == row_id), None)
    if not row:
        raise HTTPException(status_code=404, detail="Row not found")

    # Clean up linked page file if it exists
    if row.page_file_id:
        page_file = await session.get(File, row.page_file_id)
        if page_file:
            await session.delete(page_file)

    await session.delete(row)
    await session.commit()

    db = await _get_db_or_404(database_id, user_id, session)
    return _db_to_dict(db)


@router.put("/{database_id}/rows/reorder")
async def reorder_rows(
    database_id: str,
    body: ReorderRowsRequest,
    token: TokenData = Depends(require_auth),
    session: AsyncSession = Depends(get_db),
):
    """Reorder rows by providing the new order of row IDs."""
    user_id = get_user_id(token)
    db = await _get_db_or_404(database_id, user_id, session)
    row_map = {r.id: r for r in db.rows}

    # Assign new positions to all provided row IDs
    next_pos = 0
    for rid in body.row_ids:
        if rid in row_map:
            row_map[rid].position = next_pos
            next_pos += 1

    # Rows not in the reorder list get positions after the reordered ones
    reordered_ids = set(body.row_ids)
    for row in sorted(db.rows, key=lambda r: r.position):
        if row.id not in reordered_ids:
            row.position = next_pos
            next_pos += 1

    await session.commit()
    db = await _get_db_or_404(database_id, user_id, session)
    return _db_to_dict(db)


# =============================================================================
# Row Page
# =============================================================================


@router.post("/{database_id}/rows/{row_id}/page")
async def create_or_get_row_page(
    database_id: str,
    row_id: str,
    token: TokenData = Depends(require_auth),
    session: AsyncSession = Depends(get_db),
):
    """Create or get the page (File) associated with a database row."""
    user_id = get_user_id(token)
    db = await _get_db_or_404(database_id, user_id, session)

    row = next((r for r in db.rows if r.id == row_id), None)
    if not row:
        raise HTTPException(status_code=404, detail="Row not found")

    # If page already exists, return its ID
    if row.page_file_id:
        return {"page_file_id": row.page_file_id}

    # Find the first text property to use as page title
    schema = db.properties_schema or []
    title = "Untitled"
    for prop in schema:
        if prop["type"] == "text":
            val = (row.properties or {}).get(prop["id"])
            if val:
                title = str(val)
                break

    # Create a new File for this row
    page = File(
        user_id=user_id,
        name=title,
        content="",
    )
    session.add(page)
    await session.flush()  # Get the generated ID

    row.page_file_id = page.id
    await session.commit()
    return {"page_file_id": page.id}


# =============================================================================
# Send to Chat (export database as CSV data file for AI analysis)
# =============================================================================


def _resolve_cell_value(value, prop: dict) -> str:
    """Resolve a cell value to a human-readable string for CSV export.

    Select/multi-select values are stored as choice UUIDs — this maps them
    back to display names using the property schema.
    """
    if value is None:
        return ""

    prop_type = prop.get("type", "text")
    choices = (prop.get("options") or {}).get("choices") or []
    choice_map = {c["id"]: c.get("name", c["id"]) for c in choices}

    if prop_type == "select":
        return choice_map.get(str(value), str(value))

    if prop_type == "multi_select":
        if isinstance(value, list):
            return ", ".join(choice_map.get(str(v), str(v)) for v in value)
        return str(value)

    if prop_type == "checkbox":
        return "true" if value else "false"

    return str(value)


async def export_database_to_data_file(
    database_id: str,
    conversation_id: str,
    user_id: str | None,
    session: AsyncSession,
) -> ConversationDataFile | None:
    """Export a database block as a CSV data file for AI analysis.

    This is a reusable function called by both the manual "send-to-chat"
    endpoint and the automatic chat-stream export logic.

    Returns the created ConversationDataFile, or None if the database
    has no properties. Caller is responsible for committing the session.
    """
    db_block = await _get_db_or_404(database_id, user_id, session)
    schema = sorted(db_block.properties_schema or [], key=lambda p: p.get("position", 0))

    if not schema:
        return None

    # Build CSV in memory
    output = io.StringIO()
    writer = csv.writer(output)

    headers = [p["name"] for p in schema]
    prop_ids = [p["id"] for p in schema]
    writer.writerow(headers)

    sorted_rows = sorted(db_block.rows or [], key=lambda r: r.position)
    for row in sorted_rows:
        props = row.properties or {}
        row_values = [
            _resolve_cell_value(props.get(pid), schema[i]) for i, pid in enumerate(prop_ids)
        ]
        writer.writerow(row_values)

    csv_bytes = output.getvalue().encode("utf-8")

    # Save CSV to temp storage
    file_id = str(uuid.uuid4())
    temp_dir = os.path.join(tempfile.gettempdir(), "doxmind_data_files")
    os.makedirs(temp_dir, exist_ok=True)
    storage_path = os.path.join(temp_dir, f"{file_id}.csv")

    with open(storage_path, "wb") as f:
        f.write(csv_bytes)

    # Parse for preview metadata
    parser = get_data_parser_service()
    parse_result = await parser.parse_file(csv_bytes, f"{db_block.title}.csv", "text/csv")

    # Create ConversationDataFile record
    data_file = ConversationDataFile(
        id=file_id,
        conversation_id=conversation_id,
        original_filename=f"{db_block.title}.csv",
        file_type="csv",
        file_size=len(csv_bytes),
        mime_type="text/csv",
        storage_path=storage_path,
        preview_data=parse_result.get("preview_data"),
        column_names=parse_result.get("column_names"),
        row_count=parse_result.get("row_count", len(sorted_rows)),
        status="ready",
        source_database_id=database_id,
    )
    session.add(data_file)
    return data_file


@router.post("/{database_id}/send-to-chat")
async def send_database_to_chat(
    database_id: str,
    body: SendToChatRequest,
    token: TokenData = Depends(require_auth),
    session: AsyncSession = Depends(get_db),
):
    """Export a database as CSV and attach it as a data file for AI analysis.

    This creates a ConversationDataFile from the database's current rows,
    enabling the agent to analyze it via code execution (pandas).
    """
    user_id = get_user_id(token)

    # Resolve/create conversation for the editor file
    conversation = await get_conversation_by_file_id(
        body.file_id,
        session,
        create_if_missing=True,
        user_id=user_id,
    )
    if not conversation:
        raise HTTPException(status_code=404, detail="Could not resolve conversation")

    # Check if a data file already exists for this database in this conversation
    existing_result = await session.execute(
        select(ConversationDataFile).where(
            ConversationDataFile.conversation_id == conversation.id,
            ConversationDataFile.source_database_id == database_id,
        )
    )
    existing = existing_result.scalar_one_or_none()

    if existing:
        # Check staleness: re-export only if database was updated after data file creation
        db_block_result = await session.execute(
            select(DatabaseBlock.updated_at).where(DatabaseBlock.id == database_id)
        )
        db_updated_at = db_block_result.scalar_one_or_none()

        if db_updated_at and existing.created_at and db_updated_at <= existing.created_at:
            # Data file is still fresh — return it as-is
            await session.commit()
            return {
                "id": existing.id,
                "conversationId": conversation.id,
                "filename": existing.original_filename,
                "fileType": existing.file_type,
                "fileSize": existing.file_size,
                "mimeType": existing.mime_type,
                "status": existing.status,
                "previewData": existing.preview_data,
                "columnNames": existing.column_names,
                "rowCount": existing.row_count,
            }

        # Stale — delete old data file and re-export
        if existing.storage_path and os.path.exists(existing.storage_path):
            with contextlib.suppress(OSError):
                os.remove(existing.storage_path)
        await session.delete(existing)
        await session.flush()

    data_file = await export_database_to_data_file(database_id, conversation.id, user_id, session)
    if not data_file:
        raise HTTPException(status_code=400, detail="Database has no properties")

    await session.commit()

    return {
        "id": data_file.id,
        "conversationId": conversation.id,
        "filename": data_file.original_filename,
        "fileType": data_file.file_type,
        "fileSize": data_file.file_size,
        "mimeType": data_file.mime_type,
        "status": data_file.status,
        "previewData": data_file.preview_data,
        "columnNames": data_file.column_names,
        "rowCount": data_file.row_count,
    }


# =============================================================================
# View Management
# =============================================================================


@router.post("/{database_id}/views")
async def create_view(
    database_id: str,
    body: CreateViewRequest,
    token: TokenData = Depends(require_auth),
    session: AsyncSession = Depends(get_db),
):
    """Create a new view for the database."""
    user_id = get_user_id(token)
    db = await _get_db_or_404(database_id, user_id, session)

    max_pos = max((v.position for v in db.views), default=-1)
    view = DatabaseView(
        database_id=database_id,
        name=body.name,
        type=body.type,
        config=body.config or {},
        position=max_pos + 1,
    )
    session.add(view)
    await session.commit()

    db = await _get_db_or_404(database_id, user_id, session)
    return _db_to_dict(db)


@router.put("/{database_id}/views/{view_id}")
async def update_view(
    database_id: str,
    view_id: str,
    body: UpdateViewRequest,
    token: TokenData = Depends(require_auth),
    session: AsyncSession = Depends(get_db),
):
    """Update a view's name or config."""
    user_id = get_user_id(token)
    db = await _get_db_or_404(database_id, user_id, session)

    view = next((v for v in db.views if v.id == view_id), None)
    if not view:
        raise HTTPException(status_code=404, detail="View not found")

    if body.name is not None:
        view.name = body.name
    if body.config is not None:
        # Merge config to allow partial updates
        current = dict(view.config or {})
        current.update(body.config)
        view.config = current
    await session.commit()
    return _db_to_dict(db)


@router.delete("/{database_id}/views/{view_id}")
async def delete_view(
    database_id: str,
    view_id: str,
    token: TokenData = Depends(require_auth),
    session: AsyncSession = Depends(get_db),
):
    """Delete a view. Must keep at least one view."""
    user_id = get_user_id(token)
    db = await _get_db_or_404(database_id, user_id, session)

    if len(db.views) <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last view")

    view = next((v for v in db.views if v.id == view_id), None)
    if not view:
        raise HTTPException(status_code=404, detail="View not found")

    await session.delete(view)
    await session.commit()

    db = await _get_db_or_404(database_id, user_id, session)
    return _db_to_dict(db)
