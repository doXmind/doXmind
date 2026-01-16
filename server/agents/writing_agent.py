"""Writing Agent for AI-assisted document editing.

This agent uses Claude's API directly for real-time streaming,
with document editing tools similar to Cursor for code editing.

Supports:
- Real-time text streaming (token by token)
- Extended thinking (streaming thinking content)
- Tool use with proper event handling
"""

import json
import logging
from collections.abc import AsyncIterator
from typing import Any

from anthropic import AsyncAnthropic

from agents.prompts import get_kb_context_prompt, get_writing_system_prompt
from agents.tools.definitions import get_tools_for_mode
from agents.tools.document_tools import execute_document_tool
from agents.tools.kb_tools import execute_kb_tool, is_kb_tool
from config import get_settings

logger = logging.getLogger(__name__)


class WritingAgent:
    """Writing agent using Claude API directly for real-time streaming."""

    # Maximum tool use iterations to prevent infinite loops
    MAX_ITERATIONS = 10

    def __init__(
        self,
        mode: str = "edit",
        enable_thinking: bool = False,
        kb_attachments: list[dict[str, Any]] = None
    ):
        """Initialize the writing agent.

        Args:
            mode: "edit" for full editing tools, "analyze" for read-only
            enable_thinking: Enable extended thinking for complex reasoning
            kb_attachments: List of KB attachments for this conversation
        """
        self.mode = mode
        self.enable_thinking = enable_thinking
        self.kb_attachments = kb_attachments or []

        settings = get_settings()
        api_key = settings.anthropic_api_key
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY is not set")

        self.client = AsyncAnthropic(api_key=api_key)
        self.model = settings.default_model
        self.max_tokens = settings.max_output_tokens

        # Get tools based on mode and KB availability
        self.tools = get_tools_for_mode(mode, bool(self.kb_attachments))

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
            "attachments": self.kb_attachments
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

            # Make API call and stream response
            full_response, tool_uses = await self._stream_response(
                system_prompt, messages
            )

            # Yield events from streaming
            async for event in full_response["events"]:
                yield event

            # If no tool uses, we're done
            if not tool_uses:
                break

            # Add assistant message to history
            messages.append(full_response["message"])

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

    async def _stream_response(
        self,
        system_prompt: str,
        messages: list[dict[str, Any]]
    ) -> tuple:
        """Stream a single API response and collect events."""
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

        events = []
        full_response = {"role": "assistant", "content": []}
        tool_uses = []

        async with self.client.messages.stream(**api_params) as stream:
            current_text = ""
            current_thinking = ""
            current_tool_use = None
            in_thinking_block = False

            async for event in stream:
                # Handle content block start
                if event.type == "content_block_start":
                    block = event.content_block

                    if block.type == "thinking":
                        in_thinking_block = True
                        current_thinking = ""
                        events.append({"type": "thinking_start"})

                    elif block.type == "text":
                        current_text = ""

                    elif block.type == "tool_use":
                        current_tool_use = {
                            "type": "tool_use",
                            "id": block.id,
                            "name": block.name,
                            "input": {}
                        }
                        events.append({
                            "type": "tool_start",
                            "tool": block.name,
                            "tool_id": block.id,
                            "input": {}
                        })

                # Handle content block delta
                elif event.type == "content_block_delta":
                    delta = event.delta

                    if delta.type == "thinking_delta":
                        events.append({"type": "thinking", "content": delta.thinking})
                        current_thinking += delta.thinking

                    elif delta.type == "text_delta":
                        events.append({"type": "text", "content": delta.text})
                        current_text += delta.text

                    elif delta.type == "input_json_delta":
                        if current_tool_use:
                            if "partial_json" not in current_tool_use:
                                current_tool_use["partial_json"] = ""
                            current_tool_use["partial_json"] += delta.partial_json
                            events.append({
                                "type": "tool_input_delta",
                                "tool": current_tool_use["name"],
                                "delta": delta.partial_json
                            })

                # Handle content block stop
                elif event.type == "content_block_stop":
                    if in_thinking_block:
                        in_thinking_block = False
                        if current_thinking:
                            full_response["content"].append({
                                "type": "thinking",
                                "thinking": current_thinking
                            })
                        events.append({"type": "thinking_end"})
                        current_thinking = ""

                    elif current_text:
                        full_response["content"].append({
                            "type": "text",
                            "text": current_text
                        })
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

                        full_response["content"].append(current_tool_use)
                        tool_uses.append(current_tool_use)
                        current_tool_use = None

        # Create async generator from events list
        async def event_generator():
            for e in events:
                yield e

        return {"message": full_response, "events": event_generator()}, tool_uses

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
        if is_kb_tool(tool_name):
            result = await execute_kb_tool(tool_name, tool_input, kb_context)
        else:
            result = execute_document_tool(tool_name, tool_input, files, current_file_id)

        # Handle result
        if result.get("success"):
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
                "output": result_content[:500],
                "success": True
            }

        # Yield tool result for message history
        yield {
            "type": "tool_result",
            "result": {
                "type": "tool_result",
                "tool_use_id": tool_id,
                "content": result_content
            }
        }

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
