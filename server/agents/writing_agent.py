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

import httpx
from anthropic import AsyncAnthropic

from agents.prompts import (
    get_kb_context_prompt,
    get_skills_metadata_prompt,
    get_writing_system_prompt,
)
from agents.tools.data_files_tools import execute_data_files_tool, is_data_files_tool
from agents.tools.definitions import get_external_tools_for_skill, get_tools_for_mode
from agents.tools.document_tools import execute_document_tool
from agents.tools.kb_tools import execute_kb_tool, is_kb_tool
from agents.tools.legal_tools import execute_legal_tool, is_legal_tool
from agents.tools.skill_tools import execute_skill_tool, is_skill_tool
from agents.tools.todo_tools import execute_todo_tool, is_todo_tool
from config import get_settings
from services.anthropic_files_service import AnthropicFilesService
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
        data_files_metadata: list[dict[str, Any]] = None,
        web_search_enabled: bool = False,
        code_execution_enabled: bool = False,
        db=None,
    ):
        """Initialize the writing agent.

        Args:
            mode: "edit" for full editing tools, "analyze" for read-only
            enable_thinking: Enable extended thinking for complex reasoning
            kb_attachments: List of KB attachments for this conversation
            data_files_metadata: List of data files metadata (for system prompt)
            web_search_enabled: Enable Anthropic web search tool
            code_execution_enabled: Enable Anthropic code execution tool
            db: Database session for RAG operations
        """
        self.mode = mode
        self.enable_thinking = enable_thinking
        self.kb_attachments = kb_attachments or []
        self.data_files_metadata = data_files_metadata or []
        self.web_search_enabled = web_search_enabled
        self.code_execution_enabled = code_execution_enabled
        self.db = db

        # Check if skills are available
        self.has_skills = bool(get_skills_service().list_skills())

        settings = get_settings()
        api_key = settings.anthropic_api_key
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY is not set")

        # Configure longer timeout for streaming responses
        # Default httpx timeout is 5 minutes, but streaming large content may need more
        timeout = httpx.Timeout(
            connect=30.0,  # Connection timeout
            read=300.0,  # Read timeout (5 minutes for streaming)
            write=30.0,  # Write timeout
            pool=30.0,  # Pool timeout
        )
        self.client = AsyncAnthropic(api_key=api_key, timeout=timeout)
        self.model = settings.default_model
        self.max_tokens = settings.max_output_tokens
        self.settings = settings

        # Files service for uploading data files to Anthropic (for code execution)
        self.files_service = AnthropicFilesService(self.client)

        # Get tools (external tools like LEGAL_TOOLS, DATA_FILES_TOOLS are added dynamically
        # when their associated skill is read via SKILL_EXTERNAL_TOOLS mapping)
        self.tools = get_tools_for_mode(
            mode,
            has_kb_attachments=bool(self.kb_attachments),
            has_skills=self.has_skills,
            web_search_enabled=web_search_enabled,
            web_search_max_uses=settings.web_search_max_uses,
            web_fetch_max_uses=settings.web_fetch_max_uses,
            code_execution_enabled=code_execution_enabled,
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

        # Build system prompt
        system_prompt = get_writing_system_prompt(mode=self.mode, files=files)
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
        data_files_context = self._build_data_files_context()

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
        """Build multimodal content with images, data files, and text."""
        import base64

        content = []
        images = images or []
        data_files = data_files or []

        # Add images first (Claude recommends images before text)
        for i, img in enumerate(images):
            base64_data = img.get("base64")
            media_type = img.get("mediaType")

            if base64_data and media_type:
                content.append(
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": media_type, "data": base64_data},
                    }
                )
                # Add label for multiple images
                if len(images) > 1:
                    alt = img.get("alt", "")
                    label = f"Image {i + 1}" + (f" ({alt})" if alt else "") + ":"
                    content.append({"type": "text", "text": label})

        # Add data files for code execution
        # Files are either: pre-uploaded to Claude (use file_id), or sent inline (base64)
        for data_file in data_files:
            file_content = data_file.get("content")
            mime_type = data_file.get("mime_type", "application/octet-stream")
            filename = data_file.get("filename", "data")
            claude_file_id = data_file.get("claude_file_id")
            claude_upload_status = data_file.get("claude_upload_status", "pending")
            file_size = data_file.get("file_size", 0)

            if file_content:
                # For images in data_files, use image type directly
                if mime_type.startswith("image/"):
                    if isinstance(file_content, bytes):
                        encoded = base64.b64encode(file_content).decode("utf-8")
                    else:
                        encoded = file_content
                    content.append(
                        {
                            "type": "image",
                            "source": {"type": "base64", "media_type": mime_type, "data": encoded},
                        }
                    )
                    content.append({"type": "text", "text": f"File: {filename}"})
                elif mime_type == "application/pdf":
                    # PDFs can use document type
                    if isinstance(file_content, bytes):
                        encoded = base64.b64encode(file_content).decode("utf-8")
                    else:
                        encoded = file_content
                    content.append(
                        {
                            "type": "document",
                            "source": {"type": "base64", "media_type": mime_type, "data": encoded},
                        }
                    )
                    content.append({"type": "text", "text": f"File: {filename}"})
                else:
                    # For other files (CSV, Excel, JSON, etc.), use Files API + container_upload
                    # This is required for code execution to access the files
                    #
                    # Optimized upload strategy:
                    # 1. If claude_file_id exists and ready -> use it directly (no upload)
                    # 2. If status is "skipped" (small file) -> upload now (fast, <500KB)
                    # 3. If status is "uploading" -> wait briefly then check, fallback to upload
                    # 4. If status is "pending/error" -> upload now

                    if claude_file_id and claude_upload_status == "ready":
                        # Pre-uploaded file - use directly (fastest path)
                        logger.info(f"Using pre-uploaded file {filename}: {claude_file_id}")
                        file_id = claude_file_id
                    elif claude_upload_status == "uploading":
                        # Background upload in progress - wait briefly then check
                        # This is a race condition edge case
                        import asyncio

                        await asyncio.sleep(0.5)  # Brief wait
                        # If still uploading after wait, just upload again
                        # The files service has caching by content hash
                        logger.info(f"File {filename} still uploading, uploading again...")
                        file_id = await self.files_service.upload_file(
                            content=file_content, filename=filename, mime_type=mime_type
                        )
                    else:
                        # Need to upload: skipped (small), pending, or error
                        logger.info(
                            f"Uploading file {filename} ({file_size} bytes, status={claude_upload_status})"
                        )
                        file_id = await self.files_service.upload_file(
                            content=file_content, filename=filename, mime_type=mime_type
                        )

                    if file_id:
                        content.append({"type": "container_upload", "file_id": file_id})
                        content.append(
                            {
                                "type": "text",
                                "text": f"Data file uploaded: {filename} (available at /mnt/user/{filename})",
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

    def _build_data_files_context(self) -> dict[str, Any] | None:
        """Build data files context for tool execution."""
        if not self.data_files_metadata:
            return None

        return {"data_files": self.data_files_metadata}

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

        while iteration < self.MAX_ITERATIONS:
            iteration += 1

            # Stream response and yield events in real-time
            full_response = {"role": "assistant", "content": []}
            tool_uses = []

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

                # Collect response content
                if response_update:
                    full_response["content"].append(response_update)

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

            # If no tool uses, we're done
            if not tool_uses:
                break

            # Add assistant message to history
            messages.append(full_response)

            # Execute tools and collect results
            tool_results = []
            for tool_use in tool_uses:
                async for event in self._execute_tool(
                    tool_use,
                    files,
                    current_file_id,
                    kb_context,
                    data_files_context,
                    collected_edits,
                ):
                    if event.get("type") == "tool_result":
                        tool_results.append(event["result"])
                    else:
                        yield event

            # Add tool results to messages
            messages.append({"role": "user", "content": tool_results})

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

        # Add beta headers for server-side tools
        beta_headers = ["web-fetch-2025-09-10"]  # Web fetch is always enabled (free)
        if self.web_search_enabled:
            beta_headers.append("web-search-2025-03-05")
        if self.code_execution_enabled:
            beta_headers.append("code-execution-2025-08-25")
            beta_headers.append("files-api-2025-04-14")  # Required for container_upload
        api_params["extra_headers"] = {"anthropic-beta": ",".join(beta_headers)}

        # Track stream state for debugging
        stop_reason = None
        event_count = 0
        tool_uses_started = []

        logger.info(f"Starting Claude API stream: model={self.model}, max_tokens={self.max_tokens}")

        async with self.client.messages.stream(**api_params) as stream:
            current_text = ""
            current_thinking = ""
            current_tool_use = None
            current_server_tool = None
            in_thinking_block = False

            async for event in stream:
                event_count += 1
                # Debug: log all event types to understand the stream
                if event.type == "content_block_start":
                    block = event.content_block
                    logger.debug(
                        f"content_block_start: type={block.type}, id={getattr(block, 'id', None)}"
                    )

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
                            "input": {},
                        }
                        tool_uses_started.append(block.name)
                        logger.info(f"Tool started: {block.name}")
                        yield (
                            {
                                "type": "tool_start",
                                "tool": block.name,
                                "tool_id": block.id,
                                "input": {},
                            },
                            None,
                            None,
                        )

                    # Handle server-side tools (web_search, web_fetch)
                    elif block.type == "server_tool_use":
                        current_server_tool = {
                            "type": "server_tool_use",
                            "id": block.id,
                            "name": block.name,
                            "input": {},
                        }
                        yield (
                            {
                                "type": "server_tool_start",
                                "tool": block.name,
                                "tool_id": block.id,
                            },
                            None,
                            None,
                        )

                    # Handle web search results
                    # Server tool results must be included in message history
                    elif block.type == "web_search_tool_result":
                        results = []
                        # Serialize content for message history
                        serialized_content = []
                        if hasattr(block, "content") and block.content:
                            for r in block.content:
                                if hasattr(r, "type") and r.type == "web_search_result":
                                    results.append(
                                        {
                                            "url": getattr(r, "url", ""),
                                            "title": getattr(r, "title", ""),
                                        }
                                    )
                                    serialized_content.append(
                                        {
                                            "type": "web_search_result",
                                            "url": getattr(r, "url", ""),
                                            "title": getattr(r, "title", ""),
                                            "encrypted_content": getattr(
                                                r, "encrypted_content", ""
                                            ),
                                            "page_age": getattr(r, "page_age", None),
                                        }
                                    )
                        # Emit end event for UI to show completion
                        yield (
                            {
                                "type": "server_tool_end",
                                "tool": "web_search",
                                "tool_id": block.tool_use_id,
                                "output": f"Found {len(results)} results",
                                "success": True,
                            },
                            None,
                            None,
                        )
                        yield (
                            {
                                "type": "web_search_result",
                                "tool_id": block.tool_use_id,
                                "results": results,
                            },
                            {
                                "type": "web_search_tool_result",
                                "tool_use_id": block.tool_use_id,
                                "content": serialized_content,
                            },
                            None,
                        )

                    # Handle web fetch results
                    # Server tool results must be included in message history
                    elif block.type == "web_fetch_tool_result":
                        url = ""
                        serialized_content = {}
                        if hasattr(block, "content"):
                            content = block.content
                            url = getattr(content, "url", "")
                            serialized_content = {
                                "url": url,
                                "content": getattr(content, "content", ""),
                                "title": getattr(content, "title", ""),
                            }
                        # Extract domain for display
                        domain = (
                            url.split("//")[-1].split("/")[0] if "//" in url else url.split("/")[0]
                        )
                        # Emit end event for UI to show completion
                        yield (
                            {
                                "type": "server_tool_end",
                                "tool": "web_fetch",
                                "tool_id": block.tool_use_id,
                                "output": f"Fetched {domain}",
                                "success": True,
                            },
                            None,
                            None,
                        )
                        yield (
                            {"type": "web_fetch_result", "tool_id": block.tool_use_id, "url": url},
                            {
                                "type": "web_fetch_tool_result",
                                "tool_use_id": block.tool_use_id,
                                "content": serialized_content,
                            },
                            None,
                        )

                    # Handle code execution results (bash)
                    # Note: The block type is "bash_code_execution_tool_result" for the newer API
                    elif block.type in (
                        "code_execution_tool_result",
                        "bash_code_execution_tool_result",
                    ):
                        result_content = {}
                        generated_files = []
                        logger.info(
                            f"Code execution result received: type={block.type}, tool_use_id={getattr(block, 'tool_use_id', None)}"
                        )

                        if hasattr(block, "content"):
                            content = block.content
                            # Handle list-based content (bash_code_execution_result items)
                            if isinstance(content, list):
                                for item in content:
                                    item_type = getattr(item, "type", None)
                                    if item_type in (
                                        "bash_code_execution_result",
                                        "code_execution_result",
                                    ):
                                        result_content = {
                                            "stdout": getattr(item, "stdout", ""),
                                            "stderr": getattr(item, "stderr", ""),
                                            "return_code": getattr(item, "return_code", 0),
                                        }
                                        # Handle generated files
                                        if hasattr(item, "files") and item.files:
                                            for f in item.files:
                                                generated_files.append(
                                                    {
                                                        "file_id": getattr(f, "file_id", ""),
                                                        "filename": getattr(f, "filename", ""),
                                                        "media_type": getattr(f, "media_type", ""),
                                                    }
                                                )
                            else:
                                # Handle direct content structure (legacy)
                                result_content = {
                                    "stdout": getattr(content, "stdout", ""),
                                    "stderr": getattr(content, "stderr", ""),
                                    "return_code": getattr(content, "return_code", 0),
                                }
                                # Handle generated files if any
                                if hasattr(content, "files") and content.files:
                                    for f in content.files:
                                        generated_files.append(
                                            {
                                                "file_id": getattr(f, "file_id", ""),
                                                "filename": getattr(f, "filename", ""),
                                                "media_type": getattr(f, "media_type", ""),
                                            }
                                        )
                        # Determine success based on return code
                        return_code = result_content.get("return_code", 0)
                        success = return_code == 0
                        # Format output summary
                        if generated_files:
                            output_summary = f"Generated {len(generated_files)} file(s)"
                        elif result_content.get("stderr"):
                            output_summary = "Execution completed with errors"
                        else:
                            output_summary = "Execution completed"
                        # Emit end event for UI to show completion
                        yield (
                            {
                                "type": "server_tool_end",
                                "tool": "code_execution",
                                "tool_id": block.tool_use_id,
                                "output": output_summary,
                                "success": success,
                            },
                            None,
                            None,
                        )
                        # Yield event for UI but DON'T add to message history
                        # Server-side tool results are already in the API's response
                        # and are automatically included in subsequent turns
                        # Adding them manually causes format validation errors
                        yield (
                            {
                                "type": "code_execution_result",
                                "tool_id": block.tool_use_id,
                                "stdout": result_content.get("stdout", ""),
                                "stderr": result_content.get("stderr", ""),
                                "return_code": return_code,
                                "files": generated_files,
                            },
                            None,
                            None,
                        )

                    else:
                        # Log unknown block types for debugging
                        logger.warning(
                            f"Unknown content_block type: {block.type}, attrs: {dir(block)}"
                        )

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
                            yield (
                                {
                                    "type": "tool_input_delta",
                                    "tool": current_tool_use["name"],
                                    "delta": delta.partial_json,
                                },
                                None,
                                None,
                            )

                # Handle content block stop
                elif event.type == "content_block_stop":
                    if in_thinking_block:
                        in_thinking_block = False
                        response_update = None
                        if current_thinking:
                            response_update = {"type": "thinking", "thinking": current_thinking}
                        yield {"type": "thinking_end"}, response_update, None
                        current_thinking = ""

                    elif current_text:
                        yield None, {"type": "text", "text": current_text}, None
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

                # Handle message_delta to capture stop_reason
                elif event.type == "message_delta":
                    if hasattr(event, "delta") and hasattr(event.delta, "stop_reason"):
                        stop_reason = event.delta.stop_reason
                        logger.info(f"Message stop_reason: {stop_reason}")

            # Log stream completion details
            logger.info(
                f"Claude API stream completed: events={event_count}, "
                f"tools_started={tool_uses_started}, stop_reason={stop_reason}"
            )

            # Check for abnormal stream termination
            if stop_reason is None:
                logger.error(
                    f"Stream ended without message_delta event! "
                    f"Tools started: {tool_uses_started}. This may indicate a network issue or API timeout."
                )
                # Yield warning for incomplete stream
                yield (
                    {
                        "type": "warning",
                        "content": "API 响应异常中断，请重试",
                        "truncated_tools": tool_uses_started,
                    },
                    None,
                    None,
                )

            # Check for truncation due to max_tokens
            elif stop_reason == "max_tokens":
                logger.warning(
                    f"Output truncated due to max_tokens limit. "
                    f"Tools started but may be incomplete: {tool_uses_started}"
                )
                # Notify about truncation - this helps debugging
                yield (
                    {
                        "type": "warning",
                        "content": "输出因 token 限制被截断，工具调用可能不完整",
                        "truncated_tools": tool_uses_started,
                    },
                    None,
                    None,
                )

            # After stream iteration, get usage from final message
            final_message = await stream.get_final_message()
            yield (
                {
                    "type": "usage",
                    "input_tokens": final_message.usage.input_tokens,
                    "output_tokens": final_message.usage.output_tokens,
                },
                None,
                None,
            )

    async def _execute_tool(
        self,
        tool_use: dict[str, Any],
        files: list[dict[str, Any]],
        current_file_id: str,
        kb_context: dict[str, Any] | None,
        data_files_context: dict[str, Any] | None,
        collected_edits: list[dict[str, Any]],
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
            else:
                result = execute_document_tool(tool_name, tool_input, files, current_file_id)
        except Exception as e:
            logger.error(f"Tool execution error for {tool_name}: {e}")
            result = {"error": f"Tool execution failed: {str(e)}"}

        # Handle result
        # Check if this is an actual edit operation (must have 'type' field with valid edit type)
        # TodoWrite returns {"success": True} but is NOT an edit operation
        if result.get("success") and result.get("type") in ("str_replace", "insert", "replace_all"):
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
            # Extract domain from URL
            domain = url.split("//")[-1].split("/")[0] if "//" in url else url.split("/")[0]
            return f"Fetched {domain}"

        # Document tools
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

        # For data-analysis skill, check code execution is enabled
        if skill_name == "data-analysis" and not self.code_execution_enabled:
            return  # Code execution not enabled

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
        if tool_name in ("view_document", "search_in_document"):
            reminder = "\n\n<reminder>Now use editing tools (str_replace_editor, insert_text) to make changes. Keep chat responses brief.</reminder>"
        elif tool_name in ("str_replace_editor", "insert_text", "replace_document"):
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
