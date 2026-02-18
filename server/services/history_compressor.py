"""
3-1-3 Conversation History Compression Service.

Compresses conversation history while preserving:
- First 2 messages (original user intent)
- Key notes extracted from middle messages
- Last 6 messages (recent context)
"""

import json
import re
from typing import Any, Protocol


class _MessageLike(Protocol):
    """Protocol for objects with role, content, and tool_calls attributes.

    Supports both full Message ORM objects and lightweight Row tuples
    from column-projected queries.
    """

    role: str
    content: str | None
    tool_calls: Any


class HistoryCompressor:
    """3-1-3 rule-based conversation history compression."""

    FIRST_MESSAGES_COUNT = 2  # Keep first 2 messages (1 turn)
    LAST_MESSAGES_COUNT = 6  # Keep last 6 messages (3 turns)
    COMPRESSION_THRESHOLD = 10  # Only compress if > 10 messages

    def compress(self, messages: list[_MessageLike]) -> list[dict[str, str]]:
        """
        Compress conversation history using 3-1-3 rule.

        Args:
            messages: List of Message objects in chronological order

        Returns:
            List of dicts with role/content for Claude API
        """
        if len(messages) <= self.COMPRESSION_THRESHOLD:
            # No compression needed
            history = self._to_history_format(messages)
            self._inject_todo_context(history, messages)
            return history

        first_messages = messages[: self.FIRST_MESSAGES_COUNT]
        last_messages = messages[-self.LAST_MESSAGES_COUNT :]
        middle_messages = messages[self.FIRST_MESSAGES_COUNT : -self.LAST_MESSAGES_COUNT]

        # Build compressed history
        history = []
        history.extend(self._to_history_format(first_messages))

        # Extract and inject key notes from middle
        key_notes = self._extract_key_notes(middle_messages)
        if key_notes:
            history.append(
                {
                    "role": "user",
                    "content": f"[Conversation Summary - {len(middle_messages)} messages compressed]\n{key_notes}",
                }
            )
            history.append(
                {
                    "role": "assistant",
                    "content": "Understood. I have the context from our previous discussion.",
                }
            )

        history.extend(self._to_history_format(last_messages))
        self._inject_todo_context(history, messages)
        return history

    def _extract_key_notes(self, messages: list[_MessageLike]) -> str:
        """
        Extract important information from middle messages.

        Extracts:
        - File paths mentioned in content
        - Files modified via tool calls
        - Key decisions/changes made
        """
        files_mentioned: set[str] = set()
        files_modified: set[str] = set()
        key_decisions: list[str] = []

        for msg in messages:
            content = msg.content or ""

            # Extract file paths from content (various formats)
            # Match paths like /path/to/file.py, ./file.py, file.py, etc.
            path_patterns = [
                r"[`\"']([/\w.-]+\.\w{1,10})[`\"']",  # Quoted paths
                r"(?:^|\s)(/[\w/.-]+\.\w{1,10})(?:\s|$)",  # Absolute paths
                r"(?:^|\s)(\.?/[\w/.-]+\.\w{1,10})(?:\s|$)",  # Relative paths
            ]
            for pattern in path_patterns:
                matches = re.findall(pattern, content)
                files_mentioned.update(m for m in matches if len(m) > 3)

            # Extract from tool_calls (JSON field)
            if msg.tool_calls:
                for tool in msg.tool_calls:
                    tool_name = tool.get("name", "")
                    tool_input = tool.get("input", {})
                    success = tool.get("success", False)

                    # Document editing tools
                    if (
                        tool_name in ["str_replace", "insert", "replace_all"]
                        and success
                        and isinstance(tool_input, dict)
                    ):
                        path = tool_input.get("path", "")
                        if path:
                            files_modified.add(path)

                    # KB tools
                    if tool_name in ["search_documents", "read_document"] and isinstance(
                        tool_input, dict
                    ):
                        query = tool_input.get("query", "")
                        if query:
                            key_decisions.append(f"Searched KB: {query[:50]}")

        # Format notes into concise summary
        sections = []

        if files_modified:
            sections.append(f"Files modified: {', '.join(sorted(files_modified)[:5])}")

        if files_mentioned - files_modified:
            other_files = files_mentioned - files_modified
            sections.append(f"Files discussed: {', '.join(sorted(other_files)[:5])}")

        if key_decisions:
            sections.append(f"Actions taken: {'; '.join(key_decisions[:3])}")

        return "\n".join(sections)

    def _to_history_format(self, messages: list[_MessageLike]) -> list[dict[str, str]]:
        """Convert Message objects to API format."""
        return [{"role": msg.role, "content": msg.content or ""} for msg in messages]

    def _extract_last_todo_state(self, messages: list[_MessageLike]) -> list[dict] | None:
        """Extract the most recent TodoWrite state from tool_calls in history."""
        for msg in reversed(messages):
            if msg.role == "assistant" and msg.tool_calls:
                for tool_call in reversed(msg.tool_calls):
                    if tool_call.get("name") == "TodoWrite":
                        input_str = tool_call.get("input", "")
                        if isinstance(input_str, str):
                            try:
                                parsed = json.loads(input_str)
                                return parsed.get("todos", [])
                            except (json.JSONDecodeError, ValueError):
                                pass
                        elif isinstance(input_str, dict):
                            return input_str.get("todos", [])
        return None

    def _inject_todo_context(
        self, history: list[dict[str, str]], messages: list[_MessageLike]
    ) -> None:
        """Inject incomplete todo context into history so the agent can resume tasks."""
        last_todos = self._extract_last_todo_state(messages)
        if not last_todos:
            return

        incomplete = [t for t in last_todos if t.get("status") in ("pending", "in_progress")]
        if not incomplete:
            return

        todo_lines = "\n".join(f"- [{t['status']}] {t['content']}" for t in last_todos)

        # Ensure alternating role pattern (last must be assistant before injecting user)
        if history and history[-1]["role"] == "user":
            history.append(
                {
                    "role": "assistant",
                    "content": "Understood, let me continue.",
                }
            )

        history.append(
            {
                "role": "user",
                "content": f"[Previous task list:]\n{todo_lines}\n\nPlease continue the incomplete tasks.",
            }
        )
        history.append(
            {
                "role": "assistant",
                "content": "I see the pending tasks. Let me continue working on them.",
            }
        )
