"""Comment service for CRUD, reactions, and mentions."""

import logging
from datetime import UTC, datetime

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import Comment, CommentReaction, DocumentShare, User, UserSubscription, utcnow
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

        # Count total (exclude inline comments from document-level listing)
        count_filter = and_(Comment.share_id == share.id)
        if parent_id:
            count_filter = and_(count_filter, Comment.parent_id == parent_id)
        else:
            count_filter = and_(
                count_filter,
                Comment.parent_id.is_(None),
                Comment.anchor_from.is_(None),  # Exclude inline comments
            )

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
                User.avatar_frame.label("author_avatar_frame"),
                UserSubscription.plan.label("author_plan"),
            )
            .join(User, Comment.user_id == User.id)
            .outerjoin(UserSubscription, UserSubscription.user_id == Comment.user_id)
            .where(count_filter)
            .order_by(Comment.created_at.desc() if sort == "newest" else Comment.created_at.asc())
            .limit(limit)
            .offset(offset)
        )

        result = await self.db.execute(query)
        rows = result.all()

        if not rows:
            return [], total

        comment_ids = [row.id for row in rows]

        # Batch query: reply counts for all comments
        reply_counts_result = await self.db.execute(
            select(
                Comment.parent_id,
                func.count(Comment.id).label("reply_count"),
            )
            .where(Comment.parent_id.in_(comment_ids))
            .group_by(Comment.parent_id)
        )
        reply_counts = {row.parent_id: row.reply_count for row in reply_counts_result.all()}

        # Batch query: reaction counts grouped by comment + emoji
        reactions_result = await self.db.execute(
            select(
                CommentReaction.comment_id,
                CommentReaction.emoji,
                func.count(CommentReaction.id).label("count"),
            )
            .where(CommentReaction.comment_id.in_(comment_ids))
            .group_by(CommentReaction.comment_id, CommentReaction.emoji)
        )
        reactions_by_comment: dict[str, list[dict]] = {}
        for r in reactions_result.all():
            reactions_by_comment.setdefault(r.comment_id, []).append(
                {"emoji": r.emoji, "count": r.count, "has_reacted": False}
            )

        # Batch query: current user's reactions
        if current_user_id:
            user_reactions_result = await self.db.execute(
                select(CommentReaction.comment_id, CommentReaction.emoji).where(
                    CommentReaction.comment_id.in_(comment_ids),
                    CommentReaction.user_id == current_user_id,
                )
            )
            user_reacted: set[tuple[str, str]] = {
                (row.comment_id, row.emoji) for row in user_reactions_result.all()
            }
            for cid, reaction_list in reactions_by_comment.items():
                for reaction in reaction_list:
                    if (cid, reaction["emoji"]) in user_reacted:
                        reaction["has_reacted"] = True

        # Build response
        comments = []
        for row in rows:
            comment = {
                "id": row.id,
                "content": "[deleted]" if row.is_deleted else row.content,
                "author": {
                    "id": row.user_id if not row.is_deleted else None,
                    "username": None if row.is_deleted else row.author_name,
                    "avatar_url": None if row.is_deleted else row.author_avatar,
                    "avatar_frame": None if row.is_deleted else row.author_avatar_frame,
                    "plan": None if row.is_deleted else (row.author_plan or "free"),
                },
                "parent_id": row.parent_id,
                "mentions": row.mentions if not row.is_deleted else None,
                "reactions": reactions_by_comment.get(row.id, []),
                "reply_count": reply_counts.get(row.id, 0),
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
        anchor_from: int | None = None,
        anchor_to: int | None = None,
        anchor_text: str | None = None,
        anchor_context_before: str | None = None,
        anchor_context_after: str | None = None,
    ) -> dict:
        """Create a comment (document-level or inline)."""
        share = await self._resolve_share_by_token(share_token)
        if not share:
            raise NotFoundError(resource="Share", message="Share not found or expired")

        # Validate anchor fields: all-or-nothing for required fields
        if anchor_from is not None:
            if anchor_to is None or anchor_text is None:
                raise BadRequestError(
                    message="anchor_to and anchor_text are required when anchor_from is provided"
                )
            if anchor_to <= anchor_from:
                raise BadRequestError(message="anchor_to must be greater than anchor_from")

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
            anchor_from=anchor_from,
            anchor_to=anchor_to,
            anchor_text=anchor_text,
            anchor_context_before=anchor_context_before,
            anchor_context_after=anchor_context_after,
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
            select(
                User.username,
                User.avatar_url,
                User.avatar_frame.label("author_avatar_frame"),
                UserSubscription.plan.label("author_plan"),
            )
            .outerjoin(UserSubscription, UserSubscription.user_id == User.id)
            .where(User.id == user_id)
        )
        author = author_result.one_or_none()

        result = {
            "id": comment.id,
            "content": comment.content,
            "author": {
                "id": user_id,
                "username": author.username if author else None,
                "avatar_url": author.avatar_url if author else None,
                "avatar_frame": author.author_avatar_frame if author else None,
                "plan": (author.author_plan or "free") if author else "free",
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

        # Include anchor data for inline comments
        if comment.anchor_from is not None:
            result["anchor"] = {
                "from": comment.anchor_from,
                "to": comment.anchor_to,
                "text": comment.anchor_text,
                "context_before": comment.anchor_context_before,
                "context_after": comment.anchor_context_after,
            }
            result["is_resolved"] = comment.is_resolved

        return result

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
            select(
                User.username,
                User.avatar_url,
                User.avatar_frame.label("author_avatar_frame"),
                UserSubscription.plan.label("author_plan"),
            )
            .outerjoin(UserSubscription, UserSubscription.user_id == User.id)
            .where(User.id == user_id)
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
                "avatar_frame": author.author_avatar_frame if author else None,
                "plan": (author.author_plan or "free") if author else "free",
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
    # Inline Comments
    # =========================================================================

    async def list_inline_comments(
        self,
        share_token: str,
        include_resolved: bool = False,
        current_user_id: str | None = None,
    ) -> tuple[list[dict], int]:
        """List inline comments sorted by anchor position."""
        share = await self._resolve_share_by_token(share_token)
        if not share:
            raise NotFoundError(resource="Share", message="Share not found or expired")

        # Base filter: top-level inline comments only (not replies)
        base_filter = and_(
            Comment.share_id == share.id,
            Comment.anchor_from.isnot(None),
            Comment.parent_id.is_(None),
        )
        if not include_resolved:
            base_filter = and_(base_filter, Comment.is_resolved == False)  # noqa: E712

        # Count
        count_result = await self.db.execute(
            select(func.count(Comment.id)).where(base_filter)
        )
        total = count_result.scalar() or 0

        # Query inline comments sorted by position
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
                Comment.anchor_from,
                Comment.anchor_to,
                Comment.anchor_text,
                Comment.anchor_context_before,
                Comment.anchor_context_after,
                Comment.is_resolved,
                Comment.resolved_at,
                Comment.resolved_by,
                User.username.label("author_name"),
                User.avatar_url.label("author_avatar"),
                User.avatar_frame.label("author_avatar_frame"),
                UserSubscription.plan.label("author_plan"),
            )
            .join(User, Comment.user_id == User.id)
            .outerjoin(UserSubscription, UserSubscription.user_id == Comment.user_id)
            .where(base_filter)
            .order_by(Comment.anchor_from.asc())
        )

        result = await self.db.execute(query)
        rows = result.all()

        if not rows:
            return [], total

        comment_ids = [row.id for row in rows]

        # Batch: reply counts
        reply_counts_result = await self.db.execute(
            select(
                Comment.parent_id,
                func.count(Comment.id).label("reply_count"),
            )
            .where(Comment.parent_id.in_(comment_ids))
            .group_by(Comment.parent_id)
        )
        reply_counts = {row.parent_id: row.reply_count for row in reply_counts_result.all()}

        # Batch: reactions
        reactions_result = await self.db.execute(
            select(
                CommentReaction.comment_id,
                CommentReaction.emoji,
                func.count(CommentReaction.id).label("count"),
            )
            .where(CommentReaction.comment_id.in_(comment_ids))
            .group_by(CommentReaction.comment_id, CommentReaction.emoji)
        )
        reactions_by_comment: dict[str, list[dict]] = {}
        for r in reactions_result.all():
            reactions_by_comment.setdefault(r.comment_id, []).append(
                {"emoji": r.emoji, "count": r.count, "has_reacted": False}
            )

        if current_user_id:
            user_reactions_result = await self.db.execute(
                select(CommentReaction.comment_id, CommentReaction.emoji).where(
                    CommentReaction.comment_id.in_(comment_ids),
                    CommentReaction.user_id == current_user_id,
                )
            )
            user_reacted = {
                (row.comment_id, row.emoji) for row in user_reactions_result.all()
            }
            for cid, reaction_list in reactions_by_comment.items():
                for reaction in reaction_list:
                    if (cid, reaction["emoji"]) in user_reacted:
                        reaction["has_reacted"] = True

        # Build response
        comments = []
        for row in rows:
            comment = {
                "id": row.id,
                "content": "[deleted]" if row.is_deleted else row.content,
                "author": {
                    "id": row.user_id if not row.is_deleted else None,
                    "username": None if row.is_deleted else row.author_name,
                    "avatar_url": None if row.is_deleted else row.author_avatar,
                    "avatar_frame": None if row.is_deleted else row.author_avatar_frame,
                    "plan": None if row.is_deleted else (row.author_plan or "free"),
                },
                "parent_id": row.parent_id,
                "mentions": row.mentions if not row.is_deleted else None,
                "reactions": reactions_by_comment.get(row.id, []),
                "reply_count": reply_counts.get(row.id, 0),
                "is_deleted": row.is_deleted,
                "is_edited": (
                    row.updated_at > row.created_at if row.updated_at and row.created_at else False
                ),
                "created_at": row.created_at.isoformat() if row.created_at else "",
                "updated_at": row.updated_at.isoformat() if row.updated_at else "",
                "anchor": {
                    "from": row.anchor_from,
                    "to": row.anchor_to,
                    "text": row.anchor_text,
                    "context_before": row.anchor_context_before,
                    "context_after": row.anchor_context_after,
                },
                "is_resolved": row.is_resolved,
                "resolved_at": row.resolved_at.isoformat() if row.resolved_at else None,
                "resolved_by": row.resolved_by,
            }
            comments.append(comment)

        return comments, total

    async def resolve_comment(
        self,
        share_token: str,
        comment_id: str,
        user_id: str,
    ) -> dict:
        """Mark an inline comment as resolved."""
        share = await self._resolve_share_by_token(share_token)
        if not share:
            raise NotFoundError(resource="Share", message="Share not found or expired")

        result = await self.db.execute(
            select(Comment).where(
                Comment.id == comment_id,
                Comment.share_id == share.id,
                Comment.anchor_from.isnot(None),
            )
        )
        comment = result.scalar_one_or_none()
        if not comment:
            raise NotFoundError(resource="Comment", message="Inline comment not found")

        # Permission: author or share owner
        if comment.user_id != user_id and share.user_id != user_id:
            raise ForbiddenError(message="Only comment author or document owner can resolve")

        comment.is_resolved = True
        comment.resolved_at = utcnow()
        comment.resolved_by = user_id
        await self.db.commit()

        return {"id": comment.id, "is_resolved": True}

    async def unresolve_comment(
        self,
        share_token: str,
        comment_id: str,
        user_id: str,
    ) -> dict:
        """Re-open a resolved inline comment."""
        share = await self._resolve_share_by_token(share_token)
        if not share:
            raise NotFoundError(resource="Share", message="Share not found or expired")

        result = await self.db.execute(
            select(Comment).where(
                Comment.id == comment_id,
                Comment.share_id == share.id,
                Comment.anchor_from.isnot(None),
            )
        )
        comment = result.scalar_one_or_none()
        if not comment:
            raise NotFoundError(resource="Comment", message="Inline comment not found")

        if comment.user_id != user_id and share.user_id != user_id:
            raise ForbiddenError(message="Only comment author or document owner can unresolve")

        comment.is_resolved = False
        comment.resolved_at = None
        comment.resolved_by = None
        await self.db.commit()

        return {"id": comment.id, "is_resolved": False}

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
            select(
                User.id,
                User.username,
                User.avatar_url,
                User.avatar_frame.label("user_avatar_frame"),
                UserSubscription.plan.label("user_plan"),
            )
            .outerjoin(UserSubscription, UserSubscription.user_id == User.id)
            .where(
                User.username.ilike(f"%{query}%"),
                User.is_active == True,  # noqa: E712
            )
            .limit(limit)
        )
        rows = result.all()

        return [
            {
                "id": row.id,
                "username": row.username,
                "avatar_url": row.avatar_url,
                "avatar_frame": row.user_avatar_frame,
                "plan": row.user_plan or "free",
            }
            for row in rows
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
