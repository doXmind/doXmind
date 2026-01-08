"""Writing Agent for AI-assisted document editing.

This agent uses Claude's API directly for real-time streaming,
with document editing tools similar to Cursor for code editing.

Supports:
- Real-time text streaming (token by token)
- Extended thinking (streaming thinking content)
- Tool use with proper event handling
"""

from typing import List, Optional, AsyncIterator
from anthropic import AsyncAnthropic
import logging
import json

from config import get_settings
from agents.prompts import get_writing_system_prompt

logger = logging.getLogger(__name__)


# ============================================================================
# Document Editing Tools Definition (for Claude API)
# ============================================================================

TOOLS = [
    {
        "name": "view_document",
        "description": "View the current document content with line numbers. Use this to see what's in the document before making edits.",
        "input_schema": {
            "type": "object",
            "properties": {
                "file_id": {
                    "type": "string",
                    "description": "The ID of the file to view (optional, uses current file if not provided)"
                }
            },
            "required": []
        }
    },
    {
        "name": "str_replace_editor",
        "description": "Replace a specific string in the document with new content. The old_str must match EXACTLY including whitespace. This is the primary editing tool for making precise changes.",
        "input_schema": {
            "type": "object",
            "properties": {
                "old_str": {
                    "type": "string",
                    "description": "The exact string to find and replace (must be unique in document)"
                },
                "new_str": {
                    "type": "string",
                    "description": "The new string to replace it with"
                },
                "file_id": {
                    "type": "string",
                    "description": "The ID of the file to edit (optional)"
                }
            },
            "required": ["old_str", "new_str"]
        }
    },
    {
        "name": "insert_text",
        "description": "Insert new text after a specific line number in the document.",
        "input_schema": {
            "type": "object",
            "properties": {
                "insert_line": {
                    "type": "integer",
                    "description": "The line number after which to insert (0 = beginning of file)"
                },
                "new_str": {
                    "type": "string",
                    "description": "The text to insert"
                },
                "file_id": {
                    "type": "string",
                    "description": "The ID of the file to edit (optional)"
                }
            },
            "required": ["insert_line", "new_str"]
        }
    },
    {
        "name": "replace_document",
        "description": "Replace the entire document content. Use this when making major rewrites or creating new content from scratch.",
        "input_schema": {
            "type": "object",
            "properties": {
                "new_content": {
                    "type": "string",
                    "description": "The complete new content for the document"
                },
                "file_id": {
                    "type": "string",
                    "description": "The ID of the file to edit (optional)"
                }
            },
            "required": ["new_content"]
        }
    },
    {
        "name": "search_in_document",
        "description": "Search for text in the document and return matching lines with context.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The text to search for (case-insensitive)"
                },
                "file_id": {
                    "type": "string",
                    "description": "The ID of the file to search (optional)"
                }
            },
            "required": ["query"]
        }
    }
]

# Read-only tools for analyze mode
READONLY_TOOLS = [TOOLS[0], TOOLS[4]]  # view_document and search_in_document


def execute_tool(tool_name: str, tool_input: dict, files: List[dict], current_file_id: Optional[str]) -> dict:
    """Execute a tool and return the result."""

    # Find target file
    file_id = tool_input.get("file_id") or current_file_id
    target_file = None
    for f in files:
        if f["id"] == file_id or (not file_id and f.get("is_current")):
            target_file = f
            break
    if not target_file and files:
        target_file = files[0]

    if tool_name == "view_document":
        if not target_file:
            return {"result": "No document is currently open."}

        content = target_file.get("content", "")
        lines = content.split("\n")
        numbered_lines = [f"{i+1:4d} | {line}" for i, line in enumerate(lines)]
        return {"result": f"Document: {target_file['name']}\n{'='*50}\n" + "\n".join(numbered_lines)}

    elif tool_name == "str_replace_editor":
        if not target_file:
            return {"error": "No document is currently open."}

        old_str = tool_input.get("old_str", "")
        new_str = tool_input.get("new_str", "")
        content = target_file.get("content", "")

        count = content.count(old_str)
        if count == 0:
            return {"error": "String not found in document. Make sure it matches exactly including whitespace."}
        if count > 1:
            return {"error": f"String found {count} times. Please provide a more unique string to replace."}

        return {
            "type": "str_replace",
            "file_id": target_file["id"],
            "file_name": target_file["name"],
            "old_str": old_str,
            "new_str": new_str,
            "success": True
        }

    elif tool_name == "insert_text":
        if not target_file:
            return {"error": "No document is currently open."}

        insert_line = tool_input.get("insert_line", 0)
        new_str = tool_input.get("new_str", "")
        content = target_file.get("content", "")
        lines = content.split("\n")

        if insert_line < 0 or insert_line > len(lines):
            return {"error": f"Line number {insert_line} is out of range (0-{len(lines)})"}

        return {
            "type": "insert",
            "file_id": target_file["id"],
            "file_name": target_file["name"],
            "insert_line": insert_line,
            "new_str": new_str,
            "success": True
        }

    elif tool_name == "replace_document":
        if not target_file:
            return {"error": "No document is currently open."}

        new_content = tool_input.get("new_content", "")
        return {
            "type": "replace_all",
            "file_id": target_file["id"],
            "file_name": target_file["name"],
            "new_content": new_content,
            "success": True
        }

    elif tool_name == "search_in_document":
        if not target_file:
            return {"result": "No document is currently open."}

        query = tool_input.get("query", "").lower()
        content = target_file.get("content", "")
        lines = content.split("\n")

        results = []
        for i, line in enumerate(lines):
            if query in line.lower():
                context_start = max(0, i - 1)
                context_end = min(len(lines), i + 2)
                context_lines = []
                for j in range(context_start, context_end):
                    prefix = ">>>" if j == i else "   "
                    context_lines.append(f"{prefix} {j+1:4d} | {lines[j]}")
                results.append("\n".join(context_lines))

        if results:
            return {"result": f"Found {len(results)} match(es):\n\n" + "\n\n".join(results[:10])}
        return {"result": f"No matches found for '{query}'"}

    return {"error": f"Unknown tool: {tool_name}"}


class WritingAgent:
    """Writing agent using Claude API directly for real-time streaming."""

    def __init__(self, mode: str = "edit", enable_thinking: bool = False):
        """Initialize the writing agent.

        Args:
            mode: "edit" for full editing tools, "analyze" for read-only
            enable_thinking: Enable extended thinking for complex reasoning
        """
        self.mode = mode
        self.enable_thinking = enable_thinking
        settings = get_settings()

        api_key = settings.anthropic_api_key
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY is not set")

        self.client = AsyncAnthropic(api_key=api_key)
        self.model = settings.default_model
        self.max_tokens = settings.max_output_tokens
        self.tools = TOOLS if mode == "edit" else READONLY_TOOLS

    async def stream(
        self,
        message: str,
        files: List[dict]
    ) -> AsyncIterator[dict]:
        """Stream agent response with real-time token streaming.

        Yields events in the following format:
        - {"type": "text", "content": "..."} - Real-time text tokens
        - {"type": "thinking", "content": "..."} - Thinking/reasoning tokens
        - {"type": "thinking_end"} - End of thinking block
        - {"type": "tool_start", "tool": "...", "input": {...}} - Tool invocation started
        - {"type": "tool_input_delta", "tool": "...", "delta": "..."} - Tool input streaming
        - {"type": "tool_end", "tool": "...", "output": "..."} - Tool completed
        - {"type": "edit", "edit": {...}} - Edit operation
        - {"type": "edits_batch", "edits": [...]} - Batch of all edits
        - {"type": "error", "content": "..."} - Error occurred
        """

        if files:
            files[0]["is_current"] = True

        system_prompt = get_writing_system_prompt(
            mode=self.mode,
            files=files
        )

        messages = [{"role": "user", "content": message}]
        collected_edits = []
        current_file_id = files[0]["id"] if files else None

        max_iterations = 10
        iteration = 0

        try:
            while iteration < max_iterations:
                iteration += 1

                # Build API parameters
                api_params = {
                    "model": self.model,
                    "max_tokens": self.max_tokens,
                    "system": system_prompt,
                    "messages": messages,
                    "tools": self.tools,
                }

                # Add thinking parameters if enabled and model supports it
                if self.enable_thinking and "claude-3" in self.model:
                    api_params["thinking"] = {
                        "type": "enabled",
                        "budget_tokens": 8000
                    }

                # Stream the response using raw events for maximum control
                async with self.client.messages.stream(**api_params) as stream:
                    full_response = {"role": "assistant", "content": []}
                    current_text = ""
                    current_thinking = ""
                    current_tool_use = None
                    in_thinking_block = False

                    async for event in stream:
                        # Handle different event types from Claude API
                        if event.type == "content_block_start":
                            block = event.content_block

                            if block.type == "thinking":
                                # Start of thinking block
                                in_thinking_block = True
                                current_thinking = ""
                                yield {"type": "thinking_start"}

                            elif block.type == "text":
                                current_text = ""

                            elif block.type == "tool_use":
                                current_tool_use = {
                                    "type": "tool_use",
                                    "id": block.id,
                                    "name": block.name,
                                    "input": {}
                                }
                                yield {
                                    "type": "tool_start",
                                    "tool": block.name,
                                    "tool_id": block.id,
                                    "input": {}
                                }

                        elif event.type == "content_block_delta":
                            delta = event.delta

                            if delta.type == "thinking_delta":
                                # Stream thinking content in real-time
                                yield {"type": "thinking", "content": delta.thinking}
                                current_thinking += delta.thinking

                            elif delta.type == "text_delta":
                                # Real-time text streaming - each token immediately
                                yield {"type": "text", "content": delta.text}
                                current_text += delta.text

                            elif delta.type == "input_json_delta":
                                # Stream tool input JSON delta
                                if current_tool_use:
                                    if "partial_json" not in current_tool_use:
                                        current_tool_use["partial_json"] = ""
                                    current_tool_use["partial_json"] += delta.partial_json
                                    # Optionally stream tool input for UI feedback
                                    yield {
                                        "type": "tool_input_delta",
                                        "tool": current_tool_use["name"],
                                        "delta": delta.partial_json
                                    }

                        elif event.type == "content_block_stop":
                            if in_thinking_block:
                                # End of thinking block
                                in_thinking_block = False
                                if current_thinking:
                                    full_response["content"].append({
                                        "type": "thinking",
                                        "thinking": current_thinking
                                    })
                                yield {"type": "thinking_end"}
                                current_thinking = ""

                            elif current_text:
                                full_response["content"].append({
                                    "type": "text",
                                    "text": current_text
                                })
                                current_text = ""

                            elif current_tool_use:
                                # Parse the accumulated JSON
                                if "partial_json" in current_tool_use:
                                    try:
                                        current_tool_use["input"] = json.loads(current_tool_use["partial_json"])
                                    except json.JSONDecodeError:
                                        current_tool_use["input"] = {}
                                    del current_tool_use["partial_json"]
                                full_response["content"].append(current_tool_use)
                                current_tool_use = None

                    # Check if we have tool uses
                    tool_uses = [c for c in full_response["content"] if c.get("type") == "tool_use"]

                    if not tool_uses:
                        # No tool calls, we're done
                        break

                    # Add assistant message to history
                    messages.append(full_response)

                    # Execute tools and collect results
                    tool_results = []
                    for tool_use in tool_uses:
                        tool_name = tool_use["name"]
                        tool_input = tool_use["input"]

                        # Execute tool
                        result = execute_tool(tool_name, tool_input, files, current_file_id)

                        # Check if it's an edit operation
                        if result.get("success"):
                            collected_edits.append(result)
                            yield {
                                "type": "edit",
                                "edit": result
                            }
                            result_content = f"Edit prepared: {result['type']} on {result.get('file_name', 'document')}"
                            yield {
                                "type": "tool_end",
                                "tool": tool_name,
                                "tool_id": tool_use["id"],
                                "output": result_content,
                                "success": True
                            }
                        elif result.get("error"):
                            result_content = f"Error: {result['error']}"
                            yield {
                                "type": "tool_end",
                                "tool": tool_name,
                                "tool_id": tool_use["id"],
                                "output": result_content,
                                "success": False
                            }
                        else:
                            result_content = result.get("result", str(result))
                            yield {
                                "type": "tool_end",
                                "tool": tool_name,
                                "tool_id": tool_use["id"],
                                "output": result_content[:500],
                                "success": True
                            }

                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": tool_use["id"],
                            "content": result_content
                        })

                    # Add tool results to messages
                    messages.append({"role": "user", "content": tool_results})

            # Emit collected edits as batch at the end
            if collected_edits:
                yield {
                    "type": "edits_batch",
                    "edits": collected_edits
                }

        except Exception as e:
            logger.error(f"Agent streaming error: {e}")
            import traceback
            traceback.print_exc()
            yield {"type": "error", "content": str(e)}

    async def run(self, message: str, files: List[dict]) -> dict:
        """Run agent and return full response with edits."""
        full_response = ""
        all_edits = []

        async for event in self.stream(message, files):
            if event["type"] == "text":
                full_response += event["content"]
            elif event["type"] == "edit":
                all_edits.append(event["edit"])

        return {
            "response": full_response,
            "edits": all_edits
        }
