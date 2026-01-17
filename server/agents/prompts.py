"""System prompts for the writing agent.

This module provides backward-compatible wrappers for the new
prompts module structure. New code should import directly from
the prompts package.

The prompts have been restructured using industry-standard XML-tagged
format following Cursor/Claude Code conventions.
"""

from prompts.domains.edit import get_edit_instruction
from prompts.domains.writing import build_kb_context, build_writing_prompt


def get_writing_system_prompt(mode: str, files: list[dict]) -> str:
    """Generate system prompt for the writing agent with document editing capabilities.

    This prompt instructs the agent to act like "Cursor for Writing" - directly
    editing documents using tools rather than just suggesting changes.

    Args:
        mode: Agent mode ("edit" or "analyze")
        files: List of file contexts

    Returns:
        System prompt string
    """
    return build_writing_prompt(mode, files)


# Keep the old function for backward compatibility
def get_system_prompt(mode: str, files: list[dict]) -> str:
    """Legacy system prompt function - redirects to new one."""
    return build_writing_prompt(mode, files)


def get_kb_context_prompt(attachments: list[dict]) -> str:
    """Generate KB context section for system prompt.

    Args:
        attachments: List of attachment dicts with 'filename', 'file_type', 'chunk_count'

    Returns:
        KB context prompt section
    """
    return build_kb_context(attachments)


def get_skills_metadata_prompt(skills: list[dict]) -> str:
    """Generate skills metadata with clear usage guidance for system prompt.

    This enables skill discovery and provides explicit workflow instructions
    for when and how to use each type of skill resource.

    Args:
        skills: List of skill metadata dicts with 'name', 'description',
                'templates', 'knowledge' keys

    Returns:
        Skills metadata prompt section with usage guidance
    """
    if not skills:
        return ""

    prompt = """
<available_skills>
You have access to specialized writing skills. Each skill provides three types of resources:

| Resource Type | Tool | Purpose |
|---------------|------|---------|
| **Instructions** | `read_skill_instructions` | Domain expertise, workflow guidance, HOW to approach tasks |
| **Templates** | `read_skill_template` | Document structure, outlines, WHAT sections to include |
| **Knowledge** | `read_skill_knowledge` | Reference materials, citation formats, best practices |

<skill_usage_workflow>
When a user's request matches a skill domain, follow this workflow:

1. **FIRST**: Use `read_skill_instructions(skill_name)` to load expert guidance
   - This is REQUIRED before starting any skill-related task
   - Provides domain expertise, workflow steps, and guidelines
   - Helps you understand the proper approach

2. **THEN**: Use `read_skill_template(skill_name, template_name)` for structure
   - When creating new documents or outlines
   - When following standard formats (essay structure, report format)
   - Provides fill-in-the-blank frameworks

3. **ALSO**: Use `read_skill_knowledge(skill_name, knowledge_name)` for reference
   - When you need citation format rules (APA, MLA, etc.)
   - When you need academic phrases, transitions, or style tips
   - When you need best practices for specific writing tasks
</skill_usage_workflow>

<usage_examples>
Example 1: User asks "Write an argumentative essay"
→ read_skill_instructions("essay-writing") - get expert guidance
→ read_skill_template("essay-writing", "argumentative.md") - get structure
→ read_skill_knowledge("essay-writing", "academic_phrases.md") - get phrases (if needed)

Example 2: User asks "Format this citation in APA style"
→ read_skill_knowledge("essay-writing", "citation_apa.md") - get citation rules

Example 3: User asks "Write a blog post"
→ read_skill_instructions("content-writing") - get content writing expertise
→ read_skill_template("content-writing", "blog_post.md") - get blog structure
→ read_skill_knowledge("content-writing", "seo_writing.md") - get SEO tips
</usage_examples>

Available Skills:
"""
    for skill in skills:
        name = skill.get("name", "")
        description = skill.get("description", "")
        templates = skill.get("templates", [])
        knowledge = skill.get("knowledge", [])
        prompt += f"""
**{name}**: {description}
  - Templates: {', '.join(templates) if templates else 'none'}
  - Knowledge: {', '.join(knowledge) if knowledge else 'none'}
"""

    prompt += "</available_skills>\n"
    return prompt


def get_quick_edit_prompt(action: str) -> str:
    """Get prompt for quick edit actions.

    Args:
        action: Edit action type

    Returns:
        Prompt string
    """
    return get_edit_instruction(action)
