#!/usr/bin/env python3
"""Seed high-quality comments for all published community articles."""

import asyncio
import json
import os
import random
import uuid
from datetime import UTC, datetime, timedelta

import asyncpg

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://doxmind:doxmind@postgres:5432/doxmind")
if "asyncpg" in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")

# ---------------------------------------------------------------------------
# Comment pools – keyed by tag keywords so comments match article topics
# ---------------------------------------------------------------------------

TOPIC_COMMENTS = {
    "productivity": [
        "This completely changed how I think about my mornings. I used to chase the 5 AM club mentality but switching to consistent wake times made a huge difference.",
        "The section on energy management vs time management really clicked for me. I've been tracking my energy levels for a week and it's eye-opening.",
        "I tried the time-blocking approach described here and my deep work sessions went from ~1 hour to nearly 3 hours. The key was batching meetings.",
        "Love the practical approach. Most productivity content is aspirational nonsense — this actually gives you a system you can start today.",
        "The point about fake productivity hit hard. I realized I spend half my day on 'productive procrastination' — looking busy but not moving the needle.",
        "Would love to see a follow-up on how to maintain these systems long-term. I always start strong then fall off after 2-3 weeks.",
        "Shared this with my entire team. The weekly review framework alone is worth implementing across our org.",
        "Finally someone who acknowledges that digital minimalism doesn't mean going off the grid. The practical phone setup tips are gold.",
        "I've tried GTD three times and failed. This breakdown finally made the capture-and-process loop intuitive. Thank you!",
        "The habit stacking concept paired with implementation intentions has been a game-changer for my exercise routine.",
    ],
    "career": [
        "Used the STAR method framework from this article in my interview last week and got the offer. The 'situation-complication-resolution' variant is brilliant.",
        "As a hiring manager, I can confirm — the resume tips here are exactly what gets past the initial screen. Quantified achievements always win.",
        "The salary negotiation section should be mandatory reading. I left $15K on the table at my last job because I didn't know how to counter.",
        "I'm 6 months into my career transition from finance to tech and this roadmap is almost exactly what I followed. Can confirm it works.",
        "The 'managing up' framework changed my relationship with my director. Being proactive about alignment saves so much friction.",
        "This is the networking advice introverts actually need. The 'give first' approach feels authentic rather than transactional.",
        "I just finished my first year at a new company and wish I had this guide on day one. The 30-60-90 day plan section is perfect.",
        "The decision framework for when to quit is incredibly valuable. Too many people stay in toxic jobs out of fear or leave good jobs out of impatience.",
        "Great point about remote work visibility. I started sending weekly async updates to leadership and it completely changed my trajectory.",
        "Bookmarking this for my next performance review cycle. The documentation strategy alone is worth gold.",
    ],
    "finance": [
        "The 50/30/20 adaptation for irregular income is something I've never seen covered elsewhere. As a freelancer, this is exactly what I needed.",
        "Started index fund investing after reading this 8 months ago. Up 12% with zero stress. Should have started years ago.",
        "The compound interest visualization really drives the point home. Showing the actual dollar difference between starting at 25 vs 35 is powerful.",
        "Love the honest take on crypto. Not blindly bullish or bearish — just a rational framework for position sizing.",
        "Tax optimization strategies here are legitimate and practical. Saved about $3K last year just by maximizing my HSA properly.",
        "The real estate vs stocks comparison is the most balanced analysis I've seen. No agenda, just data.",
        "I used the debt payoff calculator approach and paid off $22K in student loans in 18 months. The avalanche method really does save more in interest.",
        "This emergency fund strategy finally gave me a framework I could follow. 3 months in a HYSA, then build from there. Simple and effective.",
        "Multiple income streams article is refreshingly honest about the effort required. No get-rich-quick promises.",
        "The FIRE roadmap is realistic — I appreciate that it acknowledges the trade-offs and doesn't pretend everyone can retire at 35.",
    ],
    "ai": [
        "The ChatGPT vs Claude comparison is the most practical one I've read. The workflow-specific recommendations are spot on.",
        "I implemented the prompt engineering techniques at work and my AI output quality improved dramatically. Chain-of-thought prompting is a game-changer.",
        "As a non-technical PM, the AI data analysis guide opened up capabilities I didn't know I had. I'm now doing analysis that used to require a data team.",
        "The AI coding assistant comparison is timely. Switched from Copilot to Cursor based on this and the contextual awareness is noticeably better.",
        "Love the honest assessment of AI automation — not everything should be automated and the human-in-the-loop emphasis is important.",
        "Building a custom GPT for our customer support workflow saved 15 hours per week. The step-by-step guide made it straightforward.",
        "The 'future-proofing' career advice is the sanest take I've seen. Focus on judgment and creativity, not just technical skills.",
        "AI for meetings and email article is incredibly practical. Auto-summarizing meeting notes alone has been worth it.",
        "Used the image generation guide for our marketing assets. Quality is impressive for social media content.",
        "Great overview of the AI landscape. The capability matrix comparing different tools for different use cases is super helpful.",
    ],
    "mental-health": [
        "The CBT-based anxiety toolkit is exactly what my therapist recommended but explained in a way that makes it immediately actionable.",
        "The overthinking cycle diagram really resonated. Recognizing rumination vs problem-solving has been transformative for me.",
        "As someone who struggled with burnout for months, this recovery guide gave me permission to actually rest. The 90-day timeline is realistic.",
        "The imposter syndrome reframing techniques are brilliant. I still have the thoughts, but they no longer control my decisions.",
        "Mindfulness for skeptics is exactly the approach I needed. The scientific framing without the spiritual baggage made me actually try it.",
        "Setting boundaries without guilt — the scripts for different scenarios are incredibly useful. I've literally used the 'work request' script twice this week.",
        "The social anxiety exposure hierarchy is smart. Starting with low-stakes situations and building up gradually actually works.",
        "The emotional regulation framework is something I wish I'd learned in school. The STOP technique is now my go-to in heated moments.",
        "Really appreciate the nuanced take on digital mental health. It's not 'phones bad' — it's about intentional usage patterns.",
        "The resilience-building exercises are practical and evidence-based. The post-traumatic growth concept was new to me and very empowering.",
    ],
    "entrepreneurship": [
        "Landed my first freelance client within 3 weeks using the cold outreach templates. The personalization framework makes all the difference.",
        "The micro-SaaS guide is the most practical walkthrough I've seen. Currently at $2K MRR following this approach.",
        "Freelance pricing section hit hard. I was charging hourly and leaving money on the table. Switched to value-based pricing and doubled my income.",
        "The passive income reality check is refreshingly honest. Nothing is truly passive — but some income streams require less ongoing effort than others.",
        "As a developer, the side hustle ranking matches my experience. Open-source consulting and SaaS are definitely the highest ROI.",
        "Content monetization playbook is gold. The newsletter economics breakdown showing actual numbers is rare and incredibly useful.",
        "Productized services was a concept I hadn't considered. Packaging my consulting into a fixed-price offer simplified everything.",
        "The transition from side hustle to full-time framework gave me the confidence to finally make the leap. The financial runway calculation was key.",
        "Balancing a day job with a side hustle is genuinely hard. The time-blocking approach specifically for side projects was a practical solution.",
        "The zero-cost business ideas aren't the usual dropshipping nonsense. Service-based businesses are genuinely the fastest path to first revenue.",
    ],
    "learning": [
        "The Feynman Technique article helped me ace my certification exam. Teaching concepts to an imaginary student exposed all my knowledge gaps.",
        "Started using Anki with the spaced repetition system described here. My retention of medical terminology went from ~40% to 85%.",
        "30-day skill acquisition framework is practical. Used it to learn Python and built my first automation script in exactly 30 days.",
        "Active recall study method completely replaced my highlighting habit. My exam scores improved by a full letter grade.",
        "Building a second brain with the PARA method finally tamed my 500+ browser tabs and scattered notes. Everything has a home now.",
        "Deliberate practice breakdown was eye-opening. I was just putting in hours without intentional focus on weaknesses.",
        "The 'tutorial hell' escape plan is exactly what every self-taught developer needs. Building projects > watching tutorials.",
        "Speed reading vs deep reading distinction is important. I was trying to speed-read textbooks when I should have been doing active recall.",
        "Used the language learning approach for Japanese. Conversational in 5 months — the input-heavy first phase was counterintuitive but effective.",
        "Meta-learning concept is powerful. Learning how to learn before diving into a subject saves enormous time downstream.",
    ],
    "health": [
        "Sleep optimization guide fixed my chronic 5-hour nights. The temperature and light protocol made the biggest difference.",
        "As a software engineer sitting 10+ hours a day, the desk worker exercise plan is essential. The micro-movement breaks prevent my back pain.",
        "Nutrition science article cuts through so much diet industry BS. 'Eat mostly whole foods, enough protein, and stop stressing' — simple and effective.",
        "The 5-minute stress techniques actually work in a meeting. Box breathing has saved me from several potential meltdowns.",
        "Went from zero exercise to 4x/week gym habit using the 8-week progressive approach. The key was starting embarrassingly small.",
        "Intermittent fasting article is the most balanced take I've read. Not a miracle cure, but a useful tool for some people in some contexts.",
        "Ergonomic workspace guide prompted me to invest in a proper setup. My neck pain disappeared within 2 weeks of adjustments.",
        "The hydration-energy connection was surprising. I was chronically dehydrated and blaming everything on poor sleep.",
        "Mind-body connection piece reinforced why I prioritize exercise even on busy days. The cognitive benefits are real and measurable.",
        "Evidence-based longevity habits — finally, advice backed by actual research instead of biohacker bro science.",
    ],
    "communication": [
        "High-EQ communication framework saved a client relationship last month. The 'acknowledge before redirecting' technique is powerful.",
        "The scripts for saying no are getting regular use. Having pre-prepared responses removes the guilt and awkwardness.",
        "Managing up through communication resonates deeply. Proactive status updates eliminated 80% of check-in meetings with my manager.",
        "DEAR MAN framework for difficult conversations is brilliant. Used it to address a salary issue and got a 15% raise.",
        "Active listening section exposed how much I was just waiting for my turn to talk. The paraphrase-and-validate approach builds so much trust.",
        "Public speaking tips actually helped. The reframing from 'performance' to 'conversation with the audience' reduced my anxiety significantly.",
        "Written communication at work — the email framework alone saves me 30 minutes a day. Bottom Line Up Front changed my executive communication.",
        "Conflict resolution article should be required reading in every workplace. The interest-based approach beats positional bargaining every time.",
        "Building trust rapidly applies to sales too. The vulnerability-competence balance is a nuanced insight I haven't seen elsewhere.",
        "Negotiation in everyday life showed me I was leaving value on the table in basic interactions. The anchoring technique works everywhere.",
    ],
    "tech-trends": [
        "The AI landscape analysis is the clearest industry map I've seen. The distinction between foundational model companies and application layer is key.",
        "SaaS market evolution piece captures the shift perfectly. Efficient growth > growth at all costs is the new reality.",
        "Remote work predictions backed by data rather than opinion. The hybrid model analysis aligns with what I'm seeing at Fortune 500 companies.",
        "Creator economy deep dive exposes how top-heavy the income distribution really is. The '1000 true fans' update is sobering.",
        "Web3 reality check is the balanced take we need. Separating blockchain utility from speculative nonsense helps focus on actual innovation.",
        "Cybersecurity overview is comprehensive without being alarmist. The zero-trust architecture recommendations are practical for mid-size companies.",
        "Green tech investment analysis identifies sectors I hadn't considered. Grid-scale battery storage seems like a clear opportunity.",
        "Healthcare tech article captures the massive potential while acknowledging regulatory and adoption challenges. Realistic and informative.",
        "EdTech analysis separates the hype from genuine improvements. AI tutoring and adaptive learning are the real game-changers.",
        "Geopolitics of tech piece provides crucial context. The semiconductor supply chain analysis is especially relevant right now.",
    ],
}

# Universal comments that work for any article
UNIVERSAL_COMMENTS = [
    "Incredibly well-researched article. Bookmarked for future reference — this is the kind of content that ages well.",
    "This is the most practical guide I've found on this topic. Saving this to share with my team.",
    "Appreciate the no-BS approach. Most content in this space is either too superficial or too theoretical — this hits the sweet spot.",
    "Read this at exactly the right time. Going to implement the key takeaways starting this week.",
    "The frameworks here are immediately actionable. That's rare for long-form content. Well done.",
    "Shared this with three colleagues already. The structured approach makes it easy to follow and apply.",
    "This deserves way more visibility. Quality content like this gets buried under clickbait too often.",
    "Came back to re-read this after implementing some of the advice. It works. Thank you for putting this together.",
    "Clear, structured, and backed by evidence. Exactly the kind of writing the internet needs more of.",
    "Just finished reading the whole thing. Dense with value — every section had at least one actionable takeaway.",
]


def get_comments_for_tags(tags: list[str]) -> list[str]:
    """Get relevant comments based on article tags."""
    pool = list(UNIVERSAL_COMMENTS)  # Always include universal comments

    # Map tags to topic comment pools
    tag_to_topic = {
        "productivity": "productivity",
        "time-management": "productivity",
        "habits": "productivity",
        "self-improvement": "productivity",
        "career": "career",
        "professional-development": "career",
        "workplace": "career",
        "job-search": "career",
        "finance": "finance",
        "investing": "finance",
        "budgeting": "finance",
        "money": "finance",
        "ai": "ai",
        "technology": "ai",
        "tools": "ai",
        "automation": "ai",
        "mental-health": "mental-health",
        "psychology": "mental-health",
        "self-care": "mental-health",
        "entrepreneurship": "entrepreneurship",
        "side-hustle": "entrepreneurship",
        "freelancing": "entrepreneurship",
        "business": "entrepreneurship",
        "learning": "learning",
        "education": "learning",
        "study-tips": "learning",
        "health": "health",
        "fitness": "health",
        "nutrition": "health",
        "wellness": "health",
        "communication": "communication",
        "soft-skills": "communication",
        "leadership": "communication",
        "relationships": "communication",
        "tech-trends": "tech-trends",
        "industry": "tech-trends",
        "analysis": "tech-trends",
        "future": "tech-trends",
    }

    matched_topics = set()
    for tag in tags:
        topic = tag_to_topic.get(tag)
        if topic and topic not in matched_topics:
            matched_topics.add(topic)
            pool.extend(TOPIC_COMMENTS[topic])

    return pool


async def main():
    print("Connecting to database...")
    conn = await asyncpg.connect(DATABASE_URL)

    try:
        # Get all users (for commenting)
        users = await conn.fetch("SELECT id, username FROM users")
        user_list = [(r["id"], r["username"]) for r in users]
        print(f"Found {len(user_list)} users")

        # Get all published shares with their authors and tags
        shares = await conn.fetch("""
            SELECT ds.id, ds.title, ds.tags, ds.user_id, ds.published_at
            FROM document_shares ds
            WHERE ds.is_published = true AND ds.is_active = true
            ORDER BY ds.published_at ASC
        """)
        print(f"Found {len(shares)} published articles\n")

        random.seed(123)  # Reproducible
        now = datetime.now(UTC)
        total_comments = 0

        for share in shares:
            share_id = share["id"]
            author_id = share["user_id"]
            title = share["title"] or "Untitled"
            published_at = share["published_at"]
            tags_raw = share["tags"]

            # Parse tags
            if isinstance(tags_raw, str):
                tags = json.loads(tags_raw)
            elif isinstance(tags_raw, list):
                tags = tags_raw
            else:
                tags = []

            # Random 1-5 comments per article
            num_comments = random.randint(1, 5)

            # Get potential commenters (exclude author)
            commenters = [(uid, uname) for uid, uname in user_list if uid != author_id]
            if not commenters:
                continue

            # Select random commenters (with possible repeats if >len)
            selected_commenters = random.sample(commenters, min(num_comments, len(commenters)))
            if len(selected_commenters) < num_comments:
                selected_commenters += random.choices(
                    commenters, k=num_comments - len(selected_commenters)
                )

            # Get relevant comment pool
            comment_pool = get_comments_for_tags(tags)
            selected_comments = random.sample(comment_pool, min(num_comments, len(comment_pool)))

            print(f"[{num_comments} comments] {title[:60]}")

            for comment_text, (commenter_id, _) in zip(
                selected_comments, selected_commenters, strict=False
            ):
                comment_id = str(uuid.uuid4())

                # Comment appears sometime after publication
                days_since_publish = max(1, (now - published_at).days)
                comment_offset = timedelta(
                    days=random.uniform(0.5, min(days_since_publish, 14)),
                    hours=random.randint(0, 23),
                    minutes=random.randint(0, 59),
                )
                comment_time = published_at + comment_offset
                if comment_time > now:
                    comment_time = now - timedelta(hours=random.randint(1, 48))

                await conn.execute(
                    """
                    INSERT INTO comments (id, share_id, user_id, content, is_deleted, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, false, $5, $5)
                    """,
                    comment_id,
                    share_id,
                    commenter_id,
                    comment_text,
                    comment_time,
                )
                total_comments += 1

            # Update comment_count on the share
            await conn.execute(
                "UPDATE document_shares SET comment_count = $1 WHERE id = $2",
                num_comments,
                share_id,
            )

        print(f"\n{'=' * 60}")
        print(f"DONE: Added {total_comments} comments across {len(shares)} articles")
        print(f"{'=' * 60}")

    except Exception as e:
        print(f"\nERROR: {e}")
        raise
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
