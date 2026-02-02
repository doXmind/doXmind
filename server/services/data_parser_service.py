"""Data parser service for analyzing uploaded data files.

Provides parsing and preview generation for:
- CSV files
- Excel files (XLSX, XLS)
- JSON files

Unlike KB files, data files are NOT vectorized. They are parsed for preview
and then passed directly to Claude's code execution sandbox.
"""

import csv
import io
import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

# Maximum rows to include in preview
MAX_PREVIEW_ROWS = 5


class DataParserService:
    """Service for parsing data files and generating previews."""

    async def parse_file(
        self, content: bytes, filename: str, mime_type: str | None = None
    ) -> dict[str, Any]:
        """Parse a data file and return metadata + preview.

        Args:
            content: Raw file bytes
            filename: Original filename
            mime_type: MIME type (optional, will infer from extension)

        Returns:
            Dict with:
                - column_names: List of column names (for tabular data)
                - row_count: Total number of rows
                - preview_data: First N rows as list of dicts
                - file_type: Detected file type
        """
        ext = filename.lower().split(".")[-1] if "." in filename else ""

        try:
            if ext == "csv" or mime_type == "text/csv":
                return await self._parse_csv(content)
            elif ext in ("xlsx", "xls") or mime_type in (
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "application/vnd.ms-excel",
            ):
                return await self._parse_excel(content, ext)
            elif ext == "json" or mime_type == "application/json":
                return await self._parse_json(content)
            else:
                # For non-tabular files (txt, images), return minimal info
                return {
                    "column_names": None,
                    "row_count": 0,
                    "preview_data": None,
                    "file_type": ext or "unknown",
                }
        except Exception as e:
            logger.error(f"Error parsing file {filename}: {e}")
            return {
                "column_names": None,
                "row_count": 0,
                "preview_data": None,
                "file_type": ext or "unknown",
                "error": str(e),
            }

    async def _parse_csv(self, content: bytes) -> dict[str, Any]:
        """Parse CSV file."""
        # Try different encodings
        text = None
        for encoding in ["utf-8", "utf-8-sig", "latin-1", "cp1252"]:
            try:
                text = content.decode(encoding)
                break
            except UnicodeDecodeError:
                continue

        if text is None:
            raise ValueError("Unable to decode CSV file with supported encodings")

        # Parse CSV
        reader = csv.reader(io.StringIO(text))
        rows = list(reader)

        if not rows:
            return {
                "column_names": [],
                "row_count": 0,
                "preview_data": [],
                "file_type": "csv",
            }

        # First row is header
        column_names = rows[0]
        data_rows = rows[1:]

        # Generate preview
        preview_data = []
        for row in data_rows[:MAX_PREVIEW_ROWS]:
            row_dict = {}
            for i, value in enumerate(row):
                col_name = column_names[i] if i < len(column_names) else f"col_{i}"
                row_dict[col_name] = value
            preview_data.append(row_dict)

        return {
            "column_names": column_names,
            "row_count": len(data_rows),
            "preview_data": preview_data,
            "file_type": "csv",
        }

    async def _parse_excel(self, content: bytes, ext: str) -> dict[str, Any]:
        """Parse Excel file using openpyxl or xlrd."""
        try:
            import openpyxl

            # Load workbook from bytes
            wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True)
            ws = wb.active

            if ws is None:
                return {
                    "column_names": [],
                    "row_count": 0,
                    "preview_data": [],
                    "file_type": ext,
                }

            rows = list(ws.iter_rows(values_only=True))
            wb.close()

            if not rows:
                return {
                    "column_names": [],
                    "row_count": 0,
                    "preview_data": [],
                    "file_type": ext,
                }

            # First row is header
            column_names = [str(c) if c is not None else f"col_{i}" for i, c in enumerate(rows[0])]
            data_rows = rows[1:]

            # Generate preview
            preview_data = []
            for row in data_rows[:MAX_PREVIEW_ROWS]:
                row_dict = {}
                for i, value in enumerate(row):
                    col_name = column_names[i] if i < len(column_names) else f"col_{i}"
                    # Convert to JSON-serializable type
                    if value is None:
                        row_dict[col_name] = None
                    elif hasattr(value, "isoformat"):  # datetime
                        row_dict[col_name] = value.isoformat()
                    else:
                        row_dict[col_name] = str(value)
                preview_data.append(row_dict)

            return {
                "column_names": column_names,
                "row_count": len(data_rows),
                "preview_data": preview_data,
                "file_type": ext,
            }

        except ImportError:
            logger.warning("openpyxl not installed, Excel parsing disabled")
            return {
                "column_names": None,
                "row_count": 0,
                "preview_data": None,
                "file_type": ext,
                "error": "Excel parsing requires openpyxl package",
            }

    async def _parse_json(self, content: bytes) -> dict[str, Any]:
        """Parse JSON file."""
        text = content.decode("utf-8")
        data = json.loads(text)

        # Handle array of objects
        if isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict):
            # Get column names from first object
            column_names = list(data[0].keys())
            preview_data = data[:MAX_PREVIEW_ROWS]

            return {
                "column_names": column_names,
                "row_count": len(data),
                "preview_data": preview_data,
                "file_type": "json",
            }
        else:
            # Non-tabular JSON
            return {
                "column_names": None,
                "row_count": 1 if data else 0,
                "preview_data": [data] if data else None,
                "file_type": "json",
            }


# Singleton instance
_service: DataParserService | None = None


def get_data_parser_service() -> DataParserService:
    """Get the data parser service singleton."""
    global _service
    if _service is None:
        _service = DataParserService()
    return _service
