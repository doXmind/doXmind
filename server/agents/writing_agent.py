"""Writing Agent for AI-assisted document editing.

This agent uses Claude's API directly for real-time streaming,
with document editing tools similar to Cursor for code editing.

Supports:
- Real-time text streaming (token by token)
- Extended thinking (streaming thinking content)
- Tool use with proper event handling
- Skill tools for accessing templates and knowledge
"""

import json
import logging
from collections.abc import AsyncIterator
from typing import Any

from anthropic import AsyncAnthropic

from agents.prompts import (
    get_kb_context_prompt,
    get_skills_metadata_prompt,
    get_writing_system_prompt,
)
from agents.tools.definitions import get_tools_for_mode
from agents.tools.document_tools import execute_document_tool
from agents.tools.kb_tools import execute_kb_tool, is_kb_tool
from agents.tools.skill_tools import execute_skill_tool, is_skill_tool
from agents.tools.todo_tools import execute_todo_tool, is_todo_tool
from config import get_settings
from services.skills_service import get_skills_service

logger = logging.getLogger(__name__)


class WritingAgent:
    """Writing agent using Claude API directly for real-time streaming."""

    # Maximum tool use iterations to prevent infinite loops
    MAX_ITERATIONS = 20

    def __init__(
        self,
        mode: str = "edit",
        enable_thinking: bool = False,
        kb_attachments: list[dict[str, Any]] = None,
        web_search_enabled: bool = False,
        db=None,
    ):
        """Initialize the writing agent.

        Args:
            mode: "edit" for full editing tools, "analyze" for read-only
            enable_thinking: Enable extended thinking for complex reasoning
            kb_attachments: List of KB attachments for this conversation
            web_search_enabled: Enable Anthropic web search tool
            db: Database session for RAG operations
        """
        self.mode = mode
        self.enable_thinking = enable_thinking
        self.kb_attachments = kb_attachments or []
        self.web_search_enabled = web_search_enabled
        self.db = db

        # Check if skills are available
        self.has_skills = bool(get_skills_service().list_skills())

        settings = get_settings()
        api_key = settings.anthropic_api_key
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY is not set")

        self.client = AsyncAnthropic(api_key=api_key)
        self.model = settings.default_model
        self.max_tokens = settings.max_output_tokens
        self.settings = settings

        # Get tools
        self.tools = get_tools_for_mode(
            mode,
            bool(self.kb_attachments),
            self.has_skills,
            web_search_enabled,
            settings.web_search_max_uses,
            settings.web_fetch_max_uses,
        )

    async def stream(
        self,
        message: str,
        files: list[dict[str, Any]],
        images: list[dict[str, Any]] = None,
        history: list[dict[str, Any]] = None,
        conversation_id: str = None
    ) -> AsyncIterator[dict[str, Any]]:
        """Stream agent response with real-time token streaming.

        Args:
            message: The current user message
            files: List of file contexts
            images: List of image contexts for multimodal support
            history: Previous conversation messages
            conversation_id: ID of the conversation (needed for KB tools)

        Yields events:
        - {"type": "text", "content": "..."} - Text tokens
        - {"type": "thinking", "content": "..."} - Thinking tokens
        - {"type": "thinking_end"} - End of thinking block
        - {"type": "tool_start", "tool": "...", "tool_id": "...", "input": {}}
        - {"type": "tool_input_delta", "tool": "...", "delta": "..."}
        - {"type": "tool_end", "tool": "...", "tool_id": "...", "output": "...", "success": bool}
        - {"type": "edit", "edit": {...}} - Edit operation
        - {"type": "edits_batch", "edits": [...]} - Batch of all edits
        - {"type": "error", "content": "..."} - Error occurred
        """
        # Mark first file as current
        if files:
            files[0]["is_current"] = True

        # Build system prompt
        system_prompt = get_writing_system_prompt(mode=self.mode, files=files)
        if self.kb_attachments:
            system_prompt += get_kb_context_prompt(self.kb_attachments)

        # Inject skills metadata if available (progressive disclosure pattern)
        if self.has_skills:
            skills_metadata = get_skills_service().list_skills()
            system_prompt += get_skills_metadata_prompt(skills_metadata)

        # Build messages
        messages = self._build_messages(message, images, history)

        # Track state
        collected_edits = []
        current_file_id = files[0]["id"] if files else None
        kb_context = self._build_kb_context(conversation_id)

        try:
            # Main agent loop
            async for event in self._agent_loop(
                system_prompt=system_prompt,
                messages=messages,
                files=files,
                current_file_id=current_file_id,
                kb_context=kb_context,
                collected_edits=collected_edits
            ):
                yield event

            # Emit collected edits as batch at the end
            if collected_edits:
                yield {"type": "edits_batch", "edits": collected_edits}

        except Exception as e:
            logger.error(f"Agent streaming error: {e}")
            import traceback
            traceback.print_exc()
            yield {"type": "error", "content": str(e)}

    def _build_messages(
        self,
        message: str,
        images: list[dict[str, Any]] = None,
        history: list[dict[str, Any]] = None
    ) -> list[dict[str, Any]]:
        """Build the messages list for the API call."""
        messages = []

        # Add history
        if history:
            messages.extend(history)

        # Build current message content
        if images:
            content = self._build_multimodal_content(message, images)
            messages.append({"role": "user", "content": content})
        else:
            messages.append({"role": "user", "content": message})

        return messages

    def _build_multimodal_content(
        self,
        message: str,
        images: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Build multimodal content with images and text."""
        content = []

        # Add images first (Claude recommends images before text)
        for i, img in enumerate(images):
            base64_data = img.get("base64")
            media_type = img.get("mediaType")

            if base64_data and media_type:
                content.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": media_type,
                        "data": base64_data
                    }
                })
                # Add label for multiple images
                if len(images) > 1:
                    alt = img.get("alt", "")
                    label = f"Image {i+1}" + (f" ({alt})" if alt else "") + ":"
                    content.append({"type": "text", "text": label})

        # Add text message
        content.append({"type": "text", "text": message})
        return content

    def _build_kb_context(self, conversation_id: str = None) -> dict[str, Any] | None:
        """Build KB context for tool execution."""
        if not self.kb_attachments or not conversation_id:
            return None

        return {
            "conversation_id": conversation_id,
            "attachments": self.kb_attachments,
            "db": self.db
        }

    async def _agent_loop(
        self,
        system_prompt: str,
        messages: list[dict[str, Any]],
        files: list[dict[str, Any]],
        current_file_id: str,
        kb_context: dict[str, Any] | None,
        collected_edits: list[dict[str, Any]]
    ) -> AsyncIterator[dict[str, Any]]:
        """Main agent loop handling streaming and tool execution."""
        iteration = 0

        while iteration < self.MAX_ITERATIONS:
            iteration += 1

            # Stream response and yield events in real-time
            full_response = {"role": "assistant", "content": []}
            tool_uses = []

            async for event, response_update, tool_use in self._stream_response_realtime(
                system_prompt, messages
            ):
                # Yield event immediately for real-time streaming
                if event:
                    yield event

                # Collect response content
                if response_update:
                    full_response["content"].append(response_update)

                # Collect tool uses
                if tool_use:
                    tool_uses.append(tool_use)

            # If no tool uses, we're done
            if not tool_uses:
                break

            # Add assistant message to history
            messages.append(full_response)

            # Execute tools and collect results
            tool_results = []
            for tool_use in tool_uses:
                async for event in self._execute_tool(
                    tool_use, files, current_file_id, kb_context, collected_edits
                ):
                    if event.get("type") == "tool_result":
                        tool_results.append(event["result"])
                    else:
                        yield event

            # Add tool results to messages
            messages.append({"role": "user", "content": tool_results})

    async def _stream_response_realtime(
        self,
        system_prompt: str,
        messages: list[dict[str, Any]]
    ) -> AsyncIterator[tuple[dict | None, dict | None, dict | None]]:
        """Stream API response in real-time, yielding events immediately.

        Yields tuples of (event, response_update, tool_use):
        - event: Event to send to client (text, thinking, tool_start, etc.)
        - response_update: Content block to add to full response
        - tool_use: Tool use to execute (only for client-side tools)
        """
        api_params = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "system": system_prompt,
            "messages": messages,
            "tools": self.tools,
        }

        # Add thinking if enabled
        if self.enable_thinking and "claude-3" in self.model:
            api_params["thinking"] = {"type": "enabled", "budget_tokens": 8000}

        # Add beta headers for web tools
        beta_headers = ["web-fetch-2025-09-10"]  # Web fetch is always enabled (free)
        if self.web_search_enabled:
            beta_headers.append("web-search-2025-03-05")  # Web search requires its own beta header
        api_params["extra_headers"] = {"anthropic-beta": ",".join(beta_headers)}

        async with self.client.messages.stream(**api_params) as stream:
            current_text = ""
            current_thinking = ""
            current_tool_use = None
            current_server_tool = None
            in_thinking_block = False

            async for event in stream:
                # Handle content block start
                if event.type == "content_block_start":
                    block = event.content_block

                    if block.type == "thinking":
                        in_thinking_block = True
                        current_thinking = ""
                        yield {"type": "thinking_start"}, None, None

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
                        }, None, None

                    # Handle server-side tools (web_search, web_fetch)
                    elif block.type == "server_tool_use":
                        current_server_tool = {
                            "type": "server_tool_use",
                            "id": block.id,
                            "name": block.name,
                            "input": {}
                        }
                        yield {
                            "type": "server_tool_start",
                            "tool": block.name,
                            "tool_id": block.id,
                        }, None, None

                    # Handle web search results
                    # Server tool results must be included in message history
                    elif block.type == "web_search_tool_result":
                        results = []
                        # Serialize content for message history
                        serialized_content = []
                        if hasattr(block, 'content') and block.content:
                            for r in block.content:
                                if hasattr(r, 'type') and r.type == "web_search_result":
                                    results.append({
                                        "url": getattr(r, 'url', ''),
                                        "title": getattr(r, 'title', ''),
                                    })
                                    serialized_content.append({
                                        "type": "web_search_result",
                                        "url": getattr(r, 'url', ''),
                                        "title": getattr(r, 'title', ''),
                                        "encrypted_content": getattr(r, 'encrypted_content', ''),
                                        "page_age": getattr(r, 'page_age', None),
                                    })
                        yield {
                            "type": "web_search_result",
                            "tool_id": block.tool_use_id,
                            "results": results
                        }, {
                            "type": "web_search_tool_result",
                            "tool_use_id": block.tool_use_id,
                            "content": serialized_content
                        }, None

                    # Handle web fetch results
                    # Server tool results must be included in message history
                    elif block.type == "web_fetch_tool_result":
                        url = ""
                        serialized_content = {}
                        if hasattr(block, 'content'):
                            content = block.content
                            url = getattr(content, 'url', '')
                            serialized_content = {
                                "url": url,
                                "content": getattr(content, 'content', ''),
                                "title": getattr(content, 'title', ''),
                            }
                        yield {
                            "type": "web_fetch_result",
                            "tool_id": block.tool_use_id,
                            "url": url
                        }, {
                            "type": "web_fetch_tool_result",
                            "tool_use_id": block.tool_use_id,
                            "content": serialized_content
                        }, None

                # Handle content block delta
                elif event.type == "content_block_delta":
                    delta = event.delta

                    if delta.type == "thinking_delta":
                        current_thinking += delta.thinking
                        yield {"type": "thinking", "content": delta.thinking}, None, None

                    elif delta.type == "text_delta":
                        current_text += delta.text
                        yield {"type": "text", "content": delta.text}, None, None

                    elif delta.type == "input_json_delta":
                        if current_tool_use:
                            if "partial_json" not in current_tool_use:
                                current_tool_use["partial_json"] = ""
                            current_tool_use["partial_json"] += delta.partial_json
                            yield {
                                "type": "tool_input_delta",
                                "tool": current_tool_use["name"],
                                "delta": delta.partial_json
                            }, None, None

                # Handle content block stop
                elif event.type == "content_block_stop":
                    if in_thinking_block:
                        in_thinking_block = False
                        response_update = None
                        if current_thinking:
                            response_update = {
                                "type": "thinking",
                                "thinking": current_thinking
                            }
                        yield {"type": "thinking_end"}, response_update, None
                        current_thinking = ""

                    elif current_text:
                        yield None, {
                            "type": "text",
                            "text": current_text
                        }, None
                        current_text = ""

                    elif current_tool_use:
                        # Parse accumulated JSON
                        if "partial_json" in current_tool_use:
                            try:
                                current_tool_use["input"] = json.loads(
                                    current_tool_use["partial_json"]
                                )
                            except json.JSONDecodeError:
                                current_tool_use["input"] = {}
                            del current_tool_use["partial_json"]

                        # Yield response update and tool_use for execution
                        yield None, current_tool_use, current_tool_use
                        current_tool_use = None

                    elif current_server_tool:
                        # Server tool completed (web_search, web_fetch)
                        # Parse accumulated JSON if any
                        if "partial_json" in current_server_tool:
                            try:
                                current_server_tool["input"] = json.loads(
                                    current_server_tool["partial_json"]
                                )
                            except json.JSONDecodeError:
                                current_server_tool["input"] = {}
                            del current_server_tool["partial_json"]

                        # Don't add to tool_uses - server tools are handled by API
                        yield None, current_server_tool, None
                        current_server_tool = None

    async def _execute_tool(
        self,
        tool_use: dict[str, Any],
        files: list[dict[str, Any]],
        current_file_id: str,
        kb_context: dict[str, Any] | None,
        collected_edits: list[dict[str, Any]]
    ) -> AsyncIterator[dict[str, Any]]:
        """Execute a single tool and yield events."""
        tool_name = tool_use["name"]
        tool_input = tool_use["input"]
        tool_id = tool_use["id"]

        # Execute tool based on type
        if is_todo_tool(tool_name):
            result = execute_todo_tool(tool_input)
            # Emit todo update event for frontend
            if "todos" in result:
                yield {"type": "todo_update", "todos": result["todos"]}
        elif is_kb_tool(tool_name):
            result = await execute_kb_tool(tool_name, tool_input, kb_context)
        elif is_skill_tool(tool_name):
            result = await execute_skill_tool(tool_name, tool_input)
        else:
            result = execute_document_tool(tool_name, tool_input, files, current_file_id)

        # Handle result
        # Check if this is an actual edit operation (must have 'type' field with valid edit type)
        # TodoWrite returns {"success": True} but is NOT an edit operation
        if result.get("success") and result.get("type") in ("str_replace", "insert", "replace_all"):
            # This is an edit operation
            collected_edits.append(result)
            yield {"type": "edit", "edit": result}
            result_content = f"Edit prepared: {result['type']} on {result.get('file_name', 'document')}"
            yield {
                "type": "tool_end",
                "tool": tool_name,
                "tool_id": tool_id,
                "output": result_content,
                "success": True
            }
        elif result.get("error"):
            result_content = f"Error: {result['error']}"
            yield {
                "type": "tool_end",
                "tool": tool_name,
                "tool_id": tool_id,
                "output": result_content,
                "success": False
            }
        else:
            result_content = result.get("result", str(result))
            yield {
                "type": "tool_end",
                "tool": tool_name,
                "tool_id": tool_id,
                "output": result_content[:500] if isinstance(result_content, str) else str(result_content)[:500],
                "success": True
            }

        # Add instruction reinforcement to tool results
        # This helps keep the agent on track (Claude Code pattern)
        reinforced_content = self._add_tool_result_reminder(
            tool_name, result_content if isinstance(result_content, str) else str(result_content)
        )

        # Yield tool result for message history
        yield {
            "type": "tool_result",
            "result": {
                "type": "tool_result",
                "tool_use_id": tool_id,
                "content": reinforced_content
            }
        }

    def _add_tool_result_reminder(self, tool_name: str, result_content: str) -> str:
        """Add contextual reminders to tool results to reinforce good behavior.

        This pattern is borrowed from Claude Code - it helps keep the agent
        focused on using tools rather than writing long chat responses.

        Args:
            tool_name: Name of the tool that was executed
            result_content: The original result content

        Returns:
            Result content with appended reminder
        """
        # Skip reminder for todo tool (meta-tool)
        if tool_name == "TodoWrite":
            return result_content

        # Different reminders based on tool type
        if tool_name in ("view_document", "search_in_document"):
            reminder = "\n\n<reminder>Now use editing tools (str_replace_editor, insert_text) to make changes. Keep chat responses brief.</reminder>"
        elif tool_name in ("str_replace_editor", "insert_text", "replace_document"):
            # Key insight from Claude Code: remind to update todos after each edit
            reminder = "\n\n<reminder>Edit complete. If you have a todo list, call TodoWrite NOW to mark this task completed and the next task in_progress. Then continue with the next edit.</reminder>"
        elif tool_name in ("search_knowledge_base", "read_kb_document", "list_kb_documents"):
            reminder = "\n\n<reminder>Use this information to help the user. If editing is needed, use editing tools directly.</reminder>"
        elif tool_name in ("read_skill_instructions", "read_skill_template", "read_skill_knowledge"):
            reminder = "\n\n<reminder>Apply this guidance. Use editing tools to write content directly into the document.</reminder>"
        else:
            # Generic reminder for other tools
            reminder = "\n\n<reminder>Continue with the task. Prefer using tools over long chat responses.</reminder>"

        return result_content + reminder

    async def run(self, message: str, files: list[dict[str, Any]]) -> dict[str, Any]:
        """Run agent and return full response with edits.

        This is a convenience method that collects all streaming output.
        """
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
