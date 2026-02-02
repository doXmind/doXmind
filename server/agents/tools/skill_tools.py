"""Skill tools for accessing skill instructions, templates, and knowledge files.

These tools allow the agent to access all skill resources directly:
- Instructions: Domain expertise and workflow guidance from SKILL.md
- Templates: Document structure and outlines
- Knowledge: Reference materials and best practices
"""

import logging
from typing import Any

from agents.tools.definitions import SKILL_EXTERNAL_TOOLS
from config import get_settings
from services.skills_service import get_skills_service

logger = logging.getLogger(__name__)

# Tool names for skill operations
SKILL_TOOL_NAMES = {
    "list_skills",
    "read_skill_instructions",
    "read_skill_template",
    "read_skill_knowledge",
}


def is_skill_tool(tool_name: str) -> bool:
    """Check if a tool is a skill-related tool.

    Args:
        tool_name: Name of the tool

    Returns:
        True if the tool is a skill tool
    """
    return tool_name in SKILL_TOOL_NAMES


async def execute_skill_tool(
    tool_name: str,
    tool_input: dict[str, Any],
) -> dict[str, Any]:
    """Execute a skill tool and return results.

    Args:
        tool_name: Name of the tool to execute
        tool_input: Input parameters for the tool

    Returns:
        Result dictionary with 'result' or 'error' key
    """
    service = get_skills_service()

    if tool_name == "list_skills":
        skills = service.list_skills()
        return {"result": skills}

    elif tool_name == "read_skill_instructions":
        skill_name = tool_input.get("skill_name")

        if not skill_name:
            return {"error": "skill_name is required"}

        instructions = service.get_skill_instructions(skill_name)
        if instructions is None:
            available = [s["name"] for s in service.list_skills()]
            return {"error": f"Skill not found: {skill_name}. Available: {', '.join(available)}"}

        # Check if this skill has external tools that should be activated
        external_tools = SKILL_EXTERNAL_TOOLS.get(skill_name, [])
        tool_notice = ""
        if external_tools:
            settings = get_settings()
            # Check if required API key/feature is configured
            if skill_name == "legal" and settings.has_legal_tools:
                tool_notice = """
---
**LEGAL TOOLS AVAILABLE:**
1. `search_court_opinions(query)` - Search cases. Returns list with opinion_id.
2. `get_court_opinion(opinion_id)` - Get full opinion text.

Workflow: Search → Pick relevant cases → Get full text for citation.
---

"""
            elif skill_name == "data-analysis" and settings.code_execution_enabled:
                tool_notice = """
---
**DATA ANALYSIS TOOLS AVAILABLE:**
1. `list_data_files()` - List all data files in this conversation

**Workflow:**
1. Call `list_data_files()` to discover available files
2. Use code execution to load and analyze with pandas
3. Files are at: `/mnt/user/<filename>`
---

"""

        # Put tool notice at the BEGINNING so agent sees it first
        return {"result": tool_notice + instructions}

    elif tool_name == "read_skill_template":
        skill_name = tool_input.get("skill_name")
        template_name = tool_input.get("template_name")

        if not skill_name:
            return {"error": "skill_name is required"}
        if not template_name:
            return {"error": "template_name is required"}

        content = service.load_skill_resource(skill_name, template_name)
        if content is None:
            # Check if skill exists
            skill = service.get_skill(skill_name)
            if not skill:
                available = [s["name"] for s in service.list_skills()]
                return {
                    "error": f"Skill not found: {skill_name}. Available: {', '.join(available)}"
                }
            return {"error": f"Template not found: {template_name}"}

        return {"result": content}

    elif tool_name == "read_skill_knowledge":
        skill_name = tool_input.get("skill_name")
        knowledge_name = tool_input.get("knowledge_name")

        if not skill_name:
            return {"error": "skill_name is required"}
        if not knowledge_name:
            return {"error": "knowledge_name is required"}

        content = service.load_skill_resource(skill_name, knowledge_name)
        if content is None:
            # Check if skill exists
            skill = service.get_skill(skill_name)
            if not skill:
                available = [s["name"] for s in service.list_skills()]
                return {
                    "error": f"Skill not found: {skill_name}. Available: {', '.join(available)}"
                }
            return {"error": f"Knowledge file not found: {knowledge_name}"}

        return {"result": content}

    return {"error": f"Unknown skill tool: {tool_name}"}
