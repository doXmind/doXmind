"""Base utilities for prompt building.

Provides a builder pattern for constructing structured prompts
with variable substitution and XML tag wrapping.
"""

import re


class BasePromptBuilder:
    """Build structured prompts with variable substitution.

    Example:
        builder = BasePromptBuilder(template)
        builder.set("mode", "edit").set("context", "...").build()
    """

    def __init__(self, template: str):
        """Initialize with a template containing {{variable}} placeholders."""
        self.template = template
        self.variables: dict[str, str] = {}

    def set(self, key: str, value: str) -> "BasePromptBuilder":
        """Set a variable value for substitution."""
        self.variables[key] = value
        return self

    def set_many(self, **kwargs: str) -> "BasePromptBuilder":
        """Set multiple variables at once."""
        self.variables.update(kwargs)
        return self

    def build(self) -> str:
        """Build the final prompt with all variables replaced.

        Unreplaced placeholders are removed from the output.
        """
        result = self.template
        for key, value in self.variables.items():
            placeholder = "{{" + key + "}}"
            result = result.replace(placeholder, value)
        # Remove any remaining unreplaced placeholders
        result = re.sub(r"\{\{[^}]+\}\}", "", result)
        return result.strip()

    @staticmethod
    def wrap_section(name: str, content: str) -> str:
        """Wrap content in XML tags.

        Args:
            name: Tag name (e.g., "constraints")
            content: Content to wrap

        Returns:
            Wrapped content or empty string if content is empty
        """
        if not content.strip():
            return ""
        return f"<{name}>\n{content}\n</{name}>"


def format_list(items: list[str], numbered: bool = False) -> str:
    """Format a list of items.

    Args:
        items: List of strings
        numbered: Use numbered list (1. 2. 3.) instead of bullets (-)

    Returns:
        Formatted list string
    """
    if numbered:
        return "\n".join(f"{i + 1}. {item}" for i, item in enumerate(items))
    return "\n".join(f"- {item}" for item in items)
