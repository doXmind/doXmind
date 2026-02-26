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
from typing import Any

import httpx
from openai import AsyncOpenAI

from agents.prompts import (
    get_kb_context_prompt,
    get_quick_edit_system_prompt,
    get_skills_metadata_prompt,
    get_writing_system_prompt,
)
from agents.stream_handler import stream_response
from agents.tool_executor import ToolExecutor
from agents.tools.definitions import get_tools_for_mode
from config import get_settings
from services.skills_service import get_skills_service

logger = logging.getLogger(__name__)


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
        is_quick_edit: bool = False,
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
            is_quick_edit: Quick edit mode - optimizes for direct text editing
        """
        self.mode = mode
        self.is_quick_edit = is_quick_edit
        self.kb_attachments = kb_attachments or []
        self.data_files_metadata = data_files_metadata or []
        self.web_search_enabled = web_search_enabled
        self.code_execution_enabled = True  # Always enabled
        self.db = db

        # Check if skills are available
        self.has_skills = bool(get_skills_service().list_skills())

        settings = get_settings()

        # Store user API key for passing to sub-services (RAG, etc.)
        self._user_api_key = api_key

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

        # Get tools
        tools = get_tools_for_mode(
            mode,
            has_kb_attachments=bool(self.kb_attachments),
            has_skills=self.has_skills,
            web_search_enabled=web_search_enabled,
            is_quick_edit=self.is_quick_edit,
        )

        # Create tool executor
        self.tool_executor = ToolExecutor(settings, tools)

    def _get_extra_system_prompt(self) -> str:
        """Hook for subclasses to append extra sections to the system prompt."""
        return ""

    async def stream(
        self,
        message: str,
        files: list[dict[str, Any]],
        images: list[dict[str, Any]] = None,
        data_files: list[dict[str, Any]] = None,
        history: list[dict[str, Any]] = None,
        conversation_id: str = None,
        global_kb_context: dict[str, Any] | None = None,
        file_mgmt_context: dict[str, Any] | None = None,
        community_context: dict[str, Any] | None = None,
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

        # Build system prompt
        if self.is_quick_edit:
            # Minimal prompt for quick edit: ~500 tokens vs ~4000+ for full prompt
            system_prompt = get_quick_edit_system_prompt(files)
        else:
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

        # Hook for subclasses to append extra system prompt sections
        system_prompt += self._get_extra_system_prompt()

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
                global_kb_context=global_kb_context,
                file_mgmt_context=file_mgmt_context,
                community_context=community_context,
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

    # =========================================================================
    # Message Building
    # =========================================================================

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

        Uses OpenAI vision format:
        [{type: "text", text: ...}, {type: "image_url", image_url: {url: "data:..."}}]
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

    # =========================================================================
    # Context Building
    # =========================================================================

    def _build_kb_context(self, conversation_id: str = None) -> dict[str, Any] | None:
        """Build KB context for tool execution."""
        if not self.kb_attachments or not conversation_id:
            return None

        return {
            "conversation_id": conversation_id,
            "attachments": self.kb_attachments,
            "db": self.db,
            "api_key": self._user_api_key,
        }

    def _build_data_files_context(
        self, data_files_with_content: list[dict[str, Any]] | None = None
    ) -> dict[str, Any] | None:
        """Build data files context for tool execution.

        Merges metadata (storage_path, column info) with file content bytes
        so code execution can write files directly to the sandbox.
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

    # =========================================================================
    # Agent Loop
    # =========================================================================

    async def _agent_loop(
        self,
        system_prompt: str,
        messages: list[dict[str, Any]],
        files: list[dict[str, Any]],
        current_file_id: str,
        kb_context: dict[str, Any] | None,
        data_files_context: dict[str, Any] | None,
        collected_edits: list[dict[str, Any]],
        global_kb_context: dict[str, Any] | None = None,
        file_mgmt_context: dict[str, Any] | None = None,
        community_context: dict[str, Any] | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """Main agent loop handling streaming and tool execution."""
        iteration = 0
        total_input_tokens = 0
        total_output_tokens = 0
        total_cost = 0.0

        # Track todo state for completion guard
        current_todos: list[dict] = []
        continuation_attempts = 0
        MAX_CONTINUATION_ATTEMPTS = 2

        while iteration < self.MAX_ITERATIONS:
            iteration += 1

            # Stream response and yield events in real-time
            assistant_text = ""
            tool_uses = []

            output_truncated = False

            async for event, response_update, tool_use in stream_response(
                self.client,
                self.model,
                self.max_tokens,
                system_prompt,
                messages,
                self.tool_executor.tools,
                provider_sort=self.settings.openrouter_provider_sort,
            ):
                # Accumulate token usage from each API call
                if event and event.get("type") == "usage":
                    total_input_tokens += event.get("input_tokens", 0)
                    total_output_tokens += event.get("output_tokens", 0)
                    total_cost += event.get("cost", 0) or 0
                    continue

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

            # Handle truncation: skip incomplete tools
            if output_truncated:
                logger.warning(
                    f"Output truncated. Tool uses collected: {[t['name'] for t in tool_uses]}"
                )
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
                    continue
                break

            # Add assistant message to history
            messages.append(full_response)

            # Execute tools and collect results
            tool_result_messages = []
            for tool_use in tool_uses:
                async for event in self.tool_executor.execute(
                    tool_use,
                    files,
                    current_file_id,
                    kb_context,
                    data_files_context,
                    collected_edits,
                    current_todos,
                    global_kb_context=global_kb_context,
                    file_mgmt_context=file_mgmt_context,
                    community_context=community_context,
                ):
                    if event.get("type") == "tool_result":
                        tool_result_messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": event["result"]["tool_use_id"],
                                "content": event["result"]["content"],
                            }
                        )
                    else:
                        yield event

            # Add tool results to messages
            messages.extend(tool_result_messages)

        # Yield accumulated usage after all iterations
        yield {
            "type": "usage",
            "input_tokens": total_input_tokens,
            "output_tokens": total_output_tokens,
            "cost": total_cost if total_cost > 0 else None,
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

        return {"response": full_response, "edits": all_edits}
