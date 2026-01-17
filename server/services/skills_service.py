"""Skills Service - Loading, parsing, and management of skills.

Skills are markdown files with YAML frontmatter that teach the agent
how to handle specific writing tasks like essay writing or research analysis.
"""

import logging
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import yaml

logger = logging.getLogger(__name__)

# Skills directory relative to server/
SKILLS_DIR = Path(__file__).parent.parent / "skills"


@dataclass
class SkillMetadata:
    """Metadata parsed from SKILL.md frontmatter."""

    name: str
    display_name: str
    description: str
    category: str
    version: str = "1.0.0"
    author: str = "unknown"
    icon: str = ""


@dataclass
class SkillResource:
    """A template or knowledge file within a skill."""

    name: str
    path: str
    resource_type: str  # "template" | "knowledge"
    content: str | None = None  # Loaded on demand


@dataclass
class Skill:
    """A complete skill with metadata, instructions, and resources."""

    metadata: SkillMetadata
    instructions: str
    templates: list[SkillResource] = field(default_factory=list)
    knowledge: list[SkillResource] = field(default_factory=list)


class SkillsService:
    """Service for loading and managing skills.

    Implements singleton pattern and lazy loading for skill resources.
    """

    _instance = None
    _skills: dict[str, Skill] = {}
    _initialized = False

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if not SkillsService._initialized:
            self._load_all_skills()
            SkillsService._initialized = True

    def _parse_skill_file(self, skill_path: Path) -> tuple[SkillMetadata, str]:
        """Parse SKILL.md file extracting frontmatter and content.

        Args:
            skill_path: Path to the SKILL.md file

        Returns:
            Tuple of (metadata, instructions)

        Raises:
            ValueError: If no frontmatter found
        """
        content = skill_path.read_text(encoding="utf-8")

        # Extract YAML frontmatter between --- markers
        frontmatter_match = re.match(
            r"^---\s*\n(.*?)\n---\s*\n", content, re.DOTALL
        )
        if not frontmatter_match:
            raise ValueError(f"No frontmatter found in {skill_path}")

        frontmatter = yaml.safe_load(frontmatter_match.group(1))
        instructions = content[frontmatter_match.end() :].strip()

        metadata = SkillMetadata(
            name=frontmatter.get("name", skill_path.parent.name),
            display_name=frontmatter.get(
                "display_name", frontmatter.get("name", "")
            ),
            description=frontmatter.get("description", ""),
            category=frontmatter.get("category", "general"),
            version=frontmatter.get("version", "1.0.0"),
            author=frontmatter.get("author", "unknown"),
            icon=frontmatter.get("icon", ""),
        )

        return metadata, instructions

    def _discover_resources(
        self, skill_dir: Path
    ) -> tuple[list[SkillResource], list[SkillResource]]:
        """Discover templates and knowledge files for a skill.

        Args:
            skill_dir: Path to the skill directory

        Returns:
            Tuple of (templates, knowledge)
        """
        templates = []
        knowledge = []

        templates_dir = skill_dir / "templates"
        if templates_dir.exists():
            for f in templates_dir.glob("*.md"):
                templates.append(
                    SkillResource(
                        name=f.name,
                        path=str(f.relative_to(skill_dir)),
                        resource_type="template",
                    )
                )

        knowledge_dir = skill_dir / "knowledge"
        if knowledge_dir.exists():
            for f in knowledge_dir.glob("*.md"):
                knowledge.append(
                    SkillResource(
                        name=f.name,
                        path=str(f.relative_to(skill_dir)),
                        resource_type="knowledge",
                    )
                )

        return templates, knowledge

    def _load_all_skills(self):
        """Scan skills directory and load all skill metadata."""
        if not SKILLS_DIR.exists():
            logger.warning(f"Skills directory not found: {SKILLS_DIR}")
            return

        for skill_dir in SKILLS_DIR.iterdir():
            if not skill_dir.is_dir():
                continue

            skill_file = skill_dir / "SKILL.md"
            if not skill_file.exists():
                continue

            try:
                metadata, instructions = self._parse_skill_file(skill_file)
                templates, knowledge = self._discover_resources(skill_dir)

                skill = Skill(
                    metadata=metadata,
                    instructions=instructions,
                    templates=templates,
                    knowledge=knowledge,
                )

                self._skills[metadata.name] = skill
                logger.info(
                    f"Loaded skill: {metadata.name} "
                    f"({len(templates)} templates, {len(knowledge)} knowledge files)"
                )

            except Exception as e:
                logger.error(f"Failed to load skill from {skill_dir}: {e}")

    def list_skills(self) -> list[dict]:
        """Return list of available skills with metadata only (no content).

        Returns:
            List of skill summary dictionaries
        """
        return [
            {
                "name": s.metadata.name,
                "display_name": s.metadata.display_name,
                "description": s.metadata.description,
                "category": s.metadata.category,
                "icon": s.metadata.icon,
                "version": s.metadata.version,
                "templates": [t.name for t in s.templates],
                "knowledge": [k.name for k in s.knowledge],
            }
            for s in self._skills.values()
        ]

    def get_skill(self, name: str) -> Skill | None:
        """Get a skill by name.

        Args:
            name: Skill name (e.g., "essay-writing")

        Returns:
            Skill object or None if not found
        """
        return self._skills.get(name)

    def get_skill_instructions(self, name: str) -> str | None:
        """Get skill instructions (main SKILL.md content after frontmatter).

        Args:
            name: Skill name

        Returns:
            Instructions string or None if skill not found
        """
        skill = self._skills.get(name)
        return skill.instructions if skill else None

    def load_skill_resource(
        self, skill_name: str, resource_name: str
    ) -> str | None:
        """Load a specific resource file content (progressive disclosure).

        Args:
            skill_name: Name of the skill
            resource_name: Name of the resource file (e.g., "argumentative.md")

        Returns:
            Resource content or None if not found
        """
        skill = self._skills.get(skill_name)
        if not skill:
            return None

        # Search in templates and knowledge
        for resource in skill.templates + skill.knowledge:
            if resource.name == resource_name:
                if resource.content is None:
                    # Load on demand
                    resource_path = SKILLS_DIR / skill_name / resource.path
                    if resource_path.exists():
                        resource.content = resource_path.read_text(
                            encoding="utf-8"
                        )
                return resource.content

        return None

    def get_skills_by_category(self, category: str) -> list[Skill]:
        """Get all skills in a category.

        Args:
            category: Category name (e.g., "academic", "research")

        Returns:
            List of skills in the category
        """
        return [
            s for s in self._skills.values() if s.metadata.category == category
        ]


@lru_cache
def get_skills_service() -> SkillsService:
    """Get singleton skills service instance.

    Returns:
        SkillsService instance
    """
    return SkillsService()
