"""Web tools and code execution for the writing agent.

Client-side tools that replace Anthropic's server-side tools:
- web_search: Brave Search API
- web_fetch: httpx URL fetching with content extraction
- code_execution: Python subprocess execution
"""

import logging
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import httpx

from config import get_settings
from services.brave_search_service import brave_search

logger = logging.getLogger(__name__)

WEB_TOOL_NAMES = {"web_search", "web_fetch", "code_execution"}


def is_web_tool(tool_name: str) -> bool:
    """Check if a tool name is a web/code execution tool."""
    return tool_name in WEB_TOOL_NAMES


async def execute_web_tool(
    tool_name: str,
    tool_input: dict[str, Any],
    data_files_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Execute a web or code execution tool.

    Args:
        tool_name: Name of the tool to execute
        tool_input: Tool input parameters
        data_files_context: Data files context for code execution

    Returns:
        Tool result dict with 'result' or 'error' key
    """
    if tool_name == "web_search":
        return await _execute_web_search(tool_input)
    elif tool_name == "web_fetch":
        return await _execute_web_fetch(tool_input)
    elif tool_name == "code_execution":
        return await _execute_code(tool_input, data_files_context)
    else:
        return {"error": f"Unknown web tool: {tool_name}"}


async def _execute_web_search(tool_input: dict[str, Any]) -> dict[str, Any]:
    """Execute web search using Brave Search API."""
    query = tool_input.get("query", "")
    if not query:
        return {"error": "Search query is required"}

    results = await brave_search(query, count=10)

    if results and "error" in results[0]:
        return {"error": results[0]["error"]}

    if not results:
        return {"result": "No results found for the query."}

    # Format results for the agent
    formatted = []
    for i, r in enumerate(results, 1):
        formatted.append(f"## {i}. {r['title']}\nURL: {r['url']}\n{r['snippet']}\n")

    return {"result": "\n".join(formatted)}


async def _execute_web_fetch(tool_input: dict[str, Any]) -> dict[str, Any]:
    """Fetch and extract content from a URL."""
    url = tool_input.get("url", "")
    if not url:
        return {"error": "URL is required"}

    try:
        async with httpx.AsyncClient(
            timeout=15.0,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; DoXmind/1.0)"},
        ) as client:
            response = await client.get(url)
            response.raise_for_status()

        content_type = response.headers.get("content-type", "")
        if "text/html" in content_type:
            text = _extract_text_from_html(response.text)
        else:
            text = response.text

        # Truncate if too long
        max_chars = 30000
        if len(text) > max_chars:
            text = text[:max_chars] + "\n\n... (content truncated)"

        return {"result": f"Content from {url}:\n\n{text}"}

    except httpx.HTTPStatusError as e:
        return {"error": f"HTTP error {e.response.status_code} fetching {url}"}
    except Exception as e:
        return {"error": f"Failed to fetch {url}: {str(e)}"}


def _extract_text_from_html(html: str) -> str:
    """Extract readable text from HTML content."""
    try:
        from html.parser import HTMLParser

        class TextExtractor(HTMLParser):
            def __init__(self):
                super().__init__()
                self.parts = []
                self._skip = False
                self._skip_tags = {"script", "style", "nav", "footer", "header"}

            def handle_starttag(self, tag, _attrs):
                if tag in self._skip_tags:
                    self._skip = True
                if tag in ("p", "div", "br", "h1", "h2", "h3", "h4", "h5", "h6", "li"):
                    self.parts.append("\n")

            def handle_endtag(self, tag):
                if tag in self._skip_tags:
                    self._skip = False

            def handle_data(self, data):
                if not self._skip:
                    text = data.strip()
                    if text:
                        self.parts.append(text)

        extractor = TextExtractor()
        extractor.feed(html)
        text = " ".join(extractor.parts)
        # Clean up whitespace
        import re

        text = re.sub(r"\n{3,}", "\n\n", text)
        text = re.sub(r" {2,}", " ", text)
        return text.strip()
    except Exception:
        # Fallback: strip all tags
        import re

        return re.sub(r"<[^>]+>", " ", html).strip()


async def _execute_code(
    tool_input: dict[str, Any],
    data_files_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Execute Python code in a subprocess.

    Data files from the conversation are copied into the execution directory
    so Python code can access them directly by filename (e.g., pd.read_csv("order_items.csv")).

    Args:
        tool_input: Must contain 'code' key with Python code string
        data_files_context: Optional context with data files metadata (including storage_path)

    Returns:
        Dict with stdout, stderr, and return_code
    """
    import shutil

    code = tool_input.get("code", "")
    if not code:
        return {"error": "Python code is required"}

    settings = get_settings()
    timeout = settings.code_execution_timeout
    max_output = settings.code_execution_max_output

    try:
        # Create a temp directory for execution
        with tempfile.TemporaryDirectory(prefix="doxmind_exec_") as tmpdir:
            # Write data files into the execution directory
            if data_files_context:
                for df in data_files_context.get("data_files", []):
                    filename = df.get("filename")
                    if not filename:
                        continue

                    dst = Path(tmpdir) / filename

                    # Prefer writing content bytes directly (always available in memory)
                    content = df.get("content")
                    if content:
                        if isinstance(content, bytes):
                            dst.write_bytes(content)
                        else:
                            dst.write_text(content, encoding="utf-8")
                        logger.info(f"Wrote data file to execution dir: {filename}")
                        continue

                    # Fallback: copy from disk if content bytes not available
                    src = df.get("storage_path")
                    if src and Path(src).exists():
                        shutil.copy2(src, dst)
                        logger.info(f"Copied data file to execution dir: {filename}")
                    else:
                        logger.warning(
                            f"Data file not available for execution: {filename} "
                            f"(no content bytes, storage_path missing or not found)"
                        )

            # Write the code to a temp file
            code_file = Path(tmpdir) / "script.py"
            code_file.write_text(code, encoding="utf-8")

            # Run the code
            proc = subprocess.run(
                ["python", str(code_file)],
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=tmpdir,
            )

            stdout = proc.stdout[:max_output] if proc.stdout else ""
            stderr = proc.stderr[:max_output] if proc.stderr else ""

            result_parts = []
            if stdout:
                result_parts.append(f"Output:\n{stdout}")
            if stderr:
                result_parts.append(f"Errors:\n{stderr}")
            if not result_parts:
                result_parts.append("Code executed successfully (no output)")

            return {
                "result": "\n\n".join(result_parts),
                "return_code": proc.returncode,
            }

    except subprocess.TimeoutExpired:
        return {"error": f"Code execution timed out after {timeout} seconds"}
    except Exception as e:
        return {"error": f"Code execution failed: {str(e)}"}
