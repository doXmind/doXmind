#!/usr/bin/env python3
"""Seed community with official doXmind account and 26 curated articles (13 zh + 13 en)."""

import asyncio
import hashlib
import json
import os
import random
import re
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import asyncpg
import markdown

# Database connection - works inside Docker container
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://doxmind:doxmind@postgres:5432/doxmind")
if "asyncpg" in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")

CONTENT_DIR = os.environ.get("OFFICIAL_CONTENT_DIR", "/app/content/official")

# Deterministic UUID for the official account (idempotent)
OFFICIAL_USER_ID = "00000000-0000-4000-a000-000000000001"

OFFICIAL_USER = {
    "id": OFFICIAL_USER_ID,
    "email": "official@doxmind.com",
    "username": "doXmind",
    "bio": "Official doXmind account. Tutorials, writing tips, and doXmind AI writing guides. | doXmind 官方账号。产品教程、写作技巧与 doXmind AI 写作指南。",
    "avatar_url": "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Ccircle cx='100' cy='100' r='100' fill='%233b82f6'/%3E%3Cg transform='translate(40,40)scale(1.5)'%3E%3Cpath d='M6 0Q0 0 0 6L0 32 40 40 32 0Z' fill='white'/%3E%3Cpath d='M48 0L40 40 80 32 80 6Q80 0 74 0Z' fill='white'/%3E%3Cpath d='M0 48L40 40 32 80 6 80Q0 80 0 74Z' fill='white'/%3E%3Cpath d='M40 40L80 48 80 74Q80 80 74 80L48 80Z' fill='white'/%3E%3C/g%3E%3C/svg%3E",
}

# Tags per category folder
CATEGORY_TAGS = {
    "01-product": {
        "zh": ["教程", "产品", "doXmind"],
        "en": ["tutorial", "product", "doXmind"],
    },
    "02-writing": {
        "zh": ["写作", "技巧", "方法论"],
        "en": ["writing", "tips", "methodology"],
    },
    "03-advanced": {
        "zh": ["进阶", "高级功能", "效率"],
        "en": ["advanced", "features", "productivity"],
    },
}

# Per-article tags (keyed by filename without .md)
ARTICLE_TAGS = {
    "01-welcome": {
        "zh": ["入门", "教程"],
        "en": ["getting-started", "tutorial"],
    },
    "02-ai-chat": {
        "zh": ["AI", "对话", "教程"],
        "en": ["ai", "chat", "tutorial"],
    },
    "03-quick-edit": {
        "zh": ["AI", "编辑", "教程"],
        "en": ["ai", "editing", "tutorial"],
    },
    "04-autocomplete": {
        "zh": ["AI", "自动补全", "效率"],
        "en": ["ai", "autocomplete", "productivity"],
    },
    "05-kb-and-sharing": {
        "zh": ["知识库", "分享", "教程"],
        "en": ["knowledge-base", "sharing", "tutorial"],
    },
    "06-structured-writing": {
        "zh": ["写作", "结构", "方法论"],
        "en": ["writing", "structure", "methodology"],
    },
    "07-compelling-intro": {
        "zh": ["写作", "技巧", "开头"],
        "en": ["writing", "craft", "tips"],
    },
    "08-revision-techniques": {
        "zh": ["写作", "修改", "编辑"],
        "en": ["writing", "editing", "revision"],
    },
    "09-long-form-tips": {
        "zh": ["写作", "长文", "策略"],
        "en": ["writing", "long-form", "strategy"],
    },
    "10-ai-writing-workflow": {
        "zh": ["AI", "写作", "工作流"],
        "en": ["ai", "writing", "workflow"],
    },
    "11-database-blocks": {
        "zh": ["数据库", "进阶", "教程"],
        "en": ["database", "advanced", "tutorial"],
    },
    "12-presentation-mode": {
        "zh": ["演示", "进阶", "教程"],
        "en": ["presentation", "advanced", "tutorial"],
    },
    "13-keyboard-shortcuts": {
        "zh": ["快捷键", "效率", "参考"],
        "en": ["shortcuts", "productivity", "reference"],
    },
}


def extract_title(content: str) -> str:
    """Extract title from first H1 heading in markdown."""
    match = re.match(r"^#\s+(.+)$", content.strip(), re.MULTILINE)
    if match:
        return match.group(1).strip()
    return "Untitled"


def extract_description(content: str) -> str:
    """Extract a clean description from the first meaningful paragraph."""
    lines = content.strip().split("\n")
    paragraphs = []
    current = []

    for line in lines[1:]:  # Skip title
        stripped = line.strip()
        if stripped == "---":
            if current:
                paragraphs.append(" ".join(current))
                current = []
            continue
        if stripped.startswith("#"):
            if current:
                paragraphs.append(" ".join(current))
            break
        if stripped == "":
            if current:
                paragraphs.append(" ".join(current))
                current = []
        else:
            current.append(stripped)

    if current:
        paragraphs.append(" ".join(current))

    for para in paragraphs:
        if len(para) > 20:
            # Remove markdown formatting
            desc = re.sub(r"\*\*(.+?)\*\*", r"\1", para)
            desc = re.sub(r"\*(.+?)\*", r"\1", desc)
            desc = re.sub(r"`(.+?)`", r"\1", desc)
            desc = re.sub(r"\[(.+?)\]\(.+?\)", r"\1", desc)
            desc = desc.replace("--", "\u2014")
            if len(desc) > 300:
                cut = desc[:300].rfind(". ")
                if cut > 100:
                    desc = desc[: cut + 1]
                else:
                    cut_zh = desc[:300].rfind("。")
                    if cut_zh > 50:
                        desc = desc[: cut_zh + 1]
                    else:
                        desc = desc[:297] + "..."
            return desc
    return ""


def get_tags(filename: str, category_folder: str, lang: str) -> list[str]:
    """Get tags for an article based on filename and category."""
    # Article-specific tags
    # Try exact match first, then partial
    article_key = filename.replace(".md", "")
    tags = list(ARTICLE_TAGS.get(article_key, {}).get(lang, []))

    # Add category tags if we have room
    cat_tags = CATEGORY_TAGS.get(category_folder, {}).get(lang, [])
    for t in cat_tags:
        if t not in tags and len(tags) < 5:
            tags.append(t)

    return tags[:5]


def md_to_html(content: str) -> str:
    """Convert markdown to clean HTML."""
    md = markdown.Markdown(
        extensions=["extra", "codehilite", "sane_lists", "smarty"],
        extension_configs={
            "codehilite": {"css_class": "highlight", "linenums": False},
        },
    )
    html = md.convert(content)
    return html


async def main():
    print("Connecting to database...")
    conn = await asyncpg.connect(DATABASE_URL)

    try:
        # Safety check: don't double-seed
        existing = await conn.fetchval(
            "SELECT COUNT(*) FROM users WHERE id = $1",
            OFFICIAL_USER_ID,
        )
        if existing > 0:
            print(f"Official user already exists (id={OFFICIAL_USER_ID}). Aborting to prevent duplicates.")
            return

        now = datetime.now(UTC)
        total_articles = 0
        random.seed(2024)  # Reproducible randomness

        # Create official user (3 weeks ago)
        user_created = now - timedelta(days=21, hours=8)
        print(f"\nCreating official user: {OFFICIAL_USER['username']} ({OFFICIAL_USER['email']})")

        await conn.execute(
            """
            INSERT INTO users (id, email, username, bio, avatar_url, is_verified, is_active, is_official, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, true, true, true, $6, $6)
            """,
            OFFICIAL_USER["id"],
            OFFICIAL_USER["email"],
            OFFICIAL_USER["username"],
            OFFICIAL_USER["bio"],
            OFFICIAL_USER["avatar_url"],
            user_created,
        )

        # Process both languages
        for lang in ["zh", "en"]:
            lang_dir = os.path.join(CONTENT_DIR, lang)
            if not os.path.isdir(lang_dir):
                print(f"  WARNING: Language directory not found: {lang_dir}")
                continue

            print(f"\n{'=' * 60}")
            print(f"Processing {lang.upper()} articles from {lang_dir}")
            print(f"{'=' * 60}")

            # Walk through category folders
            category_folders = sorted(
                d for d in os.listdir(lang_dir) if os.path.isdir(os.path.join(lang_dir, d))
            )

            for category_folder in category_folders:
                cat_path = os.path.join(lang_dir, category_folder)
                md_files = sorted(f for f in os.listdir(cat_path) if f.endswith(".md"))
                print(f"\n  Category: {category_folder} ({len(md_files)} articles)")

                for _j, md_file in enumerate(md_files):
                    file_path = os.path.join(cat_path, md_file)
                    with open(file_path, encoding="utf-8") as f:
                        md_content = f.read()

                    # Extract metadata
                    title = extract_title(md_content)
                    description = extract_description(md_content)
                    tags = get_tags(md_file, category_folder, lang)
                    html_content = md_to_html(md_content)

                    # Generate IDs
                    file_id = str(uuid.uuid4())
                    share_id = str(uuid.uuid4())
                    share_token = secrets.token_urlsafe(32)
                    content_hash = hashlib.sha256(html_content.encode("utf-8")).hexdigest()

                    # Stagger publish dates (1-2 days apart, starting 2 weeks ago)
                    article_published = user_created + timedelta(
                        days=2 + total_articles * random.uniform(0.5, 1.2),
                        hours=random.randint(8, 20),
                        minutes=random.randint(0, 59),
                    )

                    # Higher initial view counts for official content (500-2000)
                    days_old = max(1, (now - article_published).days)
                    view_count = max(100, int(days_old * random.uniform(30, 80) + random.randint(200, 500)))

                    # Create file
                    await conn.execute(
                        """
                        INSERT INTO files (id, user_id, name, content, content_hash, content_markdown,
                                          is_folder, position, created_at, updated_at)
                        VALUES ($1, $2, $3, $4, $5, $6, false, $7, $8, $8)
                        """,
                        file_id,
                        OFFICIAL_USER["id"],
                        f"{title}.md",
                        html_content,
                        content_hash,
                        md_content,
                        total_articles,
                        article_published,
                    )

                    # Create share (published + featured)
                    await conn.execute(
                        """
                        INSERT INTO document_shares
                            (id, file_id, user_id, share_token, is_active, content_mode,
                             visibility, is_published, is_featured, title, description, tags,
                             published_at, view_count, fork_count, bookmark_count,
                             comment_count, reaction_count, created_at, updated_at)
                        VALUES ($1, $2, $3, $4, true, 'live', 'public', true, true, $5, $6,
                                $7::json, $8, $9, 0, 0, 0, 0, $8, $8)
                        """,
                        share_id,
                        file_id,
                        OFFICIAL_USER["id"],
                        share_token,
                        title,
                        description,
                        json.dumps(tags),
                        article_published,
                        view_count,
                    )

                    total_articles += 1
                    print(f"    [{total_articles:2d}] [{lang}] {title}")
                    print(f"         tags: {tags} | views: {view_count}")

        print(f"\n{'=' * 60}")
        print(f"DONE: Created official user and {total_articles} published articles")
        print(f"{'=' * 60}")

    except Exception as e:
        print(f"\nERROR: {e}")
        raise
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
