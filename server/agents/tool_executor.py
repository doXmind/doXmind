"""Tool execution and result formatting for the writing agent.

Handles tool dispatch, execution, output formatting, skill activation,
and result reminders.
"""

import logging
from collections.abc import AsyncIterator
from typing import Any

from agents.tools.community_tools import execute_community_tool, is_community_tool
from agents.tools.data_files_tools import execute_data_files_tool, is_data_files_tool
from agents.tools.definitions import get_external_tools_for_skill
from agents.tools.document_tools import (
    EDIT_TOOL_NAMES,
    UNIFIED_TOOL_NAMES,
    execute_edit_tool,
    execute_unified_tool,
)
from agents.tools.file_management_tools import execute_file_management_tool, is_file_management_tool
from agents.tools.kb_tools import execute_kb_tool, is_kb_tool
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
        global_kb_context: dict[str, Any] | None = None,
        file_mgmt_context: dict[str, Any] | None = None,
        community_context: dict[str, Any] | None = None,
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
            elif tool_name in UNIFIED_TOOL_NAMES:
                result = await execute_unified_tool(
                    tool_name,
                    tool_input,
                    files,
                    current_file_id,
                    kb_context=kb_context,
                    global_kb_context=global_kb_context,
                )
            elif tool_name in EDIT_TOOL_NAMES:
                result = execute_edit_tool(tool_name, tool_input, files, current_file_id)
            elif is_kb_tool(tool_name):
                result = await execute_kb_tool(tool_name, tool_input, kb_context)
            elif is_data_files_tool(tool_name):
                result = execute_data_files_tool(tool_name, tool_input, data_files_context)
            elif is_skill_tool(tool_name):
                result = await execute_skill_tool(tool_name, tool_input)
                # Dynamically add external tools when skill instructions are read
                if tool_name == "read_skill_instructions":
                    self.activate_skill_external_tools(tool_input.get("skill_name", ""))
            elif is_file_management_tool(tool_name):
                result = await execute_file_management_tool(
                    tool_name, tool_input, file_mgmt_context
                )
            elif is_community_tool(tool_name):
                result = await execute_community_tool(tool_name, tool_input, community_context)
            elif is_web_tool(tool_name):
                result = await execute_web_tool(tool_name, tool_input, data_files_context)
            else:
                result = {"error": f"Unknown tool: {tool_name}"}
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

            # Update the in-memory file content so subsequent reads see the change
            target_file_id = result.get("file_id")
            if target_file_id:
                for f in files:
                    if f["id"] == target_file_id:
                        if result["type"] == "str_replace":
                            f["content"] = f["content"].replace(
                                result["old_str"], result["new_str"], 1
                            )
                        elif result["type"] == "replace_all":
                            f["content"] = result.get("new_content", "")
                        break

            result_content = (
                f"Edit prepared: {result['type']} on {result.get('file_name', 'document')}"
            )
            if result.get("normalization_note"):
                result_content += f"\n\nNote: {result['normalization_note']}"
            if result.get("markdown_warnings"):
                result_content += f"\n\n⚠ Markdown issues detected:\n{result['markdown_warnings']}\nPlease review and fix these issues."
            tool_end_event: dict[str, Any] = {
                "type": "tool_end",
                "tool": tool_name,
                "tool_id": tool_id,
                "output": result_content,
                "success": True,
            }
            # Include file metadata for edit operations
            if result.get("file_id"):
                tool_end_event["file_id"] = result["file_id"]
                tool_end_event["file_action"] = "edited"
            if result.get("file_name"):
                tool_end_event["file_name"] = result["file_name"]
            yield tool_end_event
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
            tool_end_event = {
                "type": "tool_end",
                "tool": tool_name,
                "tool_id": tool_id,
                "output": display_output,
                "success": True,
            }
            # Extract file metadata from tool results for file-affecting/reading tools
            file_meta = self._extract_file_metadata(tool_name, tool_input, result, files)
            if file_meta:
                tool_end_event.update(file_meta)
            yield tool_end_event

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

    def _extract_file_metadata(
        self,
        tool_name: str,
        tool_input: dict[str, Any],
        result: dict[str, Any],
        files: list[dict[str, Any]] | None = None,
    ) -> dict[str, str] | None:
        """Extract file_id, file_name, and file_action from tool results."""
        import re

        result_str = result.get("result", "")

        def _lookup_file_name(fid: str) -> str | None:
            if files:
                for f in files:
                    if f.get("id") == fid:
                        return f.get("name")
            return None

        # --- Write operations ---

        if tool_name == "create_file":
            match = re.search(r"\(id=([^)]+)\)", result_str)
            name_match = re.search(r"'([^']+)'", result_str)
            if match:
                meta: dict[str, str] = {
                    "file_id": match.group(1),
                    "file_action": "created",
                }
                if name_match:
                    meta["file_name"] = name_match.group(1)
                return meta

        if tool_name == "rename_file":
            file_id = tool_input.get("file_id", "")
            new_name = tool_input.get("new_name", "")
            if file_id:
                return {"file_id": file_id, "file_name": new_name, "file_action": "edited"}

        if tool_name == "replace_document":
            file_id = tool_input.get("file_id", "")
            if file_id:
                meta = {"file_id": file_id, "file_action": "edited"}
                name = _lookup_file_name(file_id)
                if name:
                    meta["file_name"] = name
                return meta

        if tool_name == "fork_community_document":
            match = re.search(r"\(id=([^)]+)\)", result_str)
            name_match = re.search(r"'([^']+)'", result_str)
            if match:
                meta = {"file_id": match.group(1), "file_action": "created"}
                if name_match:
                    meta["file_name"] = name_match.group(1)
                return meta

        # --- Read operations (referenced documents) ---

        if tool_name in ("read_content", "get_outline"):
            file_id = tool_input.get("file_id", "")
            if file_id and "Error" not in result_str:
                meta = {"file_id": file_id, "file_action": "referenced"}
                name = _lookup_file_name(file_id)
                if name:
                    meta["file_name"] = name
                return meta

        if tool_name == "search":
            scope = tool_input.get("scope", "document")
            file_id = tool_input.get("file_id", "")
            if scope == "document" and file_id and "No matches" not in result_str:
                meta = {"file_id": file_id, "file_action": "referenced"}
                name = _lookup_file_name(file_id)
                if name:
                    meta["file_name"] = name
                return meta

        return None

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

        # Unified document tools
        if tool_name == "get_outline":
            return "Read document outline"

        if tool_name == "read_content":
            section_ids = tool_input.get("section_ids", [])
            if section_ids:
                return (
                    f"Read section{'s' if len(section_ids) != 1 else ''}: {', '.join(section_ids)}"
                )
            return "Read document content"

        if tool_name == "search":
            scope = tool_input.get("scope", "document")
            query = tool_input.get("query", "")
            if isinstance(result_content, str):
                if "No matches found" in result_content or "No results found" in result_content:
                    return f"No matches for '{query}'"
                if scope == "all":
                    result_count = result_content.count("**Result ")
                    return f"Found {result_count} result{'s' if result_count != 1 else ''}"
            return f"Searched for '{query}'"

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

        # File management tools
        if tool_name == "create_file":
            return "Created document"

        if tool_name == "create_folder":
            return "Created folder"

        if tool_name == "rename_file":
            new_name = tool_input.get("new_name", "")
            return f"Renamed to '{new_name}'"

        if tool_name == "move_file":
            return "Moved file"

        if tool_name == "delete_file":
            return "Deleted file"

        if tool_name == "list_files":
            if isinstance(result_content, str):
                if "No files" in result_content:
                    return "No files found"
                file_count = result_content.count("\n- ")
                return f"Found {file_count} item{'s' if file_count != 1 else ''}"
            return "Listed files"

        # Community tools
        if tool_name == "search_community":
            if isinstance(result_content, str):
                if "No community documents" in result_content:
                    return "Found 0 community documents"
                return "Found community documents"
            return "Searched community"

        if tool_name == "fork_community_document":
            return "Forked community document"

        if tool_name == "get_community_recommendations":
            return "Got recommendations"

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

        This enables lazy loading of skill-specific tools only when the
        skill is actually used, saving tokens.
        """
        if not skill_name or skill_name in self._activated_skill_tools:
            return

        external_tools = get_external_tools_for_skill(skill_name)
        if not external_tools:
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
            "get_outline": (
                "\n\n<reminder>Use read_content(section_ids=[...]) to read specific sections "
                "before editing, or search to find content by keyword.</reminder>"
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
        read_tools = ("read_content", "search")
        edit_tools = ("str_replace_editor", "replace_document")
        kb_tools = ("list_kb_documents",)
        skill_tools = ("read_skill_instructions", "read_skill_template", "read_skill_knowledge")
        file_mgmt_tools = (
            "create_file",
            "create_folder",
            "rename_file",
            "move_file",
            "delete_file",
            "list_files",
        )
        community_tools = (
            "search_community",
            "fork_community_document",
            "get_community_recommendations",
        )

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
        elif tool_name in file_mgmt_tools:
            return result_content + (
                "\n\n<reminder>File operation complete. Continue with the next task.</reminder>"
            )
        elif tool_name in community_tools:
            return result_content + (
                "\n\n<reminder>Present the community results to the user. "
                "Use fork_community_document to copy interesting documents.</reminder>"
            )
        else:
            return result_content + (
                "\n\n<reminder>Continue with the task. Prefer using tools over long "
                "chat responses.</reminder>"
            )
