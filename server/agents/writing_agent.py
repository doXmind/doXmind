"""Writing Agent for AI-assisted document editing.

This agent uses OpenRouter API for real-time streaming,
with document editing tools similar to Cursor for code editing.

Supports:
- Real-time text streaming (token by token)
- Tool use with proper event handling
- Skill tools for accessing templates and knowledge
- Web search (Brave Search) and code execution (Python subprocess)
"""

import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

import httpx
from openai import AsyncOpenAI

from agents.prompts import (
    get_kb_context_prompt,
    get_skills_metadata_prompt,
    get_writing_system_prompt,
)
from agents.tools.data_files_tools import execute_data_files_tool, is_data_files_tool
from agents.tools.definitions import (
    get_external_tools_for_skill,
    get_tools_for_mode,
    to_openai_tools,
)
from agents.tools.document_tools import execute_document_tool
from agents.tools.kb_tools import execute_kb_tool, is_kb_tool
from agents.tools.legal_tools import execute_legal_tool, is_legal_tool
from agents.tools.skill_tools import execute_skill_tool, is_skill_tool
from agents.tools.todo_tools import execute_todo_tool, is_todo_tool
from agents.tools.web_tools import execute_web_tool, is_web_tool
from config import get_settings
from services.skills_service import get_skills_service

logger = logging.getLogger(__name__)

# Type alias for the 3-tuple yielded by stream handlers
StreamEvent = tuple[dict | None, dict | None, dict | None]


@dataclass
class StreamState:
    """Mutable state tracked during a single streaming API response."""

    current_text: str = ""
    current_tool_use: dict | None = None
    stop_reason: str | None = None
    event_count: int = 0
    tool_uses_started: list = field(default_factory=list)


class WritingAgent:
    """Writing agent using Claude API directly for real-time streaming."""

    # Maximum tool use iterations to prevent infinite loops
    # Industry comparison: Claude Code = unlimited, Cursor MAX = 200, Cursor standard = 25
    MAX_ITERATIONS = 50

    def __init__(
        self,
        mode: str = "edit",
        kb_attachments: list[dict[str, Any]] = None,
        data_files_metadata: list[dict[str, Any]] = None,
        web_search_enabled: bool = False,
        db=None,
        api_key: str | None = None,
        model: str | None = None,
    ):
        """Initialize the writing agent.

        Args:
            mode: "edit" for full editing tools, "analyze" for read-only
            kb_attachments: List of KB attachments for this conversation
            data_files_metadata: List of data files metadata (for system prompt)
            web_search_enabled: Enable web search tool (Brave Search)
            db: Database session for RAG operations
            api_key: User's OpenRouter API key (uses server key if not provided)
            model: User's preferred model (uses default if not provided)
        """
        self.mode = mode
        self.kb_attachments = kb_attachments or []
        self.data_files_metadata = data_files_metadata or []
        self.web_search_enabled = web_search_enabled
        self.code_execution_enabled = True  # Always enabled
        self.db = db

        # Check if skills are available
        self.has_skills = bool(get_skills_service().list_skills())

        settings = get_settings()

        # Use user's API key if provided, otherwise fall back to server key
        effective_api_key = api_key or settings.openrouter_api_key
        if not effective_api_key:
            raise ValueError("No API key available")

        # Use user's model preference if provided, otherwise use default
        effective_model = model or settings.default_model

        # Configure longer timeout for streaming responses
        self.client = AsyncOpenAI(
            api_key=effective_api_key,
            base_url=settings.openrouter_base_url,
            timeout=httpx.Timeout(connect=30.0, read=300.0, write=30.0, pool=30.0),
        )
        self.model = effective_model
        self.max_tokens = settings.max_output_tokens
        self.settings = settings
        self.using_user_key = bool(api_key)

        # Get tools (external tools like LEGAL_TOOLS are added dynamically
        # when their associated skill is read via SKILL_EXTERNAL_TOOLS mapping)
        self.tools = get_tools_for_mode(
            mode,
            has_kb_attachments=bool(self.kb_attachments),
            has_skills=self.has_skills,
            web_search_enabled=web_search_enabled,
        )

        # Track which skills have been activated (for dynamic tool loading)
        self._activated_skill_tools: set[str] = set()

    async def stream(
        self,
        message: str,
        files: list[dict[str, Any]],
        images: list[dict[str, Any]] = None,
        data_files: list[dict[str, Any]] = None,
        history: list[dict[str, Any]] = None,
        conversation_id: str = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """Stream agent response with real-time token streaming.

        Args:
            message: The current user message
            files: List of file contexts
            images: List of image contexts for multimodal support
            data_files: List of data files for code execution (CSV, Excel, etc.)
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

        # Build system prompt (includes data files metadata for agent awareness)
        system_prompt = get_writing_system_prompt(
            mode=self.mode,
            files=files,
            data_files_metadata=self.data_files_metadata if self.data_files_metadata else None,
        )
        if self.kb_attachments:
            system_prompt += get_kb_context_prompt(self.kb_attachments)

        # Inject skills metadata if available (progressive disclosure pattern)
        if self.has_skills:
            skills_metadata = get_skills_service().list_skills()
            system_prompt += get_skills_metadata_prompt(skills_metadata)

        # Build messages (async to support file uploads)
        messages = await self._build_messages(message, images, data_files, history)

        # Track state
        collected_edits = []
        current_file_id = files[0]["id"] if files else None
        kb_context = self._build_kb_context(conversation_id)
        data_files_context = self._build_data_files_context(data_files)

        try:
            # Main agent loop
            async for event in self._agent_loop(
                system_prompt=system_prompt,
                messages=messages,
                files=files,
                current_file_id=current_file_id,
                kb_context=kb_context,
                data_files_context=data_files_context,
                collected_edits=collected_edits,
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

    async def _build_messages(
        self,
        message: str,
        images: list[dict[str, Any]] = None,
        data_files: list[dict[str, Any]] = None,
        history: list[dict[str, Any]] = None,
    ) -> list[dict[str, Any]]:
        """Build the messages list for the API call."""

        messages = []

        # Add history
        if history:
            messages.extend(history)

        # Build current message content
        has_multimodal = images or data_files
        if has_multimodal:
            content = await self._build_multimodal_content(message, images, data_files)
            messages.append({"role": "user", "content": content})
        else:
            messages.append({"role": "user", "content": message})

        return messages

    async def _build_multimodal_content(
        self,
        message: str,
        images: list[dict[str, Any]] = None,
        data_files: list[dict[str, Any]] = None,
    ) -> list[dict[str, Any]]:
        """Build multimodal content with images, data files, and text.

        Uses OpenAI vision format: [{type: "text", text: ...}, {type: "image_url", image_url: {url: "data:..."}}]
        """
        import base64

        content = []
        images = images or []
        data_files = data_files or []

        # Add images first
        for i, img in enumerate(images):
            base64_data = img.get("base64")
            media_type = img.get("mediaType")

            if base64_data and media_type:
                content.append(
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{media_type};base64,{base64_data}"},
                    }
                )
                # Add label for multiple images
                if len(images) > 1:
                    alt = img.get("alt", "")
                    label = f"Image {i + 1}" + (f" ({alt})" if alt else "") + ":"
                    content.append({"type": "text", "text": label})

        # Add data files
        for data_file in data_files:
            file_content = data_file.get("content")
            mime_type = data_file.get("mime_type", "application/octet-stream")
            filename = data_file.get("filename", "data")

            if file_content:
                # For images in data_files, use image_url type
                if mime_type.startswith("image/"):
                    if isinstance(file_content, bytes):
                        encoded = base64.b64encode(file_content).decode("utf-8")
                    else:
                        encoded = file_content
                    content.append(
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime_type};base64,{encoded}"},
                        }
                    )
                    content.append({"type": "text", "text": f"File: {filename}"})
                else:
                    # For other files (CSV, Excel, JSON, etc.), include content as text
                    if isinstance(file_content, bytes):
                        try:
                            text_content = file_content.decode("utf-8")
                        except UnicodeDecodeError:
                            text_content = f"[Binary file: {filename}, {len(file_content)} bytes]"
                    else:
                        text_content = file_content

                    if self.code_execution_enabled:
                        # When code execution is available, include only a small preview
                        # to avoid the agent trying to analyze data mentally.
                        # The full file is available in the code execution sandbox.
                        lines = text_content.split("\n")
                        preview_lines = lines[:21]  # Header + 20 data rows
                        preview = "\n".join(preview_lines)
                        total_lines = len(lines)
                        content.append(
                            {
                                "type": "text",
                                "text": (
                                    f"--- Data file: {filename} (preview, {total_lines} lines total) ---\n"
                                    f"{preview}\n"
                                    f"... ({total_lines - len(preview_lines)} more rows)\n\n"
                                    f"⚠️ Use code_execution tool to analyze the full dataset. "
                                    f"Do NOT calculate from this preview."
                                ),
                            }
                        )
                    else:
                        # No code execution — include full content for inline analysis
                        max_chars = 50000
                        if len(text_content) > max_chars:
                            text_content = text_content[:max_chars] + "\n... (truncated)"
                        content.append(
                            {
                                "type": "text",
                                "text": f"--- Data file: {filename} ---\n{text_content}",
                            }
                        )

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
            "db": self.db,
        }

    def _build_data_files_context(
        self, data_files_with_content: list[dict[str, Any]] | None = None
    ) -> dict[str, Any] | None:
        """Build data files context for tool execution.

        Merges metadata (storage_path, column info) with file content bytes
        so code execution can write files directly to the sandbox without
        relying on temp files still being on disk.

        Args:
            data_files_with_content: List of data files with 'content' bytes
                (from chat.py's data_files_content)

        Returns:
            Context dict with enriched data files, or None
        """
        if not self.data_files_metadata:
            return None

        # Build a lookup of file content bytes by ID
        content_by_id: dict[str, bytes] = {}
        if data_files_with_content:
            for df in data_files_with_content:
                file_id = df.get("id")
                content = df.get("content")
                if file_id and content:
                    content_by_id[file_id] = content

        # Merge metadata with content bytes
        enriched_files = []
        for meta in self.data_files_metadata:
            entry = dict(meta)
            file_id = meta.get("id")
            if file_id and file_id in content_by_id:
                entry["content"] = content_by_id[file_id]
            enriched_files.append(entry)

        return {"data_files": enriched_files}

    async def _agent_loop(
        self,
        system_prompt: str,
        messages: list[dict[str, Any]],
        files: list[dict[str, Any]],
        current_file_id: str,
        kb_context: dict[str, Any] | None,
        data_files_context: dict[str, Any] | None,
        collected_edits: list[dict[str, Any]],
    ) -> AsyncIterator[dict[str, Any]]:
        """Main agent loop handling streaming and tool execution."""
        iteration = 0
        total_input_tokens = 0
        total_output_tokens = 0

        # Track todo state for completion guard
        current_todos: list[dict] = []
        continuation_attempts = 0
        MAX_CONTINUATION_ATTEMPTS = 2

        while iteration < self.MAX_ITERATIONS:
            iteration += 1

            # Stream response and yield events in real-time
            # OpenAI format: assistant message has content + tool_calls
            assistant_text = ""
            tool_uses = []  # Internal format: [{type, id, name, input}, ...]

            output_truncated = False

            async for event, response_update, tool_use in self._stream_response_realtime(
                system_prompt, messages
            ):
                # Accumulate token usage from each API call
                if event and event.get("type") == "usage":
                    total_input_tokens += event.get("input_tokens", 0)
                    total_output_tokens += event.get("output_tokens", 0)
                    continue  # Don't yield usage events yet

                # Check for truncation warning (max_tokens reached)
                if event and event.get("type") == "warning":
                    output_truncated = True
                    yield event
                    continue

                # Yield event immediately for real-time streaming
                if event:
                    yield event

                # Collect text content
                if response_update and response_update.get("type") == "text":
                    assistant_text += response_update.get("text", "")

                # Collect tool uses
                if tool_use:
                    tool_uses.append(tool_use)

            # Handle truncation: if output was truncated, incomplete tools should not be executed
            if output_truncated:
                logger.warning(
                    f"Output truncated. Tool uses collected: {[t['name'] for t in tool_uses]}"
                )
                # Only execute tools that were fully received (have complete input)
                # Tools with incomplete JSON input should be skipped
                valid_tool_uses = []
                for tu in tool_uses:
                    if tu.get("input") and isinstance(tu.get("input"), dict):
                        valid_tool_uses.append(tu)
                    else:
                        logger.warning(f"Skipping tool {tu['name']} due to incomplete input")
                        yield {
                            "type": "tool_end",
                            "tool": tu["name"],
                            "tool_id": tu["id"],
                            "output": "工具调用因输出截断而跳过",
                            "success": False,
                        }
                tool_uses = valid_tool_uses

            # Build the assistant message in OpenAI format
            full_response: dict[str, Any] = {"role": "assistant", "content": assistant_text or None}
            if tool_uses:
                full_response["tool_calls"] = [
                    {
                        "id": tu["id"],
                        "type": "function",
                        "function": {
                            "name": tu["name"],
                            "arguments": json.dumps(tu.get("input", {})),
                        },
                    }
                    for tu in tool_uses
                ]

            # If no tool uses, check for incomplete todos before exiting
            if not tool_uses:
                incomplete = [
                    t for t in current_todos if t.get("status") in ("pending", "in_progress")
                ]
                if (
                    incomplete
                    and iteration < self.MAX_ITERATIONS
                    and continuation_attempts < MAX_CONTINUATION_ATTEMPTS
                ):
                    continuation_attempts += 1
                    incomplete_names = ", ".join(
                        t.get("content", "unnamed") for t in incomplete[:5]
                    )
                    logger.info(
                        f"Completion guard: {len(incomplete)} incomplete todo(s), "
                        f"attempt {continuation_attempts}/{MAX_CONTINUATION_ATTEMPTS}"
                    )
                    messages.append(full_response)
                    messages.append(
                        {
                            "role": "user",
                            "content": (
                                f"[System: You have {len(incomplete)} incomplete todo(s): "
                                f"{incomplete_names}. "
                                f"Continue working on them. Call TodoWrite to update status, "
                                f"then use tools to complete each task.]"
                            ),
                        }
                    )
                    continue  # Re-enter the loop
                break

            # Add assistant message to history
            messages.append(full_response)

            # Execute tools and collect results
            tool_result_messages = []
            for tool_use in tool_uses:
                async for event in self._execute_tool(
                    tool_use,
                    files,
                    current_file_id,
                    kb_context,
                    data_files_context,
                    collected_edits,
                    current_todos,
                ):
                    if event.get("type") == "tool_result":
                        # OpenAI format: each tool result is a separate message
                        tool_result_messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": event["result"]["tool_use_id"],
                                "content": event["result"]["content"],
                            }
                        )
                    else:
                        yield event

            # Add tool results to messages (each as separate message in OpenAI format)
            messages.extend(tool_result_messages)

        # Yield accumulated usage after all iterations
        yield {
            "type": "usage",
            "input_tokens": total_input_tokens,
            "output_tokens": total_output_tokens,
        }

    async def _stream_response_realtime(
        self, system_prompt: str, messages: list[dict[str, Any]]
    ) -> AsyncIterator[tuple[dict | None, dict | None, dict | None]]:
        """Stream API response in real-time, yielding events immediately.

        Yields tuples of (event, response_update, tool_use):
        - event: Event to send to client (text, tool_start, etc.)
        - response_update: Content block to add to full response
        - tool_use: Tool use to execute (only for client-side tools)
        """
        # Build OpenAI-format messages with system prompt as first message
        openai_messages = [{"role": "system", "content": system_prompt}] + messages

        # Convert Anthropic-style tool defs to OpenAI function-calling format
        openai_tools = to_openai_tools(self.tools) if self.tools else None

        logger.info(f"Starting API stream: model={self.model}, max_tokens={self.max_tokens}")

        # Track state
        state = StreamState()
        # For OpenAI streaming, tool calls are tracked by index
        tool_call_buffers: dict[int, dict] = {}  # index -> {id, name, arguments}
        finish_reason = None
        usage_data = None
        in_reasoning = False  # Track GLM reasoning phase

        stream = await self.client.chat.completions.create(
            model=self.model,
            max_tokens=self.max_tokens,
            messages=openai_messages,
            tools=openai_tools,
            stream=True,
            stream_options={"include_usage": True},
        )

        async for chunk in stream:
            state.event_count += 1

            # Handle usage chunk (comes at the end with stream_options)
            if chunk.usage:
                usage_data = {
                    "input_tokens": chunk.usage.prompt_tokens or 0,
                    "output_tokens": chunk.usage.completion_tokens or 0,
                }

            if not chunk.choices:
                continue

            choice = chunk.choices[0]
            delta = choice.delta

            # Track finish reason
            if choice.finish_reason:
                finish_reason = choice.finish_reason

            # Handle GLM reasoning tokens (streamed in delta.reasoning)
            reasoning_text = getattr(delta, "reasoning", None) if delta else None
            if reasoning_text:
                if not in_reasoning:
                    in_reasoning = True
                    logger.debug("Reasoning phase started")
                yield ({"type": "thinking", "content": reasoning_text}, None, None)

            # Handle text content
            if delta and delta.content:
                # End reasoning phase when first content arrives
                if in_reasoning:
                    in_reasoning = False
                    yield ({"type": "thinking_end"}, None, None)
                state.current_text += delta.content
                yield ({"type": "text", "content": delta.content}, None, None)

            # Handle tool calls (streamed incrementally)
            if delta and delta.tool_calls:
                # End reasoning phase when tool calls start
                if in_reasoning:
                    in_reasoning = False
                    yield ({"type": "thinking_end"}, None, None)
                for tc_delta in delta.tool_calls:
                    idx = tc_delta.index

                    # New tool call starting
                    if idx not in tool_call_buffers:
                        tool_id = tc_delta.id or f"call_{idx}"
                        tool_name = tc_delta.function.name if tc_delta.function else ""
                        tool_call_buffers[idx] = {
                            "id": tool_id,
                            "name": tool_name,
                            "arguments": "",
                        }
                        if tool_name:
                            state.tool_uses_started.append(tool_name)
                            logger.info(f"Tool started: {tool_name}")
                            yield (
                                {
                                    "type": "tool_start",
                                    "tool": tool_name,
                                    "tool_id": tool_id,
                                    "input": {},
                                },
                                None,
                                None,
                            )

                    buf = tool_call_buffers[idx]

                    # Update tool name if provided (may come in later chunks)
                    if tc_delta.function and tc_delta.function.name and not buf["name"]:
                        buf["name"] = tc_delta.function.name
                        state.tool_uses_started.append(buf["name"])
                        logger.info(f"Tool started: {buf['name']}")
                        yield (
                            {
                                "type": "tool_start",
                                "tool": buf["name"],
                                "tool_id": buf["id"],
                                "input": {},
                            },
                            None,
                            None,
                        )

                    # Accumulate arguments
                    if tc_delta.function and tc_delta.function.arguments:
                        buf["arguments"] += tc_delta.function.arguments
                        yield (
                            {
                                "type": "tool_input_delta",
                                "tool": buf["name"],
                                "delta": tc_delta.function.arguments,
                            },
                            None,
                            None,
                        )

        # Stream finished — flush accumulated state

        # End reasoning phase if still active
        if in_reasoning:
            in_reasoning = False
            yield ({"type": "thinking_end"}, None, None)

        # Flush text content
        if state.current_text:
            yield (None, {"type": "text", "text": state.current_text}, None)
            state.current_text = ""

        # Flush tool calls
        for idx in sorted(tool_call_buffers.keys()):
            buf = tool_call_buffers[idx]
            try:
                tool_input = json.loads(buf["arguments"]) if buf["arguments"] else {}
            except json.JSONDecodeError:
                tool_input = {}
            tool_use = {
                "type": "tool_use",
                "id": buf["id"],
                "name": buf["name"],
                "input": tool_input,
            }
            yield (None, tool_use, tool_use)

        # Log stream completion
        logger.info(
            f"API stream completed: events={state.event_count}, "
            f"tools_started={state.tool_uses_started}, finish_reason={finish_reason}"
        )

        # Check for abnormal stream termination
        if finish_reason is None:
            logger.error(
                f"Stream ended without finish_reason! Tools started: {state.tool_uses_started}."
            )
            yield (
                {
                    "type": "warning",
                    "content": "API 响应异常中断，请重试",
                    "truncated_tools": state.tool_uses_started,
                },
                None,
                None,
            )
        elif finish_reason == "length":
            logger.warning(
                f"Output truncated due to max_tokens limit. "
                f"Tools started but may be incomplete: {state.tool_uses_started}"
            )
            yield (
                {
                    "type": "warning",
                    "content": "输出因 token 限制被截断，工具调用可能不完整",
                    "truncated_tools": state.tool_uses_started,
                },
                None,
                None,
            )

        # Yield usage
        if usage_data:
            yield (usage_data | {"type": "usage"}, None, None)
        else:
            yield ({"type": "usage", "input_tokens": 0, "output_tokens": 0}, None, None)

    async def _execute_tool(
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
                    self._activate_skill_external_tools(tool_input.get("skill_name", ""))
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
            display_output = self._format_tool_output_for_display(
                tool_name, tool_input, result_content
            )
            yield {
                "type": "tool_end",
                "tool": tool_name,
                "tool_id": tool_id,
                "output": display_output,
                "success": True,
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
                "content": reinforced_content,
            },
        }

    def _format_tool_output_for_display(
        self, tool_name: str, tool_input: dict[str, Any], result_content: Any
    ) -> str:
        """Format tool output for user-friendly display.

        Converts raw tool results into concise, readable summaries.

        Args:
            tool_name: Name of the tool
            tool_input: Input parameters passed to the tool
            result_content: Raw result from the tool

        Returns:
            Human-readable summary string
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
                # Count results in the response
                if "No relevant content found" in result_content:
                    return "Found 0 results"
                # Count markdown headers which indicate results
                result_count = result_content.count("## ")
                return f"Found {result_count} result{'s' if result_count != 1 else ''}"
            return "Searched knowledge base"

        if tool_name == "read_kb_document":
            doc_title = tool_input.get("document_title", "document")
            return f"Read {doc_title}"

        if tool_name == "list_kb_documents":
            if isinstance(result_content, str):
                # Count documents in the response
                doc_count = result_content.count("\n- ") + (1 if result_content.strip() else 0)
                return f"Found {doc_count} document{'s' if doc_count != 1 else ''}"
            return "Listed KB documents"

        # Data files tools
        if tool_name == "list_data_files":
            if isinstance(result_content, str):
                if "No data files" in result_content:
                    return "No data files uploaded"
                # Count data files
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
                # Count results
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

    def _activate_skill_external_tools(self, skill_name: str) -> None:
        """Dynamically add external tools when a skill's instructions are read.

        This enables lazy loading of skill-specific tools (like CourtListener
        for legal-writing) only when the skill is actually used, saving tokens.

        Args:
            skill_name: Name of the skill that was activated
        """
        if not skill_name or skill_name in self._activated_skill_tools:
            return  # Already activated or invalid

        external_tools = get_external_tools_for_skill(skill_name)
        if not external_tools:
            return  # No external tools for this skill

        # Check if required API keys/features are configured
        # For legal skill, check CourtListener API key
        if skill_name == "legal" and not self.settings.has_legal_tools:
            return  # API key not configured

        # Add tools to the agent's tool list
        for tool in external_tools:
            if tool not in self.tools:
                self.tools.append(tool)

        self._activated_skill_tools.add(skill_name)
        logger.info(f"Activated {len(external_tools)} external tool(s) for skill: {skill_name}")

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
        if tool_name == "get_document_outline":
            reminder = "\n\n<reminder>Use read_section(section_ids) to read specific sections before editing, or search_in_document to find content by keyword.</reminder>"
        elif tool_name in ("read_section", "view_document", "search_in_document"):
            reminder = "\n\n<reminder>Now use editing tools (str_replace_editor) to make changes. Keep chat responses brief.</reminder>"
        elif tool_name in ("str_replace_editor", "replace_document"):
            # Key insight from Claude Code: remind to update todos after each edit
            reminder = "\n\n<reminder>Edit complete. If you have a todo list, call TodoWrite NOW to mark this task completed and the next task in_progress. Then continue with the next edit.</reminder>"
        elif tool_name in ("search_knowledge_base", "read_kb_document", "list_kb_documents"):
            reminder = "\n\n<reminder>Use this information to help the user. If editing is needed, use editing tools directly.</reminder>"
        elif tool_name in (
            "read_skill_instructions",
            "read_skill_template",
            "read_skill_knowledge",
        ):
            reminder = "\n\n<reminder>Apply this guidance. Use editing tools to write content directly into the document.</reminder>"
        elif tool_name == "search_court_opinions":
            reminder = "\n\n<reminder>Use these case citations to support legal arguments. Cite the most relevant and authoritative cases.</reminder>"
        elif tool_name == "web_search":
            reminder = "\n\n<reminder>Use web_fetch to read specific pages if you need more details.</reminder>"
        elif tool_name == "web_fetch":
            reminder = "\n\n<reminder>Synthesize the fetched content to help the user.</reminder>"
        elif tool_name == "code_execution":
            reminder = "\n\n<reminder>Review the output and present the key findings to the user.</reminder>"
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

        return {"response": full_response, "edits": all_edits}
