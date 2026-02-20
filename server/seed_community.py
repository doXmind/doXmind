#!/usr/bin/env python3
"""Seed community with 10 realistic users and 100 published articles."""

import asyncio
import hashlib
import json
import os
import random
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import asyncpg
import markdown

# Database connection - works inside Docker container
DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://doxmind:doxmind@postgres:5432/doxmind"
)
# Normalize URL for asyncpg (strip asyncpg dialect prefix if present)
if "asyncpg" in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")

CONTENT_DIR = "/app/content"

# ============================================================================
# 10 Users - one per topic category
# ============================================================================
USERS = [
    {
        "id": str(uuid.uuid4()),
        "email": "sarah.chen.writes@gmail.com",
        "username": "Sarah Chen",
        "bio": "Productivity nerd & systems thinker. I test every framework so you don't have to. Writing about what actually works in getting things done.",
        "avatar_url": "https://api.dicebear.com/7.x/avataaars/svg?seed=SarahChen&backgroundColor=b6e3f4",
        "folder": "01-personal-productivity",
    },
    {
        "id": str(uuid.uuid4()),
        "email": "marcus.r.career@gmail.com",
        "username": "Marcus Rivera",
        "bio": "Career coach & former hiring manager at Fortune 500. 12 years helping people navigate the modern workplace.",
        "avatar_url": "https://api.dicebear.com/7.x/avataaars/svg?seed=MarcusRivera&backgroundColor=c0aede",
        "folder": "02-career-growth",
    },
    {
        "id": str(uuid.uuid4()),
        "email": "emma.t.finance@gmail.com",
        "username": "Emma Thompson",
        "bio": "CFA turned writer. Making personal finance less boring and more actionable. No get-rich-quick schemes, just solid fundamentals.",
        "avatar_url": "https://api.dicebear.com/7.x/avataaars/svg?seed=EmmaThompson&backgroundColor=ffd5dc",
        "folder": "03-personal-finance",
    },
    {
        "id": str(uuid.uuid4()),
        "email": "alex.patel.tech@gmail.com",
        "username": "Alex Patel",
        "bio": "AI/ML engineer by day, tech writer by night. Exploring how AI tools can genuinely improve your workflow.",
        "avatar_url": "https://api.dicebear.com/7.x/avataaars/svg?seed=AlexPatel&backgroundColor=d1d4f9",
        "folder": "04-ai-tools-guide",
    },
    {
        "id": str(uuid.uuid4()),
        "email": "dr.mia.wellness@gmail.com",
        "username": "Dr. Mia Johnson",
        "bio": "Licensed clinical psychologist sharing evidence-based mental health strategies. Making therapy concepts practical and accessible.",
        "avatar_url": "https://api.dicebear.com/7.x/avataaars/svg?seed=MiaJohnson&backgroundColor=c1f4c5",
        "folder": "05-mental-health",
    },
    {
        "id": str(uuid.uuid4()),
        "email": "jake.m.biz@gmail.com",
        "username": "Jake Morrison",
        "bio": "Built 3 side hustles to $10K/month while keeping my day job. No fluff, just the playbook that actually works.",
        "avatar_url": "https://api.dicebear.com/7.x/avataaars/svg?seed=JakeMorrison&backgroundColor=ffdfbf",
        "folder": "06-side-hustles",
    },
    {
        "id": str(uuid.uuid4()),
        "email": "yuki.tanaka.edu@gmail.com",
        "username": "Yuki Tanaka",
        "bio": "Learning science researcher & lifelong student. I study how humans learn best and translate research into practical techniques.",
        "avatar_url": "https://api.dicebear.com/7.x/avataaars/svg?seed=YukiTanaka&backgroundColor=b6e3f4",
        "folder": "07-learning-methods",
    },
    {
        "id": str(uuid.uuid4()),
        "email": "rachel.kim.health@gmail.com",
        "username": "Rachel Kim",
        "bio": "Certified nutritionist & fitness coach. Evidence-based health advice without the fad diet nonsense.",
        "avatar_url": "https://api.dicebear.com/7.x/avataaars/svg?seed=RachelKim&backgroundColor=ffd5dc",
        "folder": "08-health-wellness",
    },
    {
        "id": str(uuid.uuid4()),
        "email": "david.o.comm@gmail.com",
        "username": "David Okafor",
        "bio": "Communication strategist & former diplomat. Teaching the soft skills that create hard results in your career and relationships.",
        "avatar_url": "https://api.dicebear.com/7.x/avataaars/svg?seed=DavidOkafor&backgroundColor=c0aede",
        "folder": "09-communication-skills",
    },
    {
        "id": str(uuid.uuid4()),
        "email": "natalie.p.trends@gmail.com",
        "username": "Natalie Petrova",
        "bio": "Tech industry analyst covering AI, SaaS, and emerging trends. Former strategy consultant. Data-driven takes on where tech is heading.",
        "avatar_url": "https://api.dicebear.com/7.x/avataaars/svg?seed=NataliePetrova&backgroundColor=d1d4f9",
        "folder": "10-industry-trends",
    },
]

# Category-level tags
CATEGORY_TAGS = {
    "01-personal-productivity": ["productivity", "time-management", "habits", "self-improvement"],
    "02-career-growth": ["career", "professional-development", "workplace", "job-search"],
    "03-personal-finance": ["finance", "investing", "budgeting", "money"],
    "04-ai-tools-guide": ["ai", "technology", "tools", "automation"],
    "05-mental-health": ["mental-health", "wellness", "psychology", "self-care"],
    "06-side-hustles": ["entrepreneurship", "side-hustle", "freelancing", "business"],
    "07-learning-methods": ["learning", "education", "study-tips", "self-improvement"],
    "08-health-wellness": ["health", "fitness", "nutrition", "wellness"],
    "09-communication-skills": ["communication", "soft-skills", "leadership", "relationships"],
    "10-industry-trends": ["tech-trends", "industry", "analysis", "future"],
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
        if len(para) > 30:  # Skip very short lines
            # Remove markdown formatting
            desc = re.sub(r"\*\*(.+?)\*\*", r"\1", para)
            desc = re.sub(r"\*(.+?)\*", r"\1", desc)
            desc = re.sub(r"`(.+?)`", r"\1", desc)
            desc = re.sub(r"\[(.+?)\]\(.+?\)", r"\1", desc)
            desc = desc.replace("--", "\u2014")
            if len(desc) > 300:
                # Cut at last sentence boundary before 300
                cut = desc[:300].rfind(". ")
                if cut > 100:
                    desc = desc[: cut + 1]
                else:
                    desc = desc[:297] + "..."
            return desc
    return ""


def extract_tags(filename: str, category_folder: str) -> list[str]:
    """Generate relevant tags from filename and category."""
    category_tags = CATEGORY_TAGS.get(category_folder, [])
    tags = list(category_tags[:2])  # Start with 2 category tags

    # Clean filename to slug
    slug = re.sub(r"^\d+-", "", filename.replace(".md", ""))

    # Known keyword mappings
    keyword_map = {
        "pomodoro": "pomodoro",
        "gtd": "gtd",
        "deep-work": "deep-work",
        "digital-minimalism": "minimalism",
        "habit": "habits",
        "morning-routine": "morning-routine",
        "time-blocking": "time-blocking",
        "interview": "interviews",
        "resume": "resume",
        "salary": "salary",
        "negotiat": "negotiation",
        "remote-work": "remote-work",
        "networking": "networking",
        "budget": "budgeting",
        "invest": "investing",
        "crypto": "crypto",
        "tax": "tax-strategy",
        "real-estate": "real-estate",
        "debt": "debt",
        "compound": "compound-interest",
        "financial-independence": "fire",
        "chatgpt": "chatgpt",
        "claude": "claude",
        "prompt": "prompt-engineering",
        "coding": "coding",
        "automat": "automation",
        "gpt": "gpt",
        "anxiety": "anxiety",
        "burnout": "burnout",
        "imposter": "imposter-syndrome",
        "mindful": "mindfulness",
        "boundar": "boundaries",
        "resilien": "resilience",
        "overthink": "overthinking",
        "freelanc": "freelancing",
        "saas": "saas",
        "passive-income": "passive-income",
        "monetiz": "monetization",
        "pricing": "pricing",
        "feynman": "feynman-technique",
        "spaced-repetition": "spaced-repetition",
        "active-recall": "active-recall",
        "second-brain": "second-brain",
        "speed-reading": "speed-reading",
        "language-learn": "language-learning",
        "sleep": "sleep",
        "exercise": "exercise",
        "nutrition": "nutrition",
        "fasting": "intermittent-fasting",
        "ergonomic": "ergonomics",
        "hydration": "hydration",
        "longevity": "longevity",
        "stress": "stress-management",
        "public-speaking": "public-speaking",
        "listening": "active-listening",
        "conflict": "conflict-resolution",
        "trust": "trust-building",
        "saying-no": "boundaries",
        "negotiation": "negotiation",
        "web3": "web3",
        "cybersecurity": "cybersecurity",
        "green-tech": "green-tech",
        "healthcare": "healthtech",
        "education-tech": "edtech",
        "geopolit": "geopolitics",
        "creator-economy": "creator-economy",
    }

    for keyword, tag in keyword_map.items():
        if keyword in slug and tag not in tags:
            tags.append(tag)
            if len(tags) >= 5:
                break

    # If still under 3 tags, extract from slug
    if len(tags) < 3:
        slug_words = slug.split("-")
        meaningful = [
            w
            for w in slug_words
            if len(w) > 3
            and w
            not in (
                "the", "and", "for", "with", "your", "from", "that",
                "what", "when", "how", "over", "guide", "practical",
                "advanced", "master", "masterclass", "playbook",
                "framework", "strategies", "complete", "ranked",
                "reality", "check", "simplified", "evidence", "based",
            )
        ]
        if meaningful:
            extra_tag = "-".join(meaningful[:2])
            if extra_tag not in tags:
                tags.append(extra_tag)

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
    print(f"Connecting to database...")
    conn = await asyncpg.connect(DATABASE_URL)

    try:
        # Safety check: don't double-seed
        existing = await conn.fetchval(
            "SELECT COUNT(*) FROM users WHERE email = ANY($1::text[])",
            [u["email"] for u in USERS],
        )
        if existing > 0:
            print(f"Found {existing} seed users already exist. Aborting to prevent duplicates.")
            return

        now = datetime.now(timezone.utc)
        total_articles = 0
        random.seed(42)  # Reproducible randomness

        for i, user in enumerate(USERS):
            print(f"\n{'='*60}")
            print(f"User {i+1}/10: {user['username']} ({user['email']})")
            print(f"{'='*60}")

            # Stagger user creation: 4 weeks ago to 1 week ago
            user_created = now - timedelta(days=28 - i * 2, hours=random.randint(0, 12))

            # Insert user
            await conn.execute(
                """
                INSERT INTO users (id, email, username, bio, avatar_url, is_verified, is_active, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, true, true, $6, $6)
                """,
                user["id"],
                user["email"],
                user["username"],
                user["bio"],
                user["avatar_url"],
                user_created,
            )

            # Read all articles for this user's category
            folder_path = os.path.join(CONTENT_DIR, user["folder"])
            if not os.path.isdir(folder_path):
                print(f"  WARNING: Folder not found: {folder_path}")
                continue

            md_files = sorted(f for f in os.listdir(folder_path) if f.endswith(".md"))
            print(f"  Found {len(md_files)} articles in {user['folder']}")

            for j, md_file in enumerate(md_files):
                file_path = os.path.join(folder_path, md_file)
                with open(file_path, "r", encoding="utf-8") as f:
                    md_content = f.read()

                # Extract metadata from markdown
                title = extract_title(md_content)
                description = extract_description(md_content)
                tags = extract_tags(md_file, user["folder"])
                html_content = md_to_html(md_content)

                # Generate IDs
                file_id = str(uuid.uuid4())
                share_id = str(uuid.uuid4())
                share_token = secrets.token_urlsafe(32)
                content_hash = hashlib.sha256(html_content.encode("utf-8")).hexdigest()

                # Stagger article publish dates (spread over a few days after user creation)
                article_published = user_created + timedelta(
                    days=j * random.uniform(0.3, 1.0),
                    hours=random.randint(6, 22),
                    minutes=random.randint(0, 59),
                )

                # Realistic view counts (older articles have more views)
                days_old = (now - article_published).days
                view_count = max(1, int(days_old * random.uniform(2, 15) + random.randint(5, 50)))

                # Create file
                await conn.execute(
                    """
                    INSERT INTO files (id, user_id, name, content, content_hash, is_folder, position, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, $5, false, $6, $7, $7)
                    """,
                    file_id,
                    user["id"],
                    f"{title}.md",
                    html_content,
                    content_hash,
                    j,
                    article_published,
                )

                # Create share (published to community)
                await conn.execute(
                    """
                    INSERT INTO document_shares
                        (id, file_id, user_id, share_token, is_active, content_mode,
                         visibility, is_published, title, description, tags,
                         published_at, view_count, fork_count, bookmark_count,
                         comment_count, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, true, 'live', 'public', true, $5, $6,
                            $7::json, $8, $9, 0, 0, 0, $8, $8)
                    """,
                    share_id,
                    file_id,
                    user["id"],
                    share_token,
                    title,
                    description,
                    json.dumps(tags),
                    article_published,
                    view_count,
                )

                total_articles += 1
                print(f"  [{j+1:2d}/10] {title}")
                print(f"         tags: {tags}")

        print(f"\n{'='*60}")
        print(f"DONE: Created 10 users and {total_articles} published articles")
        print(f"{'='*60}")

    except Exception as e:
        print(f"\nERROR: {e}")
        raise
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
