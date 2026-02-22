"""Tool execution and result formatting for the writing agent.

Handles tool dispatch, execution, output formatting, skill activation,
and result reminders.
"""

import logging
from collections.abc import AsyncIterator
from typing import Any

from agents.tools.data_files_tools import execute_data_files_tool, is_data_files_tool
from agents.tools.definitions import get_external_tools_for_skill
from agents.tools.document_tools import execute_document_tool
from agents.tools.kb_tools import execute_kb_tool, is_kb_tool
from agents.tools.legal_tools import execute_legal_tool, is_legal_tool
from agents.tools.skill_tools import execute_skill_tool, is_skill_tool
from agents.tools.todo_tools import execute_todo_tool, is_todo_tool
from agents.tools.web_tools import execute_web_tool, is_web_tool

logger = logging.getLogger(__name__)


class ToolExecutor:
    """Handles tool dispatch, execution, and result formatting."""

    def __init__(self, settings, tools: list[dict]):
        self.settings = settings
        self.tools = tools
        self._activated_skill_tools: set[str] = set()

    async def execute(
        self,
        tool_use: dict[str, Any],
        files: list[dict[str, Any]],
        current_file_id: str,
        kb_context: dict[str, Any] | None,
        data_files_context: dict[str, Any] | None,
        collected_edits: list[dict[str, Any]],
        current_todos: list[dict] | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """Execute a single tool and yield events."""
        tool_name = tool_use["name"]
        tool_input = tool_use["input"]
        tool_id = tool_use["id"]

        # Execute tool based on type, with error handling
        try:
            if is_todo_tool(tool_name):
                result = execute_todo_tool(tool_input)
                # Emit todo update event for frontend
                if "todos" in result:
                    yield {"type": "todo_update", "todos": result["todos"]}
                    # Track latest todo state for completion guard
                    if current_todos is not None:
                        current_todos.clear()
                        current_todos.extend(result["todos"])
                # Set friendly result for tool_end display (avoids raw dict string)
                count = result.get("count", 0)
                completed = sum(
                    1 for t in result.get("todos", []) if t.get("status") == "completed"
                )
                result["result"] = f"Tracking {count} task(s), {completed} completed"
            elif is_kb_tool(tool_name):
                result = await execute_kb_tool(tool_name, tool_input, kb_context)
            elif is_data_files_tool(tool_name):
                result = execute_data_files_tool(tool_name, tool_input, data_files_context)
            elif is_skill_tool(tool_name):
                result = await execute_skill_tool(tool_name, tool_input)
                # Dynamically add external tools when skill instructions are read
                if tool_name == "read_skill_instructions":
                    self.activate_skill_external_tools(tool_input.get("skill_name", ""))
            elif is_legal_tool(tool_name):
                result = await execute_legal_tool(tool_name, tool_input)
            elif is_web_tool(tool_name):
                result = await execute_web_tool(tool_name, tool_input, data_files_context)
            else:
                result = execute_document_tool(tool_name, tool_input, files, current_file_id)
        except Exception as e:
            logger.error(f"Tool execution error for {tool_name}: {e}")
            result = {"error": f"Tool execution failed: {str(e)}"}

        # Handle result
        # Check if this is an actual edit operation (must have 'type' field with valid edit type)
        # TodoWrite returns {"success": True} but is NOT an edit operation
        if result.get("success") and result.get("type") in ("str_replace", "replace_all"):
            # This is an edit operation
            collected_edits.append(result)
            yield {"type": "edit", "edit": result}
            result_content = (
                f"Edit prepared: {result['type']} on {result.get('file_name', 'document')}"
            )
            yield {
                "type": "tool_end",
                "tool": tool_name,
                "tool_id": tool_id,
                "output": result_content,
                "success": True,
            }
        elif result.get("error"):
            result_content = f"Error: {result['error']}"
            yield {
                "type": "tool_end",
                "tool": tool_name,
                "tool_id": tool_id,
                "output": result_content,
                "success": False,
            }
        else:
            result_content = result.get("result", str(result))
            display_output = self.format_output_for_display(tool_name, tool_input, result_content)
            yield {
                "type": "tool_end",
                "tool": tool_name,
                "tool_id": tool_id,
                "output": display_output,
                "success": True,
            }

        # Add instruction reinforcement to tool results
        reinforced_content = self.add_tool_result_reminder(
            tool_name, result_content if isinstance(result_content, str) else str(result_content)
        )

        # Yield tool result for message history
        yield {
            "type": "tool_result",
            "result": {
                "type": "tool_result",
                "tool_use_id": tool_id,
                "content": reinforced_content,
            },
        }

    def format_output_for_display(
        self, tool_name: str, tool_input: dict[str, Any], result_content: Any
    ) -> str:
        """Format tool output for user-friendly display.

        Converts raw tool results into concise, readable summaries.
        """
        # Skill tools
        if tool_name == "list_skills":
            if isinstance(result_content, list):
                count = len(result_content)
                return f"Found {count} skill{'s' if count != 1 else ''}"
            return "Listed available skills"

        if tool_name == "read_skill_instructions":
            skill_name_param = tool_input.get("skill_name", "unknown")
            return f"Loaded {skill_name_param} skill instructions"

        if tool_name == "read_skill_template":
            template_name = tool_input.get("template_name", "template")
            return f"Loaded {template_name} template"

        if tool_name == "read_skill_knowledge":
            knowledge_name = tool_input.get("knowledge_name", "knowledge")
            return f"Loaded {knowledge_name} knowledge"

        # KB tools
        if tool_name == "search_knowledge_base":
            if isinstance(result_content, str):
                if "No relevant content found" in result_content:
                    return "Found 0 results"
                result_count = result_content.count("## ")
                return f"Found {result_count} result{'s' if result_count != 1 else ''}"
            return "Searched knowledge base"

        if tool_name == "read_kb_document":
            doc_title = tool_input.get("document_title", "document")
            return f"Read {doc_title}"

        if tool_name == "list_kb_documents":
            if isinstance(result_content, str):
                doc_count = result_content.count("\n- ") + (1 if result_content.strip() else 0)
                return f"Found {doc_count} document{'s' if doc_count != 1 else ''}"
            return "Listed KB documents"

        # Data files tools
        if tool_name == "list_data_files":
            if isinstance(result_content, str):
                if "No data files" in result_content:
                    return "No data files uploaded"
                file_count = result_content.count("\n- ")
                return f"Found {file_count} data file{'s' if file_count != 1 else ''}"
            return "Listed data files"

        # Web tools
        if tool_name == "web_search":
            query = tool_input.get("query", "")
            if isinstance(result_content, str):
                if "No results found" in result_content:
                    return "Found 0 results"
                result_count = result_content.count("## ")
                return f"Found {result_count} result{'s' if result_count != 1 else ''}"
            return f"Searched for: {query[:30]}..." if len(query) > 30 else f"Searched for: {query}"

        if tool_name == "web_fetch":
            url = tool_input.get("url", "")
            domain = url.split("//")[-1].split("/")[0] if "//" in url else url.split("/")[0]
            return f"Fetched {domain}"

        if tool_name == "code_execution":
            if isinstance(result_content, str):
                if "Error" in result_content or "error" in result_content:
                    return "Execution completed with errors"
                return "Execution completed"
            return "Executed Python code"

        # Document tools
        if tool_name == "get_document_outline":
            return "Read document outline"

        if tool_name == "read_section":
            section_ids = tool_input.get("section_ids", [])
            return f"Read section{'s' if len(section_ids) != 1 else ''}: {', '.join(section_ids)}"

        if tool_name == "view_document":
            return "Read document content"

        if tool_name == "search_in_document":
            query = tool_input.get("query", "")
            if isinstance(result_content, str) and "No matches found" in result_content:
                return f"No matches for '{query}'"
            return f"Searched for '{query}'"

        # Legal tools
        if tool_name == "search_court_opinions":
            query = tool_input.get("query", "")
            if isinstance(result_content, str):
                if "No opinions found" in result_content or not result_content.strip():
                    return "Found 0 court opinions"
                result_count = result_content.count("**Case:**")
                return f"Found {result_count} court opinion{'s' if result_count != 1 else ''}"
            return "Searched court opinions"

        if tool_name == "get_court_opinion":
            return "Retrieved court opinion"

        # Todo tools
        if tool_name == "TodoWrite":
            if isinstance(result_content, str):
                return result_content
            return "Updated task list"

        # Default: truncate if too long
        if isinstance(result_content, str):
            if len(result_content) > 100:
                return result_content[:100] + "..."
            return result_content
        return str(result_content)[:100]

    def activate_skill_external_tools(self, skill_name: str) -> None:
        """Dynamically add external tools when a skill's instructions are read.

        This enables lazy loading of skill-specific tools (like CourtListener
        for legal-writing) only when the skill is actually used, saving tokens.
        """
        if not skill_name or skill_name in self._activated_skill_tools:
            return

        external_tools = get_external_tools_for_skill(skill_name)
        if not external_tools:
            return

        # Check if required API keys/features are configured
        if skill_name == "legal" and not self.settings.has_legal_tools:
            return

        for tool in external_tools:
            if tool not in self.tools:
                self.tools.append(tool)

        self._activated_skill_tools.add(skill_name)
        logger.info(f"Activated {len(external_tools)} external tool(s) for skill: {skill_name}")

    def add_tool_result_reminder(self, tool_name: str, result_content: str) -> str:
        """Add contextual reminders to tool results to reinforce good behavior.

        This pattern is borrowed from Claude Code - it helps keep the agent
        focused on using tools rather than writing long chat responses.
        """
        if tool_name == "TodoWrite":
            return result_content

        reminders = {
            "get_document_outline": (
                "\n\n<reminder>Use read_section(section_ids) to read specific sections "
                "before editing, or search_in_document to find content by keyword.</reminder>"
            ),
            "search_court_opinions": (
                "\n\n<reminder>Use these case citations to support legal arguments. "
                "Cite the most relevant and authoritative cases.</reminder>"
            ),
            "web_search": (
                "\n\n<reminder>Use web_fetch to read specific pages if you need "
                "more details.</reminder>"
            ),
            "web_fetch": "\n\n<reminder>Synthesize the fetched content to help the user.</reminder>",
            "code_execution": (
                "\n\n<reminder>Review the output and present the key findings "
                "to the user.</reminder>"
            ),
        }

        # Group-based reminders
        read_tools = ("read_section", "view_document", "search_in_document")
        edit_tools = ("str_replace_editor", "replace_document")
        kb_tools = ("search_knowledge_base", "read_kb_document", "list_kb_documents")
        skill_tools = ("read_skill_instructions", "read_skill_template", "read_skill_knowledge")

        if tool_name in reminders:
            return result_content + reminders[tool_name]
        elif tool_name in read_tools:
            return result_content + (
                "\n\n<reminder>Now use editing tools (str_replace_editor) to make changes. "
                "Keep chat responses brief.</reminder>"
            )
        elif tool_name in edit_tools:
            return result_content + (
                "\n\n<reminder>Edit complete. If you have a todo list, call TodoWrite NOW "
                "to mark this task completed and the next task in_progress. "
                "Then continue with the next edit.</reminder>"
            )
        elif tool_name in kb_tools:
            return result_content + (
                "\n\n<reminder>Use this information to help the user. If editing is needed, "
                "use editing tools directly.</reminder>"
            )
        elif tool_name in skill_tools:
            return result_content + (
                "\n\n<reminder>Apply this guidance. Use editing tools to write content "
                "directly into the document.</reminder>"
            )
        else:
            return result_content + (
                "\n\n<reminder>Continue with the task. Prefer using tools over long "
                "chat responses.</reminder>"
            )
