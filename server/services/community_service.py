"""Community service for discovery, publishing, forks, and bookmarks."""

import hashlib
import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import and_, cast, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.types import Text

from db.database import Bookmark, DocumentShare, File, Fork, User, utcnow
from exceptions import BadRequestError, NotFoundError

logger = logging.getLogger(__name__)


class CommunityService:
    """Service for community features: publishing, discovery, forks, bookmarks."""

    def __init__(self, db: AsyncSession):
        self.db = db

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
                DocumentShare.user_id,
                File.name.label("file_name"),
                File.is_folder,
                User.username.label("owner_name"),
                User.avatar_url.label("owner_avatar_url"),
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
                "bookmark_count": row.bookmark_count,
                "comment_count": row.comment_count,
                "published_at": row.published_at.isoformat() if row.published_at else "",
                "updated_at": row.updated_at.isoformat() if row.updated_at else "",
                "is_bookmarked": False,
                "is_forked": False,
            }
            items.append(item)

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
    ) -> DocumentShare:
        """Update metadata (title, description, tags) on a published share."""
        result = await self.db.execute(
            select(DocumentShare).where(
                DocumentShare.id == share_id, DocumentShare.user_id == user_id
            )
        )
        share = result.scalar_one_or_none()
        if not share:
            raise NotFoundError(resource="Share", resource_id=share_id)

        if not share.is_published:
            raise BadRequestError(message="Cannot update metadata on an unpublished share")

        if not share.is_active:
            raise BadRequestError(message="Cannot update metadata on an inactive share")

        if title is not None:
            share.title = title
        if description is not None:
            share.description = description
        if tags is not None:
            normalized_tags = list(dict.fromkeys(t.strip().lower() for t in tags if t.strip()))
            share.tags = normalized_tags[:10] if normalized_tags else None

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
                "bookmark_count": row.bookmark_count,
                "comment_count": row.comment_count,
                "published_at": row.published_at.isoformat() if row.published_at else "",
                "bookmarked_at": row.bookmarked_at.isoformat() if row.bookmarked_at else "",
                "is_bookmarked": True,
            }
            for row in rows
        ]

        return items, total

    # =========================================================================
    # User Profile
    # =========================================================================

    async def get_public_profile(self, user_id: str) -> dict | None:
        """Get user's public profile with stats."""
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

        return {
            "id": user.id,
            "username": user.username,
            "avatar_url": user.avatar_url,
            "bio": user.bio,
            "website": user.website,
            "social_links": user.social_links,
            "created_at": user.created_at.isoformat() if user.created_at else "",
            "stats": {
                "total_published": published_count.scalar() or 0,
                "total_views": views_total.scalar() or 0,
                "total_forks_received": forks_received.scalar() or 0,
                "total_bookmarks_received": bookmarks_received.scalar() or 0,
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
                DocumentShare.user_id,
                File.name.label("file_name"),
                File.is_folder,
                User.username.label("owner_name"),
                User.avatar_url.label("owner_avatar_url"),
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

        items = [
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
                "bookmark_count": row.bookmark_count,
                "comment_count": row.comment_count,
                "published_at": row.published_at.isoformat() if row.published_at else "",
                "updated_at": row.updated_at.isoformat() if row.updated_at else "",
                "is_bookmarked": False,
                "is_forked": False,
            }
            for row in rows
        ]

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
