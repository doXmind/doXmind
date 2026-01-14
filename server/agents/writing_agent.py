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


# ============================================================================
# Knowledge Base Tools Definition
# ============================================================================

KB_TOOLS = [
    {
        "name": "search_knowledge_base",
        "description": """Search the conversation's knowledge base for relevant information.
Use this when you need to find specific information from attached documents (PDFs, DOCX, PPTX files).
Returns the most relevant excerpts from the documents.""",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query - be specific about what information you need"
                },
                "top_k": {
                    "type": "integer",
                    "description": "Number of results to return (default: 5, max: 10)",
                    "default": 5
                }
            },
            "required": ["query"]
        }
    },
    {
        "name": "read_kb_document",
        "description": """Read content from a specific document in the knowledge base.
Use this when you need to read through a document, or when search_knowledge_base found a document you want to explore further.""",
        "input_schema": {
            "type": "object",
            "properties": {
                "document_name": {
                    "type": "string",
                    "description": "The filename of the document to read (e.g., 'research-paper.pdf')"
                },
                "start_section": {
                    "type": "integer",
                    "description": "Starting section/chunk to read from (0-indexed, default: 0)",
                    "default": 0
                },
                "num_sections": {
                    "type": "integer",
                    "description": "Number of sections to read (default: 5)",
                    "default": 5
                }
            },
            "required": ["document_name"]
        }
    },
    {
        "name": "list_kb_documents",
        "description": "List all documents in the conversation's knowledge base. Use this to see what reference materials are available.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": []
        }
    }
]


def is_kb_tool(tool_name: str) -> bool:
    """Check if a tool is a KB tool that requires async execution."""
    return tool_name in ("search_knowledge_base", "read_kb_document", "list_kb_documents")


def execute_tool(tool_name: str, tool_input: dict, files: List[dict], current_file_id: Optional[str]) -> dict:
    """Execute a synchronous tool and return the result.

    Args:
        tool_name: Name of the tool to execute
        tool_input: Tool input parameters
        files: List of file contexts
        current_file_id: Current file ID

    Note: KB tools should use execute_kb_tool_async instead.
    """
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


async def execute_kb_tool_async(tool_name: str, tool_input: dict, kb_context: Optional[dict]) -> dict:
    """Execute KB-related tools asynchronously."""
    if not kb_context:
        return {"error": "No knowledge base available for this conversation."}

    conversation_id = kb_context.get("conversation_id")
    attachments = kb_context.get("attachments", [])

    if not conversation_id:
        return {"error": "No conversation context available."}

    if tool_name == "list_kb_documents":
        if not attachments:
            return {"result": "No documents in the knowledge base."}

        doc_list = []
        for att in attachments:
            doc_list.append(
                f"- **{att['filename']}** ({att['file_type'].upper()}, {att['chunk_count']} sections)"
            )
        return {"result": "Documents in knowledge base:\n" + "\n".join(doc_list)}

    elif tool_name == "search_knowledge_base":
        query = tool_input.get("query", "")
        top_k = min(tool_input.get("top_k", 5), 10)

        if not query:
            return {"error": "Search query is required."}

        from services.rag_service import RAGService
        try:
            rag = RAGService()
            results = await rag.search_kb(conversation_id, query, top_k)

            if not results:
                return {"result": f"No relevant results found for: '{query}'"}

            formatted_results = []
            for i, r in enumerate(results, 1):
                formatted_results.append(
                    f"**Result {i}** (from {r['source_file']}, relevance: {r['score']:.2f}):\n{r['content']}"
                )

            return {"result": "\n\n---\n\n".join(formatted_results)}
        except Exception as e:
            logger.error(f"KB search error: {e}")
            return {"error": f"Search failed: {str(e)}"}

    elif tool_name == "read_kb_document":
        document_name = tool_input.get("document_name", "")
        start_section = tool_input.get("start_section", 0)
        num_sections = tool_input.get("num_sections", 5)

        if not document_name:
            return {"error": "Document name is required."}

        # Find attachment by name
        attachment = None
        for att in attachments:
            if att['filename'].lower() == document_name.lower():
                attachment = att
                break
            # Also match partial names
            if document_name.lower() in att['filename'].lower():
                attachment = att
                break

        if not attachment:
            available = [att['filename'] for att in attachments]
            return {"error": f"Document '{document_name}' not found. Available: {', '.join(available)}"}

        from services.rag_service import RAGService
        try:
            rag = RAGService()
            result = await rag.get_kb_document_content(
                attachment['id'],
                start_section,
                start_section + num_sections
            )

            if not result['content']:
                return {"result": f"No content found in {document_name}"}

            return {
                "result": f"**{result['filename']}** (sections {start_section+1}-{start_section + result['chunks_returned']} of {result['total_chunks']}):\n\n{result['content']}"
            }
        except Exception as e:
            logger.error(f"KB read error: {e}")
            return {"error": f"Failed to read document: {str(e)}"}

    return {"error": f"Unknown KB tool: {tool_name}"}


class WritingAgent:
    """Writing agent using Claude API directly for real-time streaming."""

    def __init__(self, mode: str = "edit", enable_thinking: bool = False, kb_attachments: List[dict] = None):
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

        # Base tools based on mode
        base_tools = TOOLS if mode == "edit" else READONLY_TOOLS

        # Add KB tools if there are attachments
        if self.kb_attachments:
            self.tools = base_tools + KB_TOOLS
        else:
            self.tools = base_tools

    async def stream(
        self,
        message: str,
        files: List[dict],
        images: List[dict] = None,
        history: List[dict] = None,
        conversation_id: str = None
    ) -> AsyncIterator[dict]:
        """Stream agent response with real-time token streaming.

        Args:
            message: The current user message
            files: List of file contexts
            images: List of image contexts for multimodal support
            history: Previous conversation messages (last N messages for context)
            conversation_id: ID of the conversation (needed for KB tools)

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

        # Import KB prompt helper
        from agents.prompts import get_kb_context_prompt

        system_prompt = get_writing_system_prompt(
            mode=self.mode,
            files=files
        )

        # Add KB context to system prompt if attachments exist
        if self.kb_attachments:
            system_prompt += get_kb_context_prompt(self.kb_attachments)

        # Build current message content (supports multimodal with images)
        current_message_content = []

        # Add images first (Claude recommends images before text for best results)
        if images:
            logger.info(f"Processing {len(images)} image(s) for multimodal message")
            for i, img in enumerate(images):
                base64_data = img.get("base64")
                media_type = img.get("mediaType")
                logger.info(f"Image {i+1}: mediaType={media_type}, base64_length={len(base64_data) if base64_data else 0}")
                if base64_data and media_type:
                    # Add image block
                    current_message_content.append({
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": base64_data
                        }
                    })
                    # Add image label for multiple images
                    if len(images) > 1:
                        alt = img.get("alt", "")
                        label = f"Image {i+1}" + (f" ({alt})" if alt else "") + ":"
                        current_message_content.append({
                            "type": "text",
                            "text": label
                        })
        else:
            logger.info("No images provided for this message")

        # Add text message
        current_message_content.append({
            "type": "text",
            "text": message
        })

        # Build messages with history for conversation continuity
        messages = []
        if history:
            messages.extend(history)

        # Add current message (multimodal content if has images, otherwise simple string)
        if images and len(images) > 0:
            messages.append({"role": "user", "content": current_message_content})
        else:
            messages.append({"role": "user", "content": message})
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

                    # Prepare KB context for tools
                    kb_context = None
                    if self.kb_attachments and conversation_id:
                        kb_context = {
                            "conversation_id": conversation_id,
                            "attachments": self.kb_attachments
                        }

                    for tool_use in tool_uses:
                        tool_name = tool_use["name"]
                        tool_input = tool_use["input"]

                        # Execute tool - KB tools are async, others are sync
                        if is_kb_tool(tool_name):
                            result = await execute_kb_tool_async(tool_name, tool_input, kb_context)
                        else:
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
