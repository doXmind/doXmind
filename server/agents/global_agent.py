"""Global Agent - unified agent with all capabilities.

Combines WritingAgent's document editing with:
- Global document search (search_files, read_file_sections)
- File/folder management (create, rename, move, delete)
- Community access (search, fork, recommendations)

All tools from WritingAgent are inherited; global tools are appended.
"""

import logging
from collections.abc import AsyncIterator
from typing import Any

from agents.tools.definitions import COMMUNITY_TOOLS, FILE_MANAGEMENT_TOOLS, GLOBAL_KB_TOOLS
from agents.writing_agent import WritingAgent

logger = logging.getLogger(__name__)

# Additional system prompt section for global capabilities
GLOBAL_CAPABILITIES_PROMPT = """

<global_capabilities>
You are a GLOBAL agent with full workspace access beyond the current document.

<global_search>
Search across ALL user documents (not just the current one):
- search_files: Semantic + keyword search across all documents. Returns file_id, document name, and relevant excerpts.
- read_file_sections: Read specific sections from any document by file_id and section index.

When to use:
- User asks about content from other documents
- Need to reference or cross-check information across documents
- Research across the user's entire document library

These are DIFFERENT from conversation KB tools (search_knowledge_base) which only search uploaded attachments in the current conversation.
</global_search>

<file_management>
Full file and folder management:
- create_file: Create a new document (with optional content and parent folder)
- create_folder: Create a new folder (max 3 levels deep)
- rename_file: Rename any file or folder
- move_file: Move file/folder to a different location
- delete_file: Delete file/folder (moves to trash, recoverable)
- list_files: Browse folder contents (omit parent_id for root level)

Use these when the user wants to organize their workspace, create new documents, or manage files.
</file_management>

<community>
Access the community platform of published documents:
- search_community: Search published documents by keyword, tags, or sort order (newest/popular/most_viewed)
- fork_community_document: Copy a community document to the user's workspace using its share_token
- get_community_recommendations: Get personalized recommendations based on user activity

Use these when the user wants to discover, explore, or reuse community content.
</community>
</global_capabilities>"""


class GlobalAgent(WritingAgent):
    """Unified agent with all capabilities: editing + global search + file management + community."""

    def __init__(
        self,
        user_id: str,
        mode: str = "edit",
        kb_attachments: list[dict[str, Any]] = None,
        data_files_metadata: list[dict[str, Any]] = None,
        web_search_enabled: bool = False,
        db=None,
        api_key: str | None = None,
        model: str | None = None,
        is_quick_edit: bool = False,
    ):
        """Initialize GlobalAgent.

        Args:
            user_id: The authenticated user's ID (required for global operations)
            mode: "edit" for full editing tools, "analyze" for read-only
            kb_attachments: List of KB attachments for this conversation
            data_files_metadata: List of data files metadata
            web_search_enabled: Enable web search tool
            db: Database session for RAG and file operations
            api_key: User's API key (uses server key if not provided)
            model: User's preferred model (uses default if not provided)
            is_quick_edit: Quick edit mode (not recommended for GlobalAgent)
        """
        super().__init__(
            mode=mode,
            kb_attachments=kb_attachments,
            data_files_metadata=data_files_metadata,
            web_search_enabled=web_search_enabled,
            db=db,
            api_key=api_key,
            model=model,
            is_quick_edit=is_quick_edit,
        )
        self.user_id = user_id

        # Append global tools to the tool executor's tool set
        self.tool_executor.tools.extend(GLOBAL_KB_TOOLS)
        self.tool_executor.tools.extend(FILE_MANAGEMENT_TOOLS)
        self.tool_executor.tools.extend(COMMUNITY_TOOLS)

    def _get_extra_system_prompt(self) -> str:
        """Append global capabilities description to the system prompt."""
        return GLOBAL_CAPABILITIES_PROMPT

    async def stream(
        self,
        message: str,
        files: list[dict[str, Any]],
        images: list[dict[str, Any]] = None,
        data_files: list[dict[str, Any]] = None,
        history: list[dict[str, Any]] = None,
        conversation_id: str = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """Stream agent response with all global capabilities enabled.

        Overrides WritingAgent.stream() to inject global contexts.
        """
        # Build global contexts for tool execution
        global_kb_context = {
            "db": self.db,
            "user_id": self.user_id,
            "api_key": self._user_api_key,
        }
        file_mgmt_context = {
            "db": self.db,
            "user_id": self.user_id,
        }
        community_context = {
            "db": self.db,
            "user_id": self.user_id,
        }

        # Delegate to parent's stream with global contexts
        async for event in super().stream(
            message=message,
            files=files,
            images=images,
            data_files=data_files,
            history=history,
            conversation_id=conversation_id,
            global_kb_context=global_kb_context,
            file_mgmt_context=file_mgmt_context,
            community_context=community_context,
        ):
            yield event
