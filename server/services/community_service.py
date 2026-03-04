"""Community service for discovery, publishing, forks, bookmarks, and recommendations."""

import hashlib
import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import and_, cast, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased
from sqlalchemy.types import Text

from db.database import (
    Bookmark,
    Comment,
    DocumentShare,
    File,
    Fork,
    ShareReaction,
    ShareView,
    User,
    UserFollow,
    utcnow,
)
from exceptions import BadRequestError, NotFoundError
from utils.html import strip_html_tags

logger = logging.getLogger(__name__)

ALLOWED_REACTION_EMOJIS = {"👍", "👎", "❤️", "🔥", "🎉", "😄", "🤔", "👀", "🚀", "💯"}
POSITIVE_REACTION_EMOJIS = {"👍", "❤️", "🔥", "🎉", "🚀", "💯"}


def _compute_preview(row, preview_chars: int = 300) -> tuple[str, int, int]:
    """Compute (content_preview, word_count, reading_time) from a query row.

    Expects row to have: is_folder, content_markdown_head, content_markdown_length,
    content_head, content_length.
    """
    if row.is_folder:
        return "", 0, 0

    if row.content_markdown_head:
        plain = row.content_markdown_head.strip()
        total_len = row.content_markdown_length or 0
    elif row.content_head:
        plain = strip_html_tags(row.content_head)
        total_len = row.content_length or 0
    else:
        return "", 0, 0

    preview = plain[:preview_chars] if plain else ""
    word_count = len(plain.split()) if plain else 0
    sample_len = min(len(plain), preview_chars + 50) if plain else 0
    if total_len > sample_len and word_count > 0 and sample_len > 0:
        word_count = int(word_count * (total_len / sample_len))
    reading_time = max(1, round(word_count / 200)) if word_count > 0 else 0
    return preview, word_count, reading_time


def _item_count_subquery():
    """Correlated subquery: count non-deleted children of the joined File row."""
    ChildFile = aliased(File, flat=True)
    return (
        select(func.count(ChildFile.id))
        .where(and_(ChildFile.parent_id == File.id, ChildFile.deleted_at.is_(None)))
        .correlate(File)
        .scalar_subquery()
        .label("item_count")
    )


class CommunityService:
    """Service for community features: publishing, discovery, forks, bookmarks."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def _fetch_folder_children(self, file_ids: list[str]) -> dict[str, list[dict]]:
        """Batch-fetch first 3 children (name, icon, is_folder) for folder items."""
        if not file_ids:
            return {}
        query = (
            select(File.parent_id, File.name, File.icon, File.is_folder)
            .where(File.parent_id.in_(file_ids), File.deleted_at.is_(None))
            .order_by(File.parent_id, File.is_folder.desc(), File.position.asc())
        )
        result = await self.db.execute(query)
        children_map: dict[str, list[dict]] = {}
        for row in result.all():
            pid = row.parent_id
            if pid not in children_map:
                children_map[pid] = []
            if len(children_map[pid]) < 3:
                children_map[pid].append(
                    {"name": row.name, "icon": row.icon, "is_folder": row.is_folder}
                )
        return children_map

    async def _attach_folder_children(self, items: list[dict]) -> None:
        """Attach child_previews to folder items and clean up _file_id."""
        folder_file_ids = [item["_file_id"] for item in items if item.get("_file_id")]
        children_map = await self._fetch_folder_children(folder_file_ids)
        for item in items:
            fid = item.pop("_file_id", None)
            if item["is_folder"]:
                item["child_previews"] = children_map.get(fid, [])
            else:
                item["child_previews"] = None

    # =========================================================================
    # Share Reactions
    # =========================================================================

    async def toggle_share_reaction(
        self, share_token: str, user_id: str, emoji: str
    ) -> tuple[bool, list[dict]]:
        """Toggle emoji reaction on a share. Returns (reacted, updated_reactions)."""
        if emoji not in ALLOWED_REACTION_EMOJIS:
            raise BadRequestError(message=f"Emoji '{emoji}' is not allowed")

        share = await self._resolve_share_by_token(share_token)
        if not share:
            raise NotFoundError(resource="Share", resource_id=share_token)

        existing = await self.db.execute(
            select(ShareReaction).where(
                ShareReaction.share_id == share.id,
                ShareReaction.user_id == user_id,
                ShareReaction.emoji == emoji,
            )
        )
        reaction = existing.scalar_one_or_none()

        if reaction:
            await self.db.delete(reaction)
            share.reaction_count = max(0, (share.reaction_count or 0) - 1)
            reacted = False
        else:
            self.db.add(ShareReaction(share_id=share.id, user_id=user_id, emoji=emoji))
            share.reaction_count = (share.reaction_count or 0) + 1
            reacted = True

        await self.db.commit()
        reactions = await self._get_reactions_for_share(share.id, user_id)
        return reacted, reactions

    async def _get_reactions_for_share(
        self, share_id: str, current_user_id: str | None = None
    ) -> list[dict]:
        """Get aggregated reactions for a share."""
        result = await self.db.execute(
            select(
                ShareReaction.emoji,
                func.count(ShareReaction.id).label("count"),
            )
            .where(ShareReaction.share_id == share_id)
            .group_by(ShareReaction.emoji)
        )
        rows = result.all()

        user_emojis: set[str] = set()
        if current_user_id:
            user_result = await self.db.execute(
                select(ShareReaction.emoji).where(
                    ShareReaction.share_id == share_id,
                    ShareReaction.user_id == current_user_id,
                )
            )
            user_emojis = {row[0] for row in user_result.all()}

        return [
            {
                "emoji": row.emoji,
                "count": row.count,
                "has_reacted": row.emoji in user_emojis,
            }
            for row in rows
        ]

    async def _attach_share_reactions(
        self, items: list[dict], current_user_id: str | None = None
    ) -> None:
        """Batch-attach reactions to listing items."""
        if not items:
            return

        share_ids = [item["share_id"] for item in items]

        # Aggregate counts per (share_id, emoji)
        agg_result = await self.db.execute(
            select(
                ShareReaction.share_id,
                ShareReaction.emoji,
                func.count(ShareReaction.id).label("count"),
            )
            .where(ShareReaction.share_id.in_(share_ids))
            .group_by(ShareReaction.share_id, ShareReaction.emoji)
        )
        agg_rows = agg_result.all()

        # Build map: share_id -> [{emoji, count}]
        reactions_map: dict[str, list[dict]] = {}
        for row in agg_rows:
            reactions_map.setdefault(row.share_id, []).append(
                {"emoji": row.emoji, "count": row.count, "has_reacted": False}
            )

        # Check current user's own reactions
        user_reacted: set[tuple[str, str]] = set()
        if current_user_id:
            user_result = await self.db.execute(
                select(ShareReaction.share_id, ShareReaction.emoji).where(
                    ShareReaction.share_id.in_(share_ids),
                    ShareReaction.user_id == current_user_id,
                )
            )
            user_reacted = {(row.share_id, row.emoji) for row in user_result.all()}

        for item in items:
            sid = item["share_id"]
            item_reactions = reactions_map.get(sid, [])
            if user_reacted:
                for r in item_reactions:
                    r["has_reacted"] = (sid, r["emoji"]) in user_reacted
            item["reactions"] = item_reactions

    # =========================================================================
    # Share Resolution
    # =========================================================================

    async def _resolve_share_by_token(self, share_token: str) -> DocumentShare | None:
        """Find active, non-expired share by token."""
        now = datetime.now(UTC)
        result = await self.db.execute(
            select(DocumentShare).where(
                and_(
                    DocumentShare.share_token == share_token,
                    DocumentShare.is_active == True,  # noqa: E712
                    or_(DocumentShare.expires_at.is_(None), DocumentShare.expires_at > now),
                )
            )
        )
        return result.scalar_one_or_none()

    # =========================================================================
    # Tags
    # =========================================================================

    async def get_popular_tags(self, limit: int = 20) -> list[dict]:
        """Get popular tags from published shares, sorted by usage count."""
        now = datetime.now(UTC)

        base_filter = and_(
            DocumentShare.is_published == True,  # noqa: E712
            DocumentShare.is_active == True,  # noqa: E712
            DocumentShare.visibility == "public",
            or_(DocumentShare.expires_at.is_(None), DocumentShare.expires_at > now),
            DocumentShare.tags.isnot(None),
        )

        result = await self.db.execute(select(DocumentShare.tags).where(base_filter))
        rows = result.all()

        # Aggregate tags in Python (works for both SQLite JSON and PostgreSQL JSON)
        tag_counts: dict[str, int] = {}
        for (tags,) in rows:
            if isinstance(tags, list):
                for tag in tags:
                    if tag:
                        tag_counts[tag] = tag_counts.get(tag, 0) + 1

        # Sort by count descending, then alphabetically
        sorted_tags = sorted(tag_counts.items(), key=lambda x: (-x[1], x[0]))[:limit]

        return [{"tag": tag, "count": count} for tag, count in sorted_tags]

    # =========================================================================
    # Discovery
    # =========================================================================

    async def discover(
        self,
        sort: str = "newest",
        tag: str | None = None,
        search: str | None = None,
        limit: int = 20,
        offset: int = 0,
        current_user_id: str | None = None,
    ) -> tuple[list[dict], int]:
        """Query published shares for discovery page."""
        now = datetime.now(UTC)

        # Base query: published, active, not expired, public visibility
        base_filter = and_(
            DocumentShare.is_published == True,  # noqa: E712
            DocumentShare.is_active == True,  # noqa: E712
            DocumentShare.visibility == "public",
            or_(DocumentShare.expires_at.is_(None), DocumentShare.expires_at > now),
        )

        # Count total (join File so search filter on File.name doesn't cause cross join)
        count_query = (
            select(func.count(DocumentShare.id))
            .join(File, DocumentShare.file_id == File.id)
            .where(base_filter)
        )

        # Build main query
        query = (
            select(
                DocumentShare.id,
                DocumentShare.share_token,
                DocumentShare.title,
                DocumentShare.description,
                DocumentShare.tags,
                DocumentShare.published_at,
                DocumentShare.updated_at,
                DocumentShare.view_count,
                DocumentShare.fork_count,
                DocumentShare.bookmark_count,
                DocumentShare.comment_count,
                DocumentShare.reaction_count,
                DocumentShare.allow_fork,
                DocumentShare.user_id,
                File.name.label("file_name"),
                File.is_folder,
                # Content preview fields
                func.safe_substr(File.content_markdown, 1, 350).label("content_markdown_head"),
                func.length(File.content_markdown).label("content_markdown_length"),
                func.safe_substr(File.content, 1, 1000).label("content_head"),
                func.length(File.content).label("content_length"),
                User.username.label("owner_name"),
                User.avatar_url.label("owner_avatar_url"),
                _item_count_subquery(),
                DocumentShare.file_id,
            )
            .join(File, DocumentShare.file_id == File.id)
            .join(User, DocumentShare.user_id == User.id)
            .where(base_filter)
        )

        # Apply search filter
        if search:
            search_filter = or_(
                DocumentShare.title.ilike(f"%{search}%"),
                DocumentShare.description.ilike(f"%{search}%"),
                File.name.ilike(f"%{search}%"),
            )
            query = query.where(search_filter)
            count_query = count_query.where(search_filter)

        # Apply tag filter
        if tag:
            # Cast JSON to text for LIKE since JSON type doesn't support contains
            tag_filter = cast(DocumentShare.tags, Text).like(f'%"{tag}"%')
            query = query.where(tag_filter)
            count_query = count_query.where(tag_filter)

        # Apply sort
        if sort == "popular":
            query = query.order_by(
                (
                    DocumentShare.view_count
                    + DocumentShare.fork_count * 5
                    + DocumentShare.bookmark_count * 3
                    + DocumentShare.comment_count * 2
                    + DocumentShare.reaction_count * 2
                ).desc(),
                DocumentShare.published_at.desc(),
            )
        elif sort == "most_viewed":
            query = query.order_by(
                DocumentShare.view_count.desc(), DocumentShare.published_at.desc()
            )
        else:  # newest
            query = query.order_by(DocumentShare.published_at.desc())

        # Paginate
        query = query.limit(limit).offset(offset)

        result = await self.db.execute(query)
        rows = result.all()

        count_result = await self.db.execute(count_query)
        total = count_result.scalar() or 0

        # Build response items
        items = []
        for row in rows:
            content_preview, word_count, reading_time = _compute_preview(row)
            item = {
                "share_id": row.id,
                "share_token": row.share_token,
                "title": row.title or row.file_name,
                "description": row.description,
                "tags": row.tags or [],
                "owner": {
                    "id": row.user_id,
                    "username": row.owner_name,
                    "avatar_url": row.owner_avatar_url,
                },
                "is_folder": row.is_folder,
                "view_count": row.view_count,
                "fork_count": row.fork_count,
                "allow_fork": row.allow_fork,
                "bookmark_count": row.bookmark_count,
                "comment_count": row.comment_count,
                "reaction_count": row.reaction_count,
                "published_at": row.published_at.isoformat() if row.published_at else "",
                "updated_at": row.updated_at.isoformat() if row.updated_at else "",
                "is_bookmarked": False,
                "is_forked": False,
                "content_preview": content_preview,
                "word_count": word_count,
                "reading_time": reading_time,
                "item_count": row.item_count if row.is_folder else None,
                "_file_id": row.file_id if row.is_folder else None,
            }
            items.append(item)

        # Batch-fetch folder children previews and reactions
        await self._attach_folder_children(items)
        await self._attach_share_reactions(items, current_user_id)

        # If user is logged in, check bookmark/fork status
        if current_user_id and items:
            share_ids = [item["share_id"] for item in items]

            # Check bookmarks
            bm_result = await self.db.execute(
                select(Bookmark.share_id).where(
                    Bookmark.user_id == current_user_id,
                    Bookmark.share_id.in_(share_ids),
                )
            )
            bookmarked_ids = {row[0] for row in bm_result.all()}

            # Check forks
            fk_result = await self.db.execute(
                select(Fork.source_share_id).where(
                    Fork.user_id == current_user_id,
                    Fork.source_share_id.in_(share_ids),
                )
            )
            forked_ids = {row[0] for row in fk_result.all()}

            for item in items:
                item["is_bookmarked"] = item["share_id"] in bookmarked_ids
                item["is_forked"] = item["share_id"] in forked_ids

        return items, total

    async def get_community_detail(
        self, share_token: str, current_user_id: str | None = None
    ) -> dict | None:
        """Get detailed community page for a share."""
        share = await self._resolve_share_by_token(share_token)
        if not share:
            return None
        # Allow access if published OR if visibility is public (backward compat)
        if not share.is_published and share.visibility != "public":
            return None

        # Load file and owner
        file_result = await self.db.execute(select(File).where(File.id == share.file_id))
        file = file_result.scalar_one_or_none()
        if not file:
            return None

        owner_result = await self.db.execute(select(User).where(User.id == share.user_id))
        owner = owner_result.scalar_one_or_none()

        detail = {
            "share_id": share.id,
            "share_token": share.share_token,
            "title": share.title or file.name,
            "description": share.description,
            "tags": share.tags or [],
            "owner": {
                "id": owner.id if owner else None,
                "username": owner.username if owner else None,
                "avatar_url": owner.avatar_url if owner else None,
                "bio": owner.bio if owner else None,
            },
            "is_folder": file.is_folder,
            "view_count": share.view_count,
            "fork_count": share.fork_count,
            "allow_fork": share.allow_fork,
            "bookmark_count": share.bookmark_count,
            "comment_count": share.comment_count,
            "published_at": share.published_at.isoformat() if share.published_at else "",
            "is_bookmarked": False,
            "is_forked": False,
            "fork_id": None,
        }

        if current_user_id:
            bm = await self.db.execute(
                select(Bookmark.id).where(
                    Bookmark.user_id == current_user_id, Bookmark.share_id == share.id
                )
            )
            detail["is_bookmarked"] = bm.scalar_one_or_none() is not None

            fk = await self.db.execute(
                select(Fork).where(
                    Fork.user_id == current_user_id, Fork.source_share_id == share.id
                )
            )
            fork = fk.scalar_one_or_none()
            if fork:
                detail["is_forked"] = True
                detail["fork_id"] = fork.id

        # Attach reactions
        detail["reactions"] = await self._get_reactions_for_share(share.id, current_user_id)

        return detail

    # =========================================================================
    # Publishing
    # =========================================================================

    async def publish_share(
        self,
        share_id: str,
        user_id: str,
        title: str | None = None,
        description: str | None = None,
        tags: list[str] | None = None,
    ) -> DocumentShare:
        """Publish a share to the community."""
        result = await self.db.execute(
            select(DocumentShare).where(
                DocumentShare.id == share_id, DocumentShare.user_id == user_id
            )
        )
        share = result.scalar_one_or_none()
        if not share:
            raise NotFoundError(resource="Share", resource_id=share_id)

        if not share.is_active:
            raise BadRequestError(message="Cannot publish an inactive share")

        # Get file name as default title
        if not title:
            file_result = await self.db.execute(select(File.name).where(File.id == share.file_id))
            title = file_result.scalar_one_or_none() or "Untitled"

        # Normalize tags
        normalized_tags = None
        if tags:
            normalized_tags = list(dict.fromkeys(t.strip().lower() for t in tags if t.strip()))
            normalized_tags = normalized_tags[:10] if normalized_tags else None

        share.is_published = True
        share.visibility = "public"
        share.title = title
        share.description = description
        share.tags = normalized_tags
        if not share.published_at:
            share.published_at = utcnow()

        await self.db.commit()
        await self.db.refresh(share)

        return share

    async def unpublish_share(self, share_id: str, user_id: str) -> DocumentShare:
        """Remove a share from the community."""
        result = await self.db.execute(
            select(DocumentShare).where(
                DocumentShare.id == share_id, DocumentShare.user_id == user_id
            )
        )
        share = result.scalar_one_or_none()
        if not share:
            raise NotFoundError(resource="Share", resource_id=share_id)

        share.is_published = False
        share.visibility = "private"
        await self.db.commit()
        await self.db.refresh(share)

        return share

    async def update_share_metadata(
        self,
        share_id: str,
        user_id: str,
        title: str | None = None,
        description: str | None = None,
        tags: list[str] | None = None,
        allow_fork: bool | None = None,
    ) -> DocumentShare:
        """Update metadata (title, description, tags, allow_fork) on a published share."""
        result = await self.db.execute(
            select(DocumentShare).where(
                DocumentShare.id == share_id, DocumentShare.user_id == user_id
            )
        )
        share = result.scalar_one_or_none()
        if not share:
            raise NotFoundError(resource="Share", resource_id=share_id)

        if not share.is_active:
            raise BadRequestError(message="Cannot update metadata on an inactive share")

        # Title/description/tags require published share (community metadata)
        has_community_fields = any(v is not None for v in [title, description, tags])
        if has_community_fields and not share.is_published:
            raise BadRequestError(message="Cannot update metadata on an unpublished share")

        if title is not None:
            share.title = title
        if description is not None:
            share.description = description
        if tags is not None:
            normalized_tags = list(dict.fromkeys(t.strip().lower() for t in tags if t.strip()))
            share.tags = normalized_tags[:10] if normalized_tags else None
        if allow_fork is not None:
            share.allow_fork = allow_fork

        await self.db.commit()
        await self.db.refresh(share)

        return share

    # =========================================================================
    # Forks
    # =========================================================================

    async def fork_share(
        self,
        share_token: str,
        user_id: str,
        target_folder_id: str | None = None,
    ) -> tuple[Fork, File]:
        """Fork a shared document/folder to user's space."""
        share = await self._resolve_share_by_token(share_token)
        if not share:
            raise NotFoundError(resource="Share", message="Share not found or expired")

        # Check if forking is allowed
        if not share.allow_fork:
            raise BadRequestError(message="The owner has disabled forking for this document")

        # Prevent self-fork
        if share.user_id == user_id:
            raise BadRequestError(message="Cannot fork your own document")

        # Check if already forked
        existing = await self.db.execute(
            select(Fork).where(Fork.user_id == user_id, Fork.source_share_id == share.id)
        )
        if existing.scalar_one_or_none():
            raise BadRequestError(message="You have already forked this document")

        # Load source file
        source_result = await self.db.execute(select(File).where(File.id == share.file_id))
        source_file = source_result.scalar_one_or_none()
        if not source_file:
            raise NotFoundError(resource="File", message="Source document not found")

        # Deep copy the file tree
        new_file = await self._deep_copy_file_tree(source_file, user_id, target_folder_id)

        logger.info(
            "Fork: created file %s for user %s (source: %s, parent: %s)",
            new_file.id,
            user_id,
            source_file.id,
            target_folder_id,
        )

        # Create fork record
        content_hash = source_file.content_hash or self._hash_content(source_file.content or "")
        fork = Fork(
            source_share_id=share.id,
            source_file_id=source_file.id,
            user_id=user_id,
            forked_file_id=new_file.id,
            source_content_hash=content_hash,
            last_synced_at=utcnow(),
        )
        self.db.add(fork)

        # Increment fork count atomically
        await self._update_denormalized_count(share.id, "fork_count", 1)

        await self.db.commit()
        await self.db.refresh(fork)
        await self.db.refresh(new_file)

        return fork, new_file

    async def sync_fork(
        self,
        fork_id: str,
        user_id: str,
        force: bool = False,
        create_backup: bool = False,
    ) -> dict:
        """Sync fork with the latest source content.

        Returns a dict with keys:
          - status: "up_to_date" | "synced" | "conflict" | "error"
          - message: human-readable message
          - has_local_changes: bool (only when status == "conflict")
          - backup_file_id: str | None (when a backup was created)
        """
        result = await self.db.execute(
            select(Fork).where(Fork.id == fork_id, Fork.user_id == user_id)
        )
        fork = result.scalar_one_or_none()
        if not fork:
            raise NotFoundError(resource="Fork", resource_id=fork_id)

        # Check source still exists
        if not fork.source_file_id:
            return {"status": "error", "message": "Source document no longer exists"}

        source_result = await self.db.execute(select(File).where(File.id == fork.source_file_id))
        source_file = source_result.scalar_one_or_none()
        if not source_file:
            return {"status": "error", "message": "Source document has been deleted"}

        # Check if source is still shared
        if fork.source_share_id:
            share_result = await self.db.execute(
                select(DocumentShare.is_active).where(DocumentShare.id == fork.source_share_id)
            )
            is_active = share_result.scalar_one_or_none()
            if not is_active:
                return {"status": "error", "message": "Source share has been revoked"}

        # Load forked file
        forked_result = await self.db.execute(select(File).where(File.id == fork.forked_file_id))
        forked_file = forked_result.scalar_one_or_none()
        if not forked_file:
            return {"status": "error", "message": "Forked file not found"}

        # Check if source has changed since last sync
        source_hash = source_file.content_hash or self._hash_content(source_file.content or "")
        if source_hash == fork.source_content_hash:
            return {"status": "up_to_date", "message": "Already up to date"}

        # Check if the user has made local modifications.
        # At fork/sync time, forked_file.content == source_file.content at that point,
        # so source_content_hash also represents the forked file's content at last sync.
        forked_hash = self._hash_content(forked_file.content or "")
        has_local_changes = forked_hash != fork.source_content_hash

        # If local changes exist and not forcing, return conflict
        if has_local_changes and not force:
            return {
                "status": "conflict",
                "message": "You have local changes that will be overwritten",
                "has_local_changes": True,
            }

        # Create backup if requested (before overwriting)
        backup_file_id = None
        if create_backup and has_local_changes:
            backup_file = File(
                id=str(uuid.uuid4()),
                name=f"{forked_file.name} (backup before sync)",
                content=forked_file.content,
                content_hash=forked_hash,
                user_id=forked_file.user_id,
                parent_id=forked_file.parent_id,
                is_folder=False,
            )
            self.db.add(backup_file)
            backup_file_id = backup_file.id

        # Perform sync: overwrite forked file with source content
        forked_file.content = source_file.content
        forked_file.content_hash = source_hash
        forked_file.updated_at = utcnow()
        fork.source_content_hash = source_hash
        fork.last_synced_at = utcnow()

        await self.db.commit()
        return {
            "status": "synced",
            "message": "Synced successfully",
            "backup_file_id": backup_file_id,
        }

    async def list_user_forks(self, user_id: str, limit: int = 50, offset: int = 0) -> list[dict]:
        """List forks belonging to a user."""
        query = (
            select(
                Fork.id,
                Fork.source_share_id,
                Fork.source_file_id,
                Fork.forked_file_id,
                Fork.last_synced_at,
                Fork.created_at,
                File.name.label("forked_file_name"),
                DocumentShare.title.label("source_title"),
                User.username.label("source_author"),
            )
            .join(File, Fork.forked_file_id == File.id)
            .outerjoin(DocumentShare, Fork.source_share_id == DocumentShare.id)
            .outerjoin(User, DocumentShare.user_id == User.id)
            .where(Fork.user_id == user_id)
            .order_by(Fork.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        result = await self.db.execute(query)
        rows = result.all()

        return [
            {
                "id": row.id,
                "source_share_id": row.source_share_id,
                "source_file_id": row.source_file_id,
                "forked_file_id": row.forked_file_id,
                "forked_file_name": row.forked_file_name,
                "source_title": row.source_title,
                "source_author": row.source_author,
                "last_synced_at": row.last_synced_at.isoformat() if row.last_synced_at else None,
                "created_at": row.created_at.isoformat() if row.created_at else "",
            }
            for row in rows
        ]

    async def delete_fork(self, fork_id: str, user_id: str) -> None:
        """Delete a fork record. Only the fork owner can delete it."""
        result = await self.db.execute(
            select(Fork).where(Fork.id == fork_id, Fork.user_id == user_id)
        )
        fork = result.scalar_one_or_none()
        if not fork:
            raise NotFoundError(resource="Fork", message="Fork not found")

        # Decrement fork_count on the source share
        if fork.source_share_id:
            await self._update_denormalized_count(fork.source_share_id, "fork_count", -1)

        await self.db.delete(fork)
        await self.db.commit()

    # =========================================================================
    # Bookmarks
    # =========================================================================

    async def toggle_bookmark(self, share_token: str, user_id: str) -> tuple[bool, int]:
        """Toggle bookmark, return (is_bookmarked, new_count)."""
        share = await self._resolve_share_by_token(share_token)
        if not share:
            raise NotFoundError(resource="Share", message="Share not found or expired")

        # Check if bookmark exists
        existing = await self.db.execute(
            select(Bookmark).where(Bookmark.user_id == user_id, Bookmark.share_id == share.id)
        )
        bookmark = existing.scalar_one_or_none()

        if bookmark:
            # Remove bookmark
            await self.db.delete(bookmark)
            new_count = await self._update_denormalized_count(share.id, "bookmark_count", -1)
            await self.db.commit()
            return False, new_count
        else:
            # Add bookmark
            new_bookmark = Bookmark(user_id=user_id, share_id=share.id)
            self.db.add(new_bookmark)
            new_count = await self._update_denormalized_count(share.id, "bookmark_count", 1)
            await self.db.commit()
            return True, new_count

    async def list_user_bookmarks(
        self, user_id: str, limit: int = 50, offset: int = 0
    ) -> tuple[list[dict], int]:
        """List bookmarks belonging to a user."""
        now = datetime.now(UTC)

        base_filter = and_(
            Bookmark.user_id == user_id,
            DocumentShare.is_active == True,  # noqa: E712
            or_(DocumentShare.expires_at.is_(None), DocumentShare.expires_at > now),
        )

        count_result = await self.db.execute(
            select(func.count(Bookmark.id))
            .join(DocumentShare, Bookmark.share_id == DocumentShare.id)
            .where(base_filter)
        )
        total = count_result.scalar() or 0

        query = (
            select(
                Bookmark.id.label("bookmark_id"),
                Bookmark.created_at.label("bookmarked_at"),
                DocumentShare.id.label("share_id"),
                DocumentShare.share_token,
                DocumentShare.title,
                DocumentShare.description,
                DocumentShare.tags,
                DocumentShare.view_count,
                DocumentShare.fork_count,
                DocumentShare.bookmark_count,
                DocumentShare.comment_count,
                DocumentShare.reaction_count,
                DocumentShare.allow_fork,
                DocumentShare.published_at,
                File.name.label("file_name"),
                File.is_folder,
                User.id.label("owner_id"),
                User.username.label("owner_name"),
                User.avatar_url.label("owner_avatar_url"),
            )
            .join(DocumentShare, Bookmark.share_id == DocumentShare.id)
            .join(File, DocumentShare.file_id == File.id)
            .join(User, DocumentShare.user_id == User.id)
            .where(base_filter)
            .order_by(Bookmark.created_at.desc())
            .limit(limit)
            .offset(offset)
        )

        result = await self.db.execute(query)
        rows = result.all()

        items = [
            {
                "bookmark_id": row.bookmark_id,
                "share_id": row.share_id,
                "share_token": row.share_token,
                "title": row.title or row.file_name,
                "description": row.description,
                "tags": row.tags or [],
                "owner": {
                    "id": row.owner_id,
                    "username": row.owner_name,
                    "avatar_url": row.owner_avatar_url,
                },
                "is_folder": row.is_folder,
                "view_count": row.view_count,
                "fork_count": row.fork_count,
                "allow_fork": row.allow_fork,
                "bookmark_count": row.bookmark_count,
                "comment_count": row.comment_count,
                "reaction_count": row.reaction_count,
                "published_at": row.published_at.isoformat() if row.published_at else "",
                "bookmarked_at": row.bookmarked_at.isoformat() if row.bookmarked_at else "",
                "is_bookmarked": True,
            }
            for row in rows
        ]

        return items, total

    # =========================================================================
    # User Follows
    # =========================================================================

    async def toggle_follow(self, follower_id: str, following_id: str) -> tuple[bool, int]:
        """Toggle follow relationship. Returns (is_following, new_follower_count)."""
        if follower_id == following_id:
            raise BadRequestError(message="Cannot follow yourself")

        # Verify target user exists
        target = await self.db.execute(select(User).where(User.id == following_id))
        target_user = target.scalar_one_or_none()
        if not target_user:
            raise NotFoundError(resource="User", resource_id=following_id)

        existing = await self.db.execute(
            select(UserFollow).where(
                UserFollow.follower_id == follower_id,
                UserFollow.following_id == following_id,
            )
        )
        follow = existing.scalar_one_or_none()

        if follow:
            # Unfollow
            await self.db.delete(follow)
            await self.db.execute(
                update(User)
                .where(User.id == following_id)
                .values(follower_count=func.greatest(User.follower_count - 1, 0))
            )
            await self.db.execute(
                update(User)
                .where(User.id == follower_id)
                .values(following_count=func.greatest(User.following_count - 1, 0))
            )
            await self.db.commit()

            # Refetch count
            result = await self.db.execute(
                select(User.follower_count).where(User.id == following_id)
            )
            count = result.scalar() or 0
            return False, count
        else:
            # Follow
            self.db.add(UserFollow(follower_id=follower_id, following_id=following_id))
            await self.db.execute(
                update(User)
                .where(User.id == following_id)
                .values(follower_count=User.follower_count + 1)
            )
            await self.db.execute(
                update(User)
                .where(User.id == follower_id)
                .values(following_count=User.following_count + 1)
            )
            await self.db.commit()

            result = await self.db.execute(
                select(User.follower_count).where(User.id == following_id)
            )
            count = result.scalar() or 0
            return True, count

    async def is_following(self, follower_id: str, following_id: str) -> bool:
        """Check if follower_id follows following_id."""
        result = await self.db.execute(
            select(UserFollow.id).where(
                UserFollow.follower_id == follower_id,
                UserFollow.following_id == following_id,
            )
        )
        return result.scalar_one_or_none() is not None

    async def get_followed_user_ids(self, user_id: str) -> list[str]:
        """Get all user IDs that user_id is following."""
        result = await self.db.execute(
            select(UserFollow.following_id).where(UserFollow.follower_id == user_id)
        )
        return [row[0] for row in result.all()]

    async def get_followers(
        self,
        user_id: str,
        limit: int = 20,
        offset: int = 0,
        viewer_id: str | None = None,
    ) -> tuple[list[dict], int]:
        """Get paginated list of a user's followers."""
        # Count total
        count_result = await self.db.execute(
            select(func.count(UserFollow.id)).where(UserFollow.following_id == user_id)
        )
        total = count_result.scalar() or 0

        # Fetch followers
        result = await self.db.execute(
            select(
                User.id,
                User.username,
                User.avatar_url,
                User.bio,
                UserFollow.created_at.label("followed_at"),
            )
            .join(UserFollow, UserFollow.follower_id == User.id)
            .where(UserFollow.following_id == user_id)
            .order_by(UserFollow.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        rows = result.all()

        # Check if viewer is following each of these users
        viewer_following_ids: set[str] = set()
        if viewer_id and rows:
            user_ids = [row.id for row in rows]
            vf_result = await self.db.execute(
                select(UserFollow.following_id).where(
                    UserFollow.follower_id == viewer_id,
                    UserFollow.following_id.in_(user_ids),
                )
            )
            viewer_following_ids = {r[0] for r in vf_result.all()}

        users = [
            {
                "id": row.id,
                "username": row.username,
                "avatar_url": row.avatar_url,
                "bio": row.bio,
                "is_following": row.id in viewer_following_ids,
            }
            for row in rows
        ]

        return users, total

    async def get_following(
        self,
        user_id: str,
        limit: int = 20,
        offset: int = 0,
        viewer_id: str | None = None,
    ) -> tuple[list[dict], int]:
        """Get paginated list of users that user_id is following."""
        count_result = await self.db.execute(
            select(func.count(UserFollow.id)).where(UserFollow.follower_id == user_id)
        )
        total = count_result.scalar() or 0

        result = await self.db.execute(
            select(
                User.id,
                User.username,
                User.avatar_url,
                User.bio,
                UserFollow.created_at.label("followed_at"),
            )
            .join(UserFollow, UserFollow.following_id == User.id)
            .where(UserFollow.follower_id == user_id)
            .order_by(UserFollow.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        rows = result.all()

        viewer_following_ids: set[str] = set()
        if viewer_id and rows:
            user_ids = [row.id for row in rows]
            vf_result = await self.db.execute(
                select(UserFollow.following_id).where(
                    UserFollow.follower_id == viewer_id,
                    UserFollow.following_id.in_(user_ids),
                )
            )
            viewer_following_ids = {r[0] for r in vf_result.all()}

        users = [
            {
                "id": row.id,
                "username": row.username,
                "avatar_url": row.avatar_url,
                "bio": row.bio,
                "is_following": row.id in viewer_following_ids,
            }
            for row in rows
        ]

        return users, total

    # =========================================================================
    # User Profile
    # =========================================================================

    async def get_public_profile(self, user_id: str, viewer_id: str | None = None) -> dict | None:
        """Get user's public profile with stats and follow info."""
        result = await self.db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user:
            return None

        # Count published shares
        published_count = await self.db.execute(
            select(func.count(DocumentShare.id)).where(
                DocumentShare.user_id == user_id,
                DocumentShare.is_published == True,  # noqa: E712
                DocumentShare.is_active == True,  # noqa: E712
            )
        )

        # Sum fork count across published shares
        forks_received = await self.db.execute(
            select(func.coalesce(func.sum(DocumentShare.fork_count), 0)).where(
                DocumentShare.user_id == user_id,
                DocumentShare.is_published == True,  # noqa: E712
            )
        )

        # Sum bookmark count
        bookmarks_received = await self.db.execute(
            select(func.coalesce(func.sum(DocumentShare.bookmark_count), 0)).where(
                DocumentShare.user_id == user_id,
                DocumentShare.is_published == True,  # noqa: E712
            )
        )

        # Sum view count
        views_total = await self.db.execute(
            select(func.coalesce(func.sum(DocumentShare.view_count), 0)).where(
                DocumentShare.user_id == user_id,
                DocumentShare.is_published == True,  # noqa: E712
            )
        )

        # Check if viewer is following this user
        is_following = False
        if viewer_id and viewer_id != user_id:
            is_following = await self.is_following(viewer_id, user_id)

        return {
            "id": user.id,
            "username": user.username,
            "avatar_url": user.avatar_url,
            "bio": user.bio,
            "website": user.website,
            "social_links": user.social_links,
            "created_at": user.created_at.isoformat() if user.created_at else "",
            "is_following": is_following,
            "stats": {
                "total_published": published_count.scalar() or 0,
                "total_views": views_total.scalar() or 0,
                "total_forks_received": forks_received.scalar() or 0,
                "total_bookmarks_received": bookmarks_received.scalar() or 0,
                "followers": user.follower_count,
                "following": user.following_count,
            },
        }

    async def get_user_published(
        self,
        user_id: str,
        limit: int = 20,
        offset: int = 0,
        sort: str = "newest",
    ) -> tuple[list[dict], int]:
        """Get user's published shares."""
        now = datetime.now(UTC)

        base_filter = and_(
            DocumentShare.user_id == user_id,
            DocumentShare.is_published == True,  # noqa: E712
            DocumentShare.is_active == True,  # noqa: E712
            or_(DocumentShare.expires_at.is_(None), DocumentShare.expires_at > now),
        )

        count_result = await self.db.execute(
            select(func.count(DocumentShare.id)).where(base_filter)
        )
        total = count_result.scalar() or 0

        query = (
            select(
                DocumentShare.id,
                DocumentShare.share_token,
                DocumentShare.title,
                DocumentShare.description,
                DocumentShare.tags,
                DocumentShare.published_at,
                DocumentShare.updated_at,
                DocumentShare.view_count,
                DocumentShare.fork_count,
                DocumentShare.bookmark_count,
                DocumentShare.comment_count,
                DocumentShare.reaction_count,
                DocumentShare.allow_fork,
                DocumentShare.user_id,
                File.name.label("file_name"),
                File.is_folder,
                # Content preview fields
                func.safe_substr(File.content_markdown, 1, 350).label("content_markdown_head"),
                func.length(File.content_markdown).label("content_markdown_length"),
                func.safe_substr(File.content, 1, 1000).label("content_head"),
                func.length(File.content).label("content_length"),
                User.username.label("owner_name"),
                User.avatar_url.label("owner_avatar_url"),
                _item_count_subquery(),
                DocumentShare.file_id,
            )
            .join(File, DocumentShare.file_id == File.id)
            .join(User, DocumentShare.user_id == User.id)
            .where(base_filter)
        )

        if sort == "popular":
            query = query.order_by((DocumentShare.fork_count + DocumentShare.bookmark_count).desc())
        else:
            query = query.order_by(DocumentShare.published_at.desc())

        query = query.limit(limit).offset(offset)
        result = await self.db.execute(query)
        rows = result.all()

        items = []
        for row in rows:
            content_preview, word_count, reading_time = _compute_preview(row)
            items.append(
                {
                    "share_id": row.id,
                    "share_token": row.share_token,
                    "title": row.title or row.file_name,
                    "description": row.description,
                    "tags": row.tags or [],
                    "owner": {
                        "id": row.user_id,
                        "username": row.owner_name,
                        "avatar_url": row.owner_avatar_url,
                    },
                    "is_folder": row.is_folder,
                    "view_count": row.view_count,
                    "fork_count": row.fork_count,
                    "allow_fork": row.allow_fork,
                    "bookmark_count": row.bookmark_count,
                    "comment_count": row.comment_count,
                    "reaction_count": row.reaction_count,
                    "published_at": row.published_at.isoformat() if row.published_at else "",
                    "updated_at": row.updated_at.isoformat() if row.updated_at else "",
                    "is_bookmarked": False,
                    "is_forked": False,
                    "content_preview": content_preview,
                    "word_count": word_count,
                    "reading_time": reading_time,
                    "item_count": row.item_count if row.is_folder else None,
                    "_file_id": row.file_id if row.is_folder else None,
                }
            )

        # Batch-fetch folder children previews and reactions
        await self._attach_folder_children(items)
        await self._attach_share_reactions(items, user_id)

        return items, total

    # =========================================================================
    # Following Feed
    # =========================================================================

    async def get_following_feed(
        self,
        user_id: str,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[dict], int]:
        """Get publications from users that the current user follows."""
        followed_ids = await self.get_followed_user_ids(user_id)
        if not followed_ids:
            return [], 0

        now = datetime.now(UTC)
        base_filter = and_(
            DocumentShare.user_id.in_(followed_ids),
            DocumentShare.is_published == True,  # noqa: E712
            DocumentShare.is_active == True,  # noqa: E712
            DocumentShare.visibility == "public",
            or_(DocumentShare.expires_at.is_(None), DocumentShare.expires_at > now),
        )

        count_result = await self.db.execute(
            select(func.count(DocumentShare.id)).where(base_filter)
        )
        total = count_result.scalar() or 0

        query = (
            select(
                DocumentShare.id,
                DocumentShare.share_token,
                DocumentShare.title,
                DocumentShare.description,
                DocumentShare.tags,
                DocumentShare.published_at,
                DocumentShare.updated_at,
                DocumentShare.view_count,
                DocumentShare.fork_count,
                DocumentShare.bookmark_count,
                DocumentShare.comment_count,
                DocumentShare.reaction_count,
                DocumentShare.allow_fork,
                DocumentShare.user_id,
                File.name.label("file_name"),
                File.is_folder,
                func.safe_substr(File.content_markdown, 1, 350).label("content_markdown_head"),
                func.length(File.content_markdown).label("content_markdown_length"),
                func.safe_substr(File.content, 1, 1000).label("content_head"),
                func.length(File.content).label("content_length"),
                User.username.label("owner_name"),
                User.avatar_url.label("owner_avatar_url"),
                _item_count_subquery(),
                DocumentShare.file_id,
            )
            .join(File, DocumentShare.file_id == File.id)
            .join(User, DocumentShare.user_id == User.id)
            .where(base_filter)
            .order_by(DocumentShare.published_at.desc())
            .limit(limit)
            .offset(offset)
        )

        result = await self.db.execute(query)
        rows = result.all()

        items = []
        for row in rows:
            content_preview, word_count, reading_time = _compute_preview(row)
            items.append(
                {
                    "share_id": row.id,
                    "share_token": row.share_token,
                    "title": row.title or row.file_name,
                    "description": row.description,
                    "tags": row.tags or [],
                    "owner": {
                        "id": row.user_id,
                        "username": row.owner_name,
                        "avatar_url": row.owner_avatar_url,
                    },
                    "is_folder": row.is_folder,
                    "view_count": row.view_count,
                    "fork_count": row.fork_count,
                    "allow_fork": row.allow_fork,
                    "bookmark_count": row.bookmark_count,
                    "comment_count": row.comment_count,
                    "reaction_count": row.reaction_count,
                    "published_at": row.published_at.isoformat() if row.published_at else "",
                    "updated_at": row.updated_at.isoformat() if row.updated_at else "",
                    "is_bookmarked": False,
                    "is_forked": False,
                    "content_preview": content_preview,
                    "word_count": word_count,
                    "reading_time": reading_time,
                    "item_count": row.item_count if row.is_folder else None,
                    "_file_id": row.file_id if row.is_folder else None,
                }
            )

        # Batch-fetch folder children previews and reactions
        await self._attach_folder_children(items)
        await self._attach_share_reactions(items, user_id)

        # Annotate bookmark/fork status
        if items:
            share_ids = [item["share_id"] for item in items]
            bm_result = await self.db.execute(
                select(Bookmark.share_id).where(
                    Bookmark.user_id == user_id,
                    Bookmark.share_id.in_(share_ids),
                )
            )
            bookmarked_ids = {row[0] for row in bm_result.all()}

            fk_result = await self.db.execute(
                select(Fork.source_share_id).where(
                    Fork.user_id == user_id,
                    Fork.source_share_id.in_(share_ids),
                )
            )
            forked_ids = {row[0] for row in fk_result.all()}

            for item in items:
                item["is_bookmarked"] = item["share_id"] in bookmarked_ids
                item["is_forked"] = item["share_id"] in forked_ids

        return items, total

    # =========================================================================
    # Recommendations
    # =========================================================================

    async def get_user_interest_tags(self, user_id: str) -> dict[str, float]:
        """Collect interest tags from user interactions, weighted by signal strength.

        Signal weights:
        - Bookmarks: 3.0 (intentional save = strong signal)
        - Forks: 3.0 (copied to own space = strong signal)
        - Comments: 2.5 (engagement via writing = strong signal)
        - Positive reactions: 2.0 (explicit approval = moderate signal)
        - Own published shares: 2.0 (content creation = moderate signal)
        - Views: 1.0 (passive consumption = weak signal, last 90 days only)
        """
        from datetime import timedelta

        tag_weights: dict[str, float] = {}

        def _accumulate(tags_list, weight: float):
            if isinstance(tags_list, list):
                for tag in tags_list:
                    if tag:
                        tag_weights[tag] = tag_weights.get(tag, 0.0) + weight

        # 1. From bookmarks (weight: 3.0)
        bm_result = await self.db.execute(
            select(DocumentShare.tags)
            .join(Bookmark, Bookmark.share_id == DocumentShare.id)
            .where(Bookmark.user_id == user_id, DocumentShare.tags.isnot(None))
        )
        for (tags,) in bm_result.all():
            _accumulate(tags, 3.0)

        # 2. From forks (weight: 3.0)
        fk_result = await self.db.execute(
            select(DocumentShare.tags)
            .join(Fork, Fork.source_share_id == DocumentShare.id)
            .where(Fork.user_id == user_id, DocumentShare.tags.isnot(None))
        )
        for (tags,) in fk_result.all():
            _accumulate(tags, 3.0)

        # 3. From commented shares (weight: 2.5)
        # Use distinct on share_id to avoid duplicate tags from multiple comments on same share
        comment_share_ids_result = await self.db.execute(
            select(Comment.share_id)
            .where(
                Comment.user_id == user_id,
                Comment.is_deleted == False,  # noqa: E712
            )
            .distinct()
        )
        commented_share_ids = [row[0] for row in comment_share_ids_result.all()]
        if commented_share_ids:
            comment_result = await self.db.execute(
                select(DocumentShare.tags).where(
                    DocumentShare.id.in_(commented_share_ids),
                    DocumentShare.tags.isnot(None),
                )
            )
            for (tags,) in comment_result.all():
                _accumulate(tags, 2.5)

        # 4. From positive reactions (weight: 2.0)
        react_result = await self.db.execute(
            select(DocumentShare.tags)
            .join(ShareReaction, ShareReaction.share_id == DocumentShare.id)
            .where(
                ShareReaction.user_id == user_id,
                ShareReaction.emoji.in_(POSITIVE_REACTION_EMOJIS),
                DocumentShare.tags.isnot(None),
            )
        )
        for (tags,) in react_result.all():
            _accumulate(tags, 2.0)

        # 5. From own published shares (weight: 2.0)
        own_result = await self.db.execute(
            select(DocumentShare.tags).where(
                DocumentShare.user_id == user_id,
                DocumentShare.is_published == True,  # noqa: E712
                DocumentShare.tags.isnot(None),
            )
        )
        for (tags,) in own_result.all():
            _accumulate(tags, 2.0)

        # 6. From viewed shares (weight: 1.0, last 90 days only)
        view_cutoff = datetime.now(UTC) - timedelta(days=90)
        view_result = await self.db.execute(
            select(DocumentShare.tags)
            .join(ShareView, ShareView.share_id == DocumentShare.id)
            .where(
                ShareView.user_id == user_id,
                ShareView.created_at >= view_cutoff,
                DocumentShare.tags.isnot(None),
            )
        )
        for (tags,) in view_result.all():
            _accumulate(tags, 1.0)

        return tag_weights

    async def _recommend_by_tags(
        self, user_id: str, interest_tags: dict[str, float], limit: int = 50
    ) -> list[tuple[str, float]]:
        """Find shares matching user's interest tags, scored by overlap count.

        Returns list of (share_id, score) sorted by score descending.
        """
        if not interest_tags:
            return []

        now = datetime.now(UTC)
        base_filter = and_(
            DocumentShare.is_published == True,  # noqa: E712
            DocumentShare.is_active == True,  # noqa: E712
            DocumentShare.visibility == "public",
            DocumentShare.user_id != user_id,
            or_(DocumentShare.expires_at.is_(None), DocumentShare.expires_at > now),
            DocumentShare.tags.isnot(None),
        )

        result = await self.db.execute(
            select(DocumentShare.id, DocumentShare.tags).where(base_filter)
        )
        rows = result.all()

        scored: list[tuple[str, float]] = []
        for share_id, tags in rows:
            if not isinstance(tags, list):
                continue
            score = sum(interest_tags.get(tag, 0) for tag in tags)
            if score > 0:
                scored.append((share_id, float(score)))

        scored.sort(key=lambda x: -x[1])
        return scored[:limit]

    async def _recommend_by_follows(self, user_id: str, limit: int = 30) -> list[tuple[str, float]]:
        """Get recent publications from followed users, scored by recency."""
        followed_ids = await self.get_followed_user_ids(user_id)
        if not followed_ids:
            return []

        now = datetime.now(UTC)
        base_filter = and_(
            DocumentShare.is_published == True,  # noqa: E712
            DocumentShare.is_active == True,  # noqa: E712
            DocumentShare.visibility == "public",
            DocumentShare.user_id.in_(followed_ids),
            or_(DocumentShare.expires_at.is_(None), DocumentShare.expires_at > now),
        )

        result = await self.db.execute(
            select(DocumentShare.id, DocumentShare.published_at).where(base_filter)
        )
        rows = result.all()

        scored: list[tuple[str, float]] = []
        for row in rows:
            days_since = (now - row.published_at).total_seconds() / 86400 if row.published_at else 0
            # Faster decay (7-day half-life) to prioritize fresh content from follows
            recency_score = 1.0 / (1.0 + days_since / 7.0)
            scored.append((row.id, recency_score))

        scored.sort(key=lambda x: -x[1])
        return scored[:limit]

    async def _recommend_by_trending(self, limit: int = 30) -> list[tuple[str, float]]:
        """Get trending items with time decay.

        score = (view_count + fork_count*5 + bookmark_count*3
                 + comment_count*2 + reaction_count*2)
                / (1 + days_since_published / 30)
        """
        now = datetime.now(UTC)
        base_filter = and_(
            DocumentShare.is_published == True,  # noqa: E712
            DocumentShare.is_active == True,  # noqa: E712
            DocumentShare.visibility == "public",
            or_(DocumentShare.expires_at.is_(None), DocumentShare.expires_at > now),
        )

        result = await self.db.execute(
            select(
                DocumentShare.id,
                DocumentShare.view_count,
                DocumentShare.fork_count,
                DocumentShare.bookmark_count,
                DocumentShare.comment_count,
                DocumentShare.reaction_count,
                DocumentShare.published_at,
            ).where(base_filter)
        )
        rows = result.all()

        scored: list[tuple[str, float]] = []
        for row in rows:
            raw_score = (
                row.view_count
                + row.fork_count * 5
                + row.bookmark_count * 3
                + row.comment_count * 2
                + row.reaction_count * 2
            )
            days_since = (now - row.published_at).total_seconds() / 86400 if row.published_at else 0
            decay = 1.0 / (1.0 + days_since / 30.0)
            scored.append((row.id, raw_score * decay))

        scored.sort(key=lambda x: -x[1])
        return scored[:limit]

    @staticmethod
    def _merge_recommendations(
        follow_results: list[tuple[str, float]],
        tag_results: list[tuple[str, float]],
        trending_results: list[tuple[str, float]],
        viewed_share_ids: set[str] | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> list[str]:
        """Merge results from 3 channels using weighted normalized scoring.

        Weights: follow (40%) + tag (30%) + trending (30%).
        Already-viewed shares receive a 0.7x demotion multiplier.
        Returns ordered list of share_ids after deduplication and pagination.
        """
        SEEN_DEMOTION = 0.7

        def normalize(results: list[tuple[str, float]]) -> dict[str, float]:
            if not results:
                return {}
            max_score = max(s for _, s in results) or 1.0
            return {sid: s / max_score for sid, s in results}

        follow_scores = normalize(follow_results)
        tag_scores = normalize(tag_results)
        trend_scores = normalize(trending_results)

        # Collect all share IDs
        all_ids = set(follow_scores) | set(tag_scores) | set(trend_scores)

        final_scores: list[tuple[str, float]] = []
        for sid in all_ids:
            score = (
                0.40 * follow_scores.get(sid, 0.0)
                + 0.30 * tag_scores.get(sid, 0.0)
                + 0.30 * trend_scores.get(sid, 0.0)
            )
            # Demote already-seen content
            if viewed_share_ids and sid in viewed_share_ids:
                score *= SEEN_DEMOTION
            final_scores.append((sid, score))

        final_scores.sort(key=lambda x: -x[1])
        return [sid for sid, _ in final_scores[offset : offset + limit]]

    async def get_recommendations(
        self,
        user_id: str,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[dict], int]:
        """Get personalized recommendations for a user.

        Strategy: follow (40%) + tag (30%) + trending (30%).
        Falls back to trending if user has no interaction history.
        """
        # Get actual total published count (for sidebar display)
        now = datetime.now(UTC)
        total_result = await self.db.execute(
            select(func.count(DocumentShare.id)).where(
                DocumentShare.is_published == True,  # noqa: E712
                DocumentShare.is_active == True,  # noqa: E712
                DocumentShare.visibility == "public",
                or_(DocumentShare.expires_at.is_(None), DocumentShare.expires_at > now),
            )
        )
        total = total_result.scalar() or 0

        interest_tags = await self.get_user_interest_tags(user_id)

        # Fetch user's viewed share IDs for already-seen demotion
        viewed_result = await self.db.execute(
            select(ShareView.share_id).where(ShareView.user_id == user_id)
        )
        viewed_share_ids = {row[0] for row in viewed_result.all()}

        # Run 3 recall channels
        follow_results = await self._recommend_by_follows(user_id)
        tag_results = await self._recommend_by_tags(user_id, interest_tags)
        trending_results = await self._recommend_by_trending()

        # If user has no personalization signals, fallback to trending only
        if not follow_results and not tag_results:
            ordered_ids = [sid for sid, _ in trending_results[offset : offset + limit]]
        else:
            # Merge and paginate (with seen demotion)
            ordered_ids = self._merge_recommendations(
                follow_results,
                tag_results,
                trending_results,
                viewed_share_ids=viewed_share_ids,
                limit=limit,
                offset=offset,
            )

        if not ordered_ids:
            return [], 0

        # Fetch full share details for the ordered IDs
        now = datetime.now(UTC)
        base_filter = and_(
            DocumentShare.id.in_(ordered_ids),
            DocumentShare.is_published == True,  # noqa: E712
            DocumentShare.is_active == True,  # noqa: E712
            or_(DocumentShare.expires_at.is_(None), DocumentShare.expires_at > now),
        )

        query = (
            select(
                DocumentShare.id,
                DocumentShare.share_token,
                DocumentShare.title,
                DocumentShare.description,
                DocumentShare.tags,
                DocumentShare.published_at,
                DocumentShare.updated_at,
                DocumentShare.view_count,
                DocumentShare.fork_count,
                DocumentShare.bookmark_count,
                DocumentShare.comment_count,
                DocumentShare.reaction_count,
                DocumentShare.allow_fork,
                DocumentShare.user_id,
                File.name.label("file_name"),
                File.is_folder,
                # Content preview fields
                func.safe_substr(File.content_markdown, 1, 350).label("content_markdown_head"),
                func.length(File.content_markdown).label("content_markdown_length"),
                func.safe_substr(File.content, 1, 1000).label("content_head"),
                func.length(File.content).label("content_length"),
                User.username.label("owner_name"),
                User.avatar_url.label("owner_avatar_url"),
                _item_count_subquery(),
                DocumentShare.file_id,
            )
            .join(File, DocumentShare.file_id == File.id)
            .join(User, DocumentShare.user_id == User.id)
            .where(base_filter)
        )

        result = await self.db.execute(query)
        rows = result.all()

        # Build items dict keyed by share_id for ordering
        items_by_id: dict[str, dict] = {}
        for row in rows:
            content_preview, word_count, reading_time = _compute_preview(row)
            items_by_id[row.id] = {
                "share_id": row.id,
                "share_token": row.share_token,
                "title": row.title or row.file_name,
                "description": row.description,
                "tags": row.tags or [],
                "owner": {
                    "id": row.user_id,
                    "username": row.owner_name,
                    "avatar_url": row.owner_avatar_url,
                },
                "is_folder": row.is_folder,
                "view_count": row.view_count,
                "fork_count": row.fork_count,
                "allow_fork": row.allow_fork,
                "bookmark_count": row.bookmark_count,
                "comment_count": row.comment_count,
                "reaction_count": row.reaction_count,
                "published_at": row.published_at.isoformat() if row.published_at else "",
                "updated_at": row.updated_at.isoformat() if row.updated_at else "",
                "is_bookmarked": False,
                "is_forked": False,
                "content_preview": content_preview,
                "word_count": word_count,
                "reading_time": reading_time,
                "item_count": row.item_count if row.is_folder else None,
                "_file_id": row.file_id if row.is_folder else None,
            }

        # Preserve recommendation order
        items = [items_by_id[sid] for sid in ordered_ids if sid in items_by_id]

        # Batch-fetch folder children previews and reactions
        await self._attach_folder_children(items)
        await self._attach_share_reactions(items, user_id)

        # Annotate bookmark/fork status
        if items:
            share_ids = [item["share_id"] for item in items]
            bm_result = await self.db.execute(
                select(Bookmark.share_id).where(
                    Bookmark.user_id == user_id,
                    Bookmark.share_id.in_(share_ids),
                )
            )
            bookmarked_ids = {row[0] for row in bm_result.all()}

            fk_result = await self.db.execute(
                select(Fork.source_share_id).where(
                    Fork.user_id == user_id,
                    Fork.source_share_id.in_(share_ids),
                )
            )
            forked_ids = {row[0] for row in fk_result.all()}

            for item in items:
                item["is_bookmarked"] = item["share_id"] in bookmarked_ids
                item["is_forked"] = item["share_id"] in forked_ids

        return items, total

    # =========================================================================
    # Internal Helpers
    # =========================================================================

    async def _deep_copy_file_tree(
        self, source_file: File, new_user_id: str, target_folder_id: str | None
    ) -> File:
        """Recursively copy a file or folder tree for forking."""
        new_file = File(
            id=str(uuid.uuid4()),
            user_id=new_user_id,
            name=source_file.name,
            content=source_file.content if not source_file.is_folder else "",
            content_hash=source_file.content_hash,
            is_folder=source_file.is_folder,
            parent_id=target_folder_id,
            icon=source_file.icon,
            position=0,
        )
        self.db.add(new_file)
        await self.db.flush()  # Get the ID

        if source_file.is_folder:
            # Copy children
            children_result = await self.db.execute(
                select(File).where(
                    File.parent_id == source_file.id,
                    File.deleted_at.is_(None),
                )
            )
            children = children_result.scalars().all()

            for child in children:
                child_copy = File(
                    id=str(uuid.uuid4()),
                    user_id=new_user_id,
                    name=child.name,
                    content=child.content if not child.is_folder else "",
                    content_hash=child.content_hash,
                    is_folder=child.is_folder,
                    parent_id=new_file.id,
                    icon=child.icon,
                    position=child.position,
                )
                self.db.add(child_copy)

        return new_file

    async def _update_denormalized_count(self, share_id: str, field: str, delta: int) -> int:
        """Atomically update a count field using SQL expression."""
        col = getattr(DocumentShare, field)
        stmt = (
            update(DocumentShare)
            .where(DocumentShare.id == share_id)
            .values(**{field: func.greatest(col + delta, 0)})
            .returning(col)
        )
        result = await self.db.execute(stmt)
        new_value = result.scalar_one()
        return max(new_value, 0)

    @staticmethod
    def _hash_content(content: str) -> str:
        """Compute SHA-256 hash of content."""
        return hashlib.sha256(content.encode("utf-8")).hexdigest()
