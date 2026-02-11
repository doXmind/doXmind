"""Skills API endpoints.

Provides REST API for listing and accessing skills.
"""

import logging

from fastapi import APIRouter
from pydantic import BaseModel

from exceptions import NotFoundError
from services.skills_service import get_skills_service

logger = logging.getLogger(__name__)
router = APIRouter()


# ============================================================================
# Response Models
# ============================================================================


class SkillSummary(BaseModel):
    """Summary of a skill for listing."""

    name: str
    display_name: str
    description: str
    category: str
    icon: str
    version: str
    templates: list[str]
    knowledge: list[str]


class SkillListResponse(BaseModel):
    """Response for skill listing endpoint."""

    skills: list[SkillSummary]
    count: int


class SkillDetailResponse(BaseModel):
    """Detailed skill response including instructions."""

    name: str
    display_name: str
    description: str
    category: str
    icon: str
    version: str
    author: str
    instructions: str
    templates: list[str]
    knowledge: list[str]


class ResourceContentResponse(BaseModel):
    """Response for resource content endpoint."""

    name: str
    resource_type: str
    content: str


# ============================================================================
# Endpoints
# ============================================================================


@router.get("/", response_model=SkillListResponse)
async def list_skills():
    """List all available skills with metadata.

    Returns a list of skills with their names, descriptions, and
    available resources (templates and knowledge files).
    """
    service = get_skills_service()
    skills = service.list_skills()
    return SkillListResponse(skills=skills, count=len(skills))


@router.get("/{skill_name}", response_model=SkillDetailResponse)
async def get_skill(skill_name: str):
    """Get full skill details including instructions.

    Args:
        skill_name: Name of the skill (e.g., "essay-writing")

    Returns:
        Full skill details with instructions

    Raises:
        NotFoundError: 404 if skill not found
    """
    service = get_skills_service()
    skill = service.get_skill(skill_name)

    if not skill:
        raise NotFoundError(message=f"Skill not found: {skill_name}")

    return SkillDetailResponse(
        name=skill.metadata.name,
        display_name=skill.metadata.display_name,
        description=skill.metadata.description,
        category=skill.metadata.category,
        icon=skill.metadata.icon,
        version=skill.metadata.version,
        author=skill.metadata.author,
        instructions=skill.instructions,
        templates=[t.name for t in skill.templates],
        knowledge=[k.name for k in skill.knowledge],
    )


@router.get(
    "/{skill_name}/resources/{resource_name}",
    response_model=ResourceContentResponse,
)
async def get_skill_resource(skill_name: str, resource_name: str):
    """Get a specific skill resource (template or knowledge file).

    Args:
        skill_name: Name of the skill
        resource_name: Name of the resource file (e.g., "argumentative.md")

    Returns:
        Resource content with metadata

    Raises:
        NotFoundError: 404 if skill or resource not found
    """
    service = get_skills_service()

    # Check skill exists
    skill = service.get_skill(skill_name)
    if not skill:
        raise NotFoundError(message=f"Skill not found: {skill_name}")

    # Load resource content
    content = service.load_skill_resource(skill_name, resource_name)
    if content is None:
        raise NotFoundError(message=f"Resource not found: {resource_name}")

    # Determine resource type
    resource_type = "unknown"
    for t in skill.templates:
        if t.name == resource_name:
            resource_type = "template"
            break
    for k in skill.knowledge:
        if k.name == resource_name:
            resource_type = "knowledge"
            break

    return ResourceContentResponse(
        name=resource_name,
        resource_type=resource_type,
        content=content,
    )
