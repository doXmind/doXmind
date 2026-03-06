"""Web tools and code execution for the writing agent.

Client-side tools that replace Anthropic's server-side tools:
- web_search: Google Serper API
- web_fetch: httpx URL fetching with content extraction
- code_execution: Python subprocess execution
"""

import logging
import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import httpx

from config import get_settings
from services.serper_search_service import serper_search

logger = logging.getLogger(__name__)

WEB_TOOL_NAMES = {"web_search", "web_fetch", "code_execution"}

# Allowed base directory for data file storage
_DATA_FILES_BASE_DIR = os.path.join(tempfile.gettempdir(), "doxmind_data_files")

# Dangerous modules that should not be imported in sandboxed code execution
_BLOCKED_IMPORTS = {
    "subprocess",
    "shutil",
    "socket",
    "http.server",
    "xmlrpc",
    "ctypes",
    "multiprocessing",
    "signal",
    "importlib",
    "code",
    "codeop",
    "compileall",
    "py_compile",
}

_IMPORT_PATTERN = re.compile(r"^\s*(?:import|from)\s+([\w.]+)", re.MULTILINE)


def _validate_storage_path(src: str) -> bool:
    """Validate that storage_path is within the expected data files directory."""
    try:
        real_src = os.path.realpath(src)
        real_base = os.path.realpath(_DATA_FILES_BASE_DIR)
        return real_src.startswith(real_base + os.sep)
    except (ValueError, OSError):
        return False


def _safe_filename(filename: str) -> str:
    """Strip directory components from filename to prevent path traversal."""
    return os.path.basename(filename)


def _check_blocked_imports(code: str) -> str | None:
    """Check code for blocked imports. Returns error message or None if safe."""
    imports = _IMPORT_PATTERN.findall(code)
    for imp in imports:
        for blocked in _BLOCKED_IMPORTS:
            if imp == blocked or imp.startswith(blocked + "."):
                return f"Import '{imp}' is not allowed in sandboxed execution"
    return None


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
    """Execute web search using Google Serper API."""
    query = tool_input.get("query", "")
    if not query:
        return {"error": "Search query is required"}

    results = await serper_search(query, count=10)

    if results and "error" in results[0]:
        return {"error": results[0]["error"]}

    if not results:
        return {"result": "No results found for the query."}

    # Format results for the agent
    formatted = []
    idx = 1
    for r in results:
        if r.get("type") == "knowledgeGraph":
            formatted.append(
                f"## Knowledge Graph: {r['title']}\nURL: {r['url']}\n{r['snippet']}\n"
            )
        else:
            formatted.append(f"## {idx}. {r['title']}\nURL: {r['url']}\n{r['snippet']}\n")
            idx += 1

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

    # Check for blocked imports before execution
    import_error = _check_blocked_imports(code)
    if import_error:
        return {"error": import_error}

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

                    # Sanitize filename to prevent path traversal
                    safe_name = _safe_filename(filename)
                    dst = Path(tmpdir) / safe_name

                    # Prefer writing content bytes directly (always available in memory)
                    content = df.get("content")
                    if content:
                        if isinstance(content, bytes):
                            dst.write_bytes(content)
                        else:
                            dst.write_text(content, encoding="utf-8")
                        logger.info(f"Wrote data file to execution dir: {safe_name}")
                        continue

                    # Fallback: copy from disk — validate source path first
                    src = df.get("storage_path")
                    if src and _validate_storage_path(src) and Path(src).exists():
                        shutil.copy2(src, dst)
                        logger.info(f"Copied data file to execution dir: {safe_name}")
                    elif src and not _validate_storage_path(src):
                        logger.warning(f"Rejected storage_path outside allowed directory: {src}")
                    else:
                        logger.warning(
                            f"Data file not available for execution: {safe_name} "
                            f"(no content bytes, storage_path missing or not found)"
                        )

            # Write the code to a temp file
            code_file = Path(tmpdir) / "script.py"
            code_file.write_text(code, encoding="utf-8")

            # Run the code with restricted environment
            env = os.environ.copy()
            env["PYTHONDONTWRITEBYTECODE"] = "1"

            proc = subprocess.run(
                ["python", str(code_file)],
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=tmpdir,
                env=env,
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
