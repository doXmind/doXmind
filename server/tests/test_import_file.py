"""Tests for local file conversion endpoints."""

import io
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from api import import_file
from api.import_file import (
    ALLOWED_EXTENSIONS,
    get_file_extension,
    markdown_to_html,
    strip_code_fences,
)
from exceptions import MarkerModelsRequiredError


class TestGetFileExtension:
    def test_returns_lowercase_extension(self):
        assert get_file_extension("Document.PDF") == ".pdf"

    def test_handles_no_extension(self):
        assert get_file_extension("README") == ""


class TestMarkdownToHtml:
    def test_converts_basic_markdown(self):
        html = markdown_to_html("# Title\n\nHello **world**")
        assert "<h1>Title</h1>" in html
        assert "<strong>world</strong>" in html

    def test_converts_tables(self):
        html = markdown_to_html("| A | B |\n|---|---|\n| 1 | 2 |")
        assert "<table>" in html


class TestStripCodeFences:
    def test_strips_markdown_fence(self):
        assert strip_code_fences("```markdown\n# Title\n```") == "# Title"

    def test_preserves_internal_fences(self):
        content = "# Title\n\n```ts\nconst x = 1\n```"
        assert strip_code_fences(content) == content


class TestConfiguration:
    def test_allowed_extensions(self):
        assert {".pdf", ".docx", ".pptx", ".md", ".markdown"}.issubset(ALLOWED_EXTENSIONS)


class TestConvertEndpoint:
    def test_converts_markdown_without_creating_file(self, sync_client: TestClient):
        response = sync_client.post(
            "/api/import/convert",
            files={"file": ("document.md", io.BytesIO(b"# Title"), "text/markdown")},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "document.md"
        assert data["content_markdown"] == "# Title"
        assert "<h1>Title</h1>" in data["content"]

    def test_convert_rejects_unsupported_extension(self, sync_client: TestClient):
        response = sync_client.post(
            "/api/import/convert",
            files={"file": ("notes.txt", io.BytesIO(b"hello"), "text/plain")},
        )

        assert response.status_code == 415

    def test_converts_pdf_with_document_converter(self, sync_client: TestClient, monkeypatch):
        convert = AsyncMock(return_value="# Converted")
        monkeypatch.setattr(import_file, "convert_to_markdown", convert)

        response = sync_client.post(
            "/api/import/convert",
            files={"file": ("scan.pdf", io.BytesIO(b"%PDF-fake"), "application/pdf")},
        )

        assert response.status_code == 200
        assert response.json()["content_markdown"] == "# Converted"
        convert.assert_awaited_once_with(b"%PDF-fake", ".pdf", force_ocr=False)

    def test_ocr_mode_forces_marker_route(self, sync_client: TestClient, monkeypatch):
        convert = AsyncMock(return_value="# OCR")
        monkeypatch.setattr(import_file, "convert_to_markdown", convert)

        response = sync_client.post(
            "/api/import/convert",
            data={"mode": "ocr"},
            files={"file": ("scan.pdf", io.BytesIO(b"%PDF-fake"), "application/pdf")},
        )

        assert response.status_code == 200
        convert.assert_awaited_once_with(b"%PDF-fake", ".pdf", force_ocr=True)

    def test_marker_required_surfaces_409(self, sync_client: TestClient, monkeypatch):
        async def raise_marker_required(*_args, **_kwargs):
            raise MarkerModelsRequiredError()

        monkeypatch.setattr(import_file, "convert_to_markdown", raise_marker_required)

        response = sync_client.post(
            "/api/import/convert",
            files={"file": ("scan.pdf", io.BytesIO(b"%PDF-fake"), "application/pdf")},
        )

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "MARKER_MODELS_REQUIRED"
