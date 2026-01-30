"""Document type detection for optimal chunking strategy selection.

This module provides automatic detection of document types to select
the most appropriate chunking strategy for RAG indexing.
"""

import re
from enum import Enum


class DocumentType(Enum):
    """Enumeration of supported document types."""

    MARKDOWN = "markdown"
    CODE = "code"
    PLAIN_TEXT = "plain_text"


class DocumentTypeDetector:
    """Detect document type based on content and filename patterns.

    Uses a combination of:
    1. File extension hints (if filename provided)
    2. Content pattern matching
    3. Scoring based on pattern density

    Examples:
        >>> detector = DocumentTypeDetector()
        >>> detector.detect("# Title\\n\\n**Bold** text", "readme.md")
        DocumentType.MARKDOWN
        >>> detector.detect("def foo():\\n    return 42")
        DocumentType.CODE
    """

    # Markdown indicators (patterns that suggest Markdown content)
    MARKDOWN_PATTERNS = [
        r"^#{1,6}\s+",              # Headers (# H1, ## H2, etc.)
        r"^\s*[-*+]\s+",            # Unordered list items
        r"^\s*\d+\.\s+",            # Ordered list items
        r"\[.+\]\(.+\)",            # Links [text](url)
        r"!\[.*\]\(.+\)",           # Images ![alt](url)
        r"```[\w]*\n",              # Fenced code blocks
        r"\*\*[^*]+\*\*",           # Bold **text**
        r"__[^_]+__",               # Bold __text__
        r"(?<!\*)\*[^*]+\*(?!\*)",  # Italic *text*
        r"~~[^~]+~~",               # Strikethrough ~~text~~
        r"^\s*>\s+",                # Blockquotes
        r"\|[^\n]+\|",              # Tables
        r"`[^`]+`",                 # Inline code
    ]

    # Code indicators (patterns that suggest source code)
    CODE_PATTERNS = [
        # Function/class definitions
        r"^\s*(def|class|function|const|let|var|import|from|export)\s+",
        # Control flow
        r"^\s*(if|else|elif|for|while|switch|case|try|catch|except)\s*[({:]",
        # Access modifiers (Java, C#, etc.)
        r"^\s*(public|private|protected|static|final|abstract)\s+",
        # Line endings common in code
        r"[{};]\s*$",
        # Comments
        r"^\s*//.*$|^\s*/\*|^\s*#(?!#)",
        # Preprocessor directives
        r"^\s*#\s*(include|define|ifdef|ifndef|endif|pragma)",
        # Type annotations
        r":\s*(int|str|float|bool|list|dict|void|string|number)\s*[,=)\]]",
        # Arrow functions
        r"=>\s*[{(]",
        # Common code operators
        r"[!=]==|&&|\|\|",
    ]

    # File extensions that indicate document type
    MARKDOWN_EXTENSIONS = {"md", "markdown", "mdown", "mkd", "mdx"}
    CODE_EXTENSIONS = {
        "py", "js", "ts", "jsx", "tsx", "java", "cpp", "c", "h", "hpp",
        "go", "rs", "rb", "php", "swift", "kt", "scala", "cs", "fs",
        "lua", "r", "sql", "sh", "bash", "zsh", "ps1", "yaml", "yml",
        "json", "xml", "html", "css", "scss", "sass", "less"
    }

    def __init__(
        self,
        markdown_threshold: float = 0.15,
        code_threshold: float = 0.2
    ):
        """Initialize the detector with configurable thresholds.

        Args:
            markdown_threshold: Minimum pattern density to classify as Markdown.
                               A value of 0.15 means ~15% of lines should have
                               Markdown patterns.
            code_threshold: Minimum pattern density to classify as code.
        """
        self.markdown_threshold = markdown_threshold
        self.code_threshold = code_threshold
        self.markdown_regexes = [
            re.compile(p, re.MULTILINE) for p in self.MARKDOWN_PATTERNS
        ]
        self.code_regexes = [
            re.compile(p, re.MULTILINE) for p in self.CODE_PATTERNS
        ]

    def detect(
        self,
        content: str,
        filename: str | None = None
    ) -> DocumentType:
        """Detect document type from content and optional filename.

        Args:
            content: The document content to analyze
            filename: Optional filename for extension-based hints

        Returns:
            Detected DocumentType (MARKDOWN, CODE, or PLAIN_TEXT)
        """
        # Extension-based detection first (if filename provided)
        if filename:
            ext = self._get_extension(filename)
            if ext in self.MARKDOWN_EXTENSIONS:
                return DocumentType.MARKDOWN
            if ext in self.CODE_EXTENSIONS:
                return DocumentType.CODE

        # Content-based detection
        if not content.strip():
            return DocumentType.PLAIN_TEXT

        lines = content.split("\n")
        total_lines = len([line for line in lines if line.strip()])
        if total_lines == 0:
            return DocumentType.PLAIN_TEXT

        markdown_score = self._calculate_markdown_score(content, total_lines)
        code_score = self._calculate_code_score(content, total_lines)

        # Decision logic with clear precedence
        if markdown_score >= self.markdown_threshold and markdown_score > code_score:
            return DocumentType.MARKDOWN
        if code_score >= self.code_threshold:
            return DocumentType.CODE

        return DocumentType.PLAIN_TEXT

    def _get_extension(self, filename: str) -> str:
        """Extract lowercase file extension from filename."""
        if "." not in filename:
            return ""
        return filename.lower().rsplit(".", 1)[-1]

    def _calculate_markdown_score(self, content: str, total_lines: int) -> float:
        """Calculate how 'markdown-like' the content is.

        Returns a score between 0 and 1 representing the density
        of Markdown patterns in the content.
        """
        matches = sum(
            len(regex.findall(content)) for regex in self.markdown_regexes
        )
        # Normalize by total lines, cap at 1.0
        return min(matches / max(total_lines, 1), 1.0)

    def _calculate_code_score(self, content: str, total_lines: int) -> float:
        """Calculate how 'code-like' the content is.

        Returns a score between 0 and 1 representing the density
        of code patterns in the content.
        """
        matches = sum(
            len(regex.findall(content)) for regex in self.code_regexes
        )
        return min(matches / max(total_lines, 1), 1.0)


# Default detector instance
DEFAULT_DOCUMENT_DETECTOR = DocumentTypeDetector()
