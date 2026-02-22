"""OpenAI streaming response handler for the writing agent.

Handles real-time streaming of LLM API responses, parsing text content,
tool calls, reasoning tokens, and usage data.
"""

import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from openai import AsyncOpenAI

from agents.tools.definitions import to_openai_tools

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


async def stream_response(
    client: AsyncOpenAI,
    model: str,
    max_tokens: int,
    system_prompt: str,
    messages: list[dict[str, Any]],
    tools: list[dict] | None,
) -> AsyncIterator[StreamEvent]:
    """Stream API response in real-time, yielding events immediately.

    Yields tuples of (event, response_update, tool_use):
    - event: Event to send to client (text, tool_start, etc.)
    - response_update: Content block to add to full response
    - tool_use: Tool use to execute (only for client-side tools)
    """
    # Build OpenAI-format messages with system prompt as first message
    openai_messages = [{"role": "system", "content": system_prompt}] + messages

    # Convert Anthropic-style tool defs to OpenAI function-calling format
    openai_tools = to_openai_tools(tools) if tools else None

    logger.info(f"Starting API stream: model={model}, max_tokens={max_tokens}")

    # Track state
    state = StreamState()
    # For OpenAI streaming, tool calls are tracked by index
    tool_call_buffers: dict[int, dict] = {}  # index -> {id, name, arguments}
    finish_reason = None
    usage_data = None
    in_reasoning = False  # Track GLM reasoning phase

    stream = await client.chat.completions.create(
        model=model,
        max_tokens=max_tokens,
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
