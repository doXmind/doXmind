"""Comment service for CRUD, reactions, and mentions."""

import logging
from datetime import UTC, datetime

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import Comment, CommentReaction, DocumentShare, User, utcnow
from exceptions import BadRequestError, ForbiddenError, NotFoundError

logger = logging.getLogger(__name__)

ALLOWED_REACTION_EMOJIS = {"👍", "👎", "❤️", "🔥", "🎉", "😄", "🤔", "👀", "🚀", "💯"}


class CommentService:
    """Service for comment operations."""

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
    # List Comments
    # =========================================================================

    async def list_comments(
        self,
        share_token: str,
        parent_id: str | None = None,
        limit: int = 50,
        offset: int = 0,
        sort: str = "oldest",
        current_user_id: str | None = None,
    ) -> tuple[list[dict], int]:
        """List comments with aggregated reactions."""
        share = await self._resolve_share_by_token(share_token)
        if not share:
            raise NotFoundError(resource="Share", message="Share not found or expired")

        # Count total
        count_filter = and_(Comment.share_id == share.id)
        if parent_id:
            count_filter = and_(count_filter, Comment.parent_id == parent_id)
        else:
            count_filter = and_(count_filter, Comment.parent_id.is_(None))

        count_result = await self.db.execute(select(func.count(Comment.id)).where(count_filter))
        total = count_result.scalar() or 0

        # Query comments
        query = (
            select(
                Comment.id,
                Comment.content,
                Comment.parent_id,
                Comment.mentions,
                Comment.is_deleted,
                Comment.created_at,
                Comment.updated_at,
                Comment.user_id,
                User.username.label("author_name"),
                User.avatar_url.label("author_avatar"),
            )
            .join(User, Comment.user_id == User.id)
            .where(count_filter)
            .order_by(Comment.created_at.desc() if sort == "newest" else Comment.created_at.asc())
            .limit(limit)
            .offset(offset)
        )

        result = await self.db.execute(query)
        rows = result.all()

        comments = []
        for row in rows:
            # Count replies
            reply_count_result = await self.db.execute(
                select(func.count(Comment.id)).where(Comment.parent_id == row.id)
            )
            reply_count = reply_count_result.scalar() or 0

            # Get reactions
            reactions = await self._get_reactions_for_comment(row.id, current_user_id)

            comment = {
                "id": row.id,
                "content": "[deleted]" if row.is_deleted else row.content,
                "author": {
                    "id": row.user_id if not row.is_deleted else None,
                    "username": None if row.is_deleted else row.author_name,
                    "avatar_url": None if row.is_deleted else row.author_avatar,
                },
                "parent_id": row.parent_id,
                "mentions": row.mentions if not row.is_deleted else None,
                "reactions": reactions,
                "reply_count": reply_count,
                "is_deleted": row.is_deleted,
                "is_edited": (
                    row.updated_at > row.created_at if row.updated_at and row.created_at else False
                ),
                "created_at": row.created_at.isoformat() if row.created_at else "",
                "updated_at": row.updated_at.isoformat() if row.updated_at else "",
            }
            comments.append(comment)

        return comments, total

    # =========================================================================
    # Create/Edit/Delete
    # =========================================================================

    async def create_comment(
        self,
        share_token: str,
        user_id: str,
        content: str,
        parent_id: str | None = None,
        mentions: list[str] | None = None,
    ) -> dict:
        """Create a comment."""
        share = await self._resolve_share_by_token(share_token)
        if not share:
            raise NotFoundError(resource="Share", message="Share not found or expired")

        # Validate parent if threading
        if parent_id:
            parent_result = await self.db.execute(
                select(Comment).where(
                    Comment.id == parent_id,
                    Comment.share_id == share.id,
                    Comment.is_deleted == False,  # noqa: E712
                )
            )
            if not parent_result.scalar_one_or_none():
                raise NotFoundError(resource="Comment", message="Parent comment not found")

        # Validate mentions
        validated_mentions = None
        if mentions:
            validated_mentions = await self._resolve_mentions(mentions)

        comment = Comment(
            share_id=share.id,
            user_id=user_id,
            parent_id=parent_id,
            content=content,
            mentions=validated_mentions,
        )
        self.db.add(comment)

        # Increment comment count atomically
        await self.db.execute(
            update(DocumentShare)
            .where(DocumentShare.id == share.id)
            .values(comment_count=DocumentShare.comment_count + 1)
        )

        await self.db.commit()
        await self.db.refresh(comment)

        # Get author info
        author_result = await self.db.execute(
            select(User.username, User.avatar_url).where(User.id == user_id)
        )
        author = author_result.one_or_none()

        return {
            "id": comment.id,
            "content": comment.content,
            "author": {
                "id": user_id,
                "username": author.username if author else None,
                "avatar_url": author.avatar_url if author else None,
            },
            "parent_id": comment.parent_id,
            "mentions": comment.mentions,
            "reactions": [],
            "reply_count": 0,
            "is_deleted": False,
            "is_edited": False,
            "created_at": comment.created_at.isoformat() if comment.created_at else "",
            "updated_at": comment.updated_at.isoformat() if comment.updated_at else "",
        }

    async def update_comment(
        self,
        comment_id: str,
        user_id: str,
        content: str,
        mentions: list[str] | None = None,
    ) -> dict:
        """Update own comment."""
        result = await self.db.execute(select(Comment).where(Comment.id == comment_id))
        comment = result.scalar_one_or_none()
        if not comment:
            raise NotFoundError(resource="Comment", resource_id=comment_id)

        if comment.user_id != user_id:
            raise ForbiddenError(message="Can only edit your own comments")

        if comment.is_deleted:
            raise BadRequestError(message="Cannot edit a deleted comment")

        validated_mentions = None
        if mentions:
            validated_mentions = await self._resolve_mentions(mentions)

        comment.content = content
        comment.mentions = validated_mentions
        comment.updated_at = utcnow()

        await self.db.commit()
        await self.db.refresh(comment)

        author_result = await self.db.execute(
            select(User.username, User.avatar_url).where(User.id == user_id)
        )
        author = author_result.one_or_none()
        reactions = await self._get_reactions_for_comment(comment.id, user_id)

        return {
            "id": comment.id,
            "content": comment.content,
            "author": {
                "id": user_id,
                "username": author.username if author else None,
                "avatar_url": author.avatar_url if author else None,
            },
            "parent_id": comment.parent_id,
            "mentions": comment.mentions,
            "reactions": reactions,
            "reply_count": 0,
            "is_deleted": False,
            "is_edited": True,
            "created_at": comment.created_at.isoformat() if comment.created_at else "",
            "updated_at": comment.updated_at.isoformat() if comment.updated_at else "",
        }

    async def delete_comment(
        self,
        comment_id: str,
        user_id: str,
        share_token: str,
    ) -> bool:
        """Soft-delete a comment (author or share owner)."""
        result = await self.db.execute(select(Comment).where(Comment.id == comment_id))
        comment = result.scalar_one_or_none()
        if not comment:
            raise NotFoundError(resource="Comment", resource_id=comment_id)

        # Check permission: author or share owner
        share = await self._resolve_share_by_token(share_token)
        if not share:
            raise NotFoundError(resource="Share", message="Share not found")

        if comment.user_id != user_id and share.user_id != user_id:
            raise ForbiddenError(message="Can only delete your own comments")

        comment.is_deleted = True
        comment.deleted_at = utcnow()

        # Decrement comment count
        await self.db.execute(
            update(DocumentShare)
            .where(DocumentShare.id == comment.share_id)
            .values(comment_count=func.greatest(DocumentShare.comment_count - 1, 0))
        )

        await self.db.commit()
        return True

    # =========================================================================
    # Reactions
    # =========================================================================

    async def toggle_reaction(
        self,
        comment_id: str,
        user_id: str,
        emoji: str,
    ) -> tuple[bool, list[dict]]:
        """Toggle reaction, return (reacted, updated_reactions)."""
        if emoji not in ALLOWED_REACTION_EMOJIS:
            raise BadRequestError(message=f"Emoji '{emoji}' is not allowed")

        # Verify comment exists
        comment_result = await self.db.execute(
            select(Comment.id).where(Comment.id == comment_id, Comment.is_deleted == False)  # noqa: E712
        )
        if not comment_result.scalar_one_or_none():
            raise NotFoundError(resource="Comment", resource_id=comment_id)

        # Check if reaction exists
        existing = await self.db.execute(
            select(CommentReaction).where(
                CommentReaction.comment_id == comment_id,
                CommentReaction.user_id == user_id,
                CommentReaction.emoji == emoji,
            )
        )
        reaction = existing.scalar_one_or_none()

        if reaction:
            await self.db.delete(reaction)
            reacted = False
        else:
            new_reaction = CommentReaction(comment_id=comment_id, user_id=user_id, emoji=emoji)
            self.db.add(new_reaction)
            reacted = True

        await self.db.commit()

        reactions = await self._get_reactions_for_comment(comment_id, user_id)
        return reacted, reactions

    # =========================================================================
    # Mentions
    # =========================================================================

    async def search_mentions(self, query: str, limit: int = 10) -> list[dict]:
        """Search users by partial username for @mention autocomplete."""
        if not query or len(query) < 1:
            return []

        result = await self.db.execute(
            select(User.id, User.username, User.avatar_url)
            .where(
                User.username.ilike(f"%{query}%"),
                User.is_active == True,  # noqa: E712
            )
            .limit(limit)
        )
        rows = result.all()

        return [
            {"id": row.id, "username": row.username, "avatar_url": row.avatar_url} for row in rows
        ]

    # =========================================================================
    # Internal Helpers
    # =========================================================================

    async def _get_reactions_for_comment(
        self, comment_id: str, current_user_id: str | None = None
    ) -> list[dict]:
        """Get aggregated reactions for a comment."""
        result = await self.db.execute(
            select(
                CommentReaction.emoji,
                func.count(CommentReaction.id).label("count"),
            )
            .where(CommentReaction.comment_id == comment_id)
            .group_by(CommentReaction.emoji)
        )
        rows = result.all()

        # Check which emojis the current user has reacted with
        user_emojis: set[str] = set()
        if current_user_id:
            user_result = await self.db.execute(
                select(CommentReaction.emoji).where(
                    CommentReaction.comment_id == comment_id,
                    CommentReaction.user_id == current_user_id,
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

    async def _resolve_mentions(self, mentions: list[str]) -> list[str]:
        """Validate and resolve mention user IDs."""
        if not mentions:
            return []

        result = await self.db.execute(
            select(User.id).where(User.id.in_(mentions), User.is_active == True)  # noqa: E712
        )
        valid_ids = [row[0] for row in result.all()]
        return valid_ids
