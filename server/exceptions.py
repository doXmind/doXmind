"""Custom exceptions for the doXmind Mini API.

This module provides a unified exception hierarchy for consistent
error handling across the application.
"""

from typing import Any


class AppException(Exception):
    """Base exception for application errors.

    All custom exceptions should inherit from this class.
    """

    status_code: int = 500
    error_code: str = "INTERNAL_ERROR"
    message: str = "An unexpected error occurred"

    def __init__(
        self,
        message: str = None,
        details: dict[str, Any] | None = None
    ):
        self.message = message or self.__class__.message
        self.details = details or {}
        super().__init__(self.message)

    def to_dict(self) -> dict[str, Any]:
        """Convert exception to a dictionary for API response."""
        response = {
            "error": {
                "code": self.error_code,
                "message": self.message,
            }
        }
        if self.details:
            response["error"]["details"] = self.details
        return response


# ============================================================================
# Client Errors (4xx)
# ============================================================================

class NotFoundError(AppException):
    """Resource not found (404)."""

    status_code = 404
    error_code = "NOT_FOUND"
    message = "The requested resource was not found"

    def __init__(self, resource: str = None, resource_id: str = None, **kwargs):
        if resource:
            message = f"{resource} not found"
            if resource_id:
                message = f"{resource} with ID '{resource_id}' not found"
            kwargs.setdefault("message", message)
        super().__init__(**kwargs)


class ValidationError(AppException):
    """Request validation failed (400)."""

    status_code = 400
    error_code = "VALIDATION_ERROR"
    message = "Request validation failed"

    def __init__(self, field: str = None, reason: str = None, **kwargs):
        details = kwargs.pop("details", {})
        if field:
            details["field"] = field
        if reason:
            details["reason"] = reason
        super().__init__(details=details, **kwargs)


class BadRequestError(AppException):
    """Bad request (400)."""

    status_code = 400
    error_code = "BAD_REQUEST"
    message = "Bad request"


class UnauthorizedError(AppException):
    """Authentication required (401)."""

    status_code = 401
    error_code = "UNAUTHORIZED"
    message = "Authentication required"


class ForbiddenError(AppException):
    """Access forbidden (403)."""

    status_code = 403
    error_code = "FORBIDDEN"
    message = "Access forbidden"


class ConflictError(AppException):
    """Resource conflict (409)."""

    status_code = 409
    error_code = "CONFLICT"
    message = "Resource conflict"


class FileTooLargeError(AppException):
    """File size exceeds limit (413)."""

    status_code = 413
    error_code = "FILE_TOO_LARGE"
    message = "File size exceeds the maximum allowed limit"

    def __init__(self, max_size: int = None, actual_size: int = None, **kwargs):
        details = kwargs.pop("details", {})
        if max_size:
            details["max_size_bytes"] = max_size
            details["max_size_mb"] = max_size / (1024 * 1024)
        if actual_size:
            details["actual_size_bytes"] = actual_size
        super().__init__(details=details, **kwargs)


class UnsupportedFileTypeError(AppException):
    """File type not supported (415)."""

    status_code = 415
    error_code = "UNSUPPORTED_FILE_TYPE"
    message = "File type not supported"

    def __init__(self, file_type: str = None, allowed_types: list = None, **kwargs):
        details = kwargs.pop("details", {})
        if file_type:
            details["file_type"] = file_type
        if allowed_types:
            details["allowed_types"] = allowed_types
        super().__init__(details=details, **kwargs)


# ============================================================================
# Server Errors (5xx)
# ============================================================================

class InternalError(AppException):
    """Internal server error (500)."""

    status_code = 500
    error_code = "INTERNAL_ERROR"
    message = "An internal error occurred"


class ServiceUnavailableError(AppException):
    """Service temporarily unavailable (503)."""

    status_code = 503
    error_code = "SERVICE_UNAVAILABLE"
    message = "Service temporarily unavailable"


class ExternalServiceError(AppException):
    """External service error (502)."""

    status_code = 502
    error_code = "EXTERNAL_SERVICE_ERROR"
    message = "An external service returned an error"

    def __init__(self, service: str = None, **kwargs):
        details = kwargs.pop("details", {})
        if service:
            details["service"] = service
        super().__init__(details=details, **kwargs)


# ============================================================================
# Domain-Specific Errors
# ============================================================================

class LLMError(ExternalServiceError):
    """Error from LLM service (Claude API)."""

    error_code = "LLM_ERROR"
    message = "LLM service error"

    def __init__(self, **kwargs):
        super().__init__(service="claude_api", **kwargs)


class VectorStoreError(InternalError):
    """Error from vector store (Chroma)."""

    error_code = "VECTOR_STORE_ERROR"
    message = "Vector store error"


class FileProcessingError(InternalError):
    """Error processing file (import/export)."""

    error_code = "FILE_PROCESSING_ERROR"
    message = "Failed to process file"


class DocumentNotFoundError(NotFoundError):
    """Document/file not found."""

    def __init__(self, file_id: str = None, **kwargs):
        super().__init__(resource="File", resource_id=file_id, **kwargs)


class ConversationNotFoundError(NotFoundError):
    """Conversation not found."""

    def __init__(self, conversation_id: str = None, **kwargs):
        super().__init__(resource="Conversation", resource_id=conversation_id, **kwargs)


class AttachmentNotFoundError(NotFoundError):
    """KB attachment not found."""

    def __init__(self, attachment_id: str = None, **kwargs):
        super().__init__(resource="Attachment", resource_id=attachment_id, **kwargs)
