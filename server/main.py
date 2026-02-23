"""
doXmind Mini - AI Writing Studio Backend
FastAPI + LangGraph + Claude API
"""

import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware

from api import (
    auth,
    autocomplete,
    chat,
    comments,
    community,
    conversations,
    data_files,
    edit,
    export,
    files,
    images,
    import_file,
    kb_agent,
    knowledge_base,
    review,
    shares,
    skills,
    speech,
    telemetry,
    usage,
    user_settings,
    versions,
)
from config import CORS_ORIGINS, get_cors_headers, get_settings
from db.database import async_session, init_db
from exceptions import AppException
from middleware.rate_limit import limiter, rate_limit_exceeded_handler
from services.rag import init_pgvector

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Configure audit logger with structured format for security-sensitive operations
audit_logger = logging.getLogger("audit")
audit_handler = logging.StreamHandler()
audit_handler.setFormatter(
    logging.Formatter("%(asctime)s - AUDIT - %(levelname)s - %(message)s [%(user_id)s] %(action)s")
)
audit_logger.addHandler(audit_handler)
audit_logger.setLevel(logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events."""
    # Startup
    logger.info("Starting doXmind Mini server...")

    # Validate critical configuration
    settings = get_settings()
    settings.validate_for_production()

    if not settings.api_key_encryption_key:
        if settings.debug:
            logger.warning(
                "API_KEY_ENCRYPTION_KEY not configured. "
                "User API key storage will be disabled in development mode."
            )
        else:
            logger.warning(
                "API_KEY_ENCRYPTION_KEY not configured. "
                "Users will not be able to store their own API keys."
            )

    await init_db()

    # Initialize pgvector for vector search
    async with async_session() as db:
        await init_pgvector(db)

    logger.info("Server started successfully!")

    yield

    # Shutdown
    logger.info("Shutting down server...")


# Create FastAPI app with OpenAPI documentation
settings = get_settings()

app = FastAPI(
    title="doXmind Mini API",
    description="""
## doXmind Mini - AI Writing Studio API

An AI-powered writing assistant that helps you write, edit, and organize documents.

### Features
- **AI Chat**: Interactive AI assistant for writing help
- **Smart Editing**: AI-powered document editing and suggestions
- **Knowledge Base**: RAG-based document search and retrieval
- **Version Control**: Document versioning with diff tracking
- **Export**: Export documents to PDF, DOCX, and Markdown

### Authentication
Most endpoints require authentication via JWT Bearer token or API Key.

- **JWT Token**: Include in `Authorization: Bearer <token>` header
- **API Key**: Include in `X-API-Key: <key>` header
    """,
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.debug else None,  # Swagger UI
    redoc_url="/redoc" if settings.debug else None,  # ReDoc
    openapi_url="/openapi.json" if settings.debug else None,
    openapi_tags=[
        {"name": "auth", "description": "Authentication and user management"},
        {"name": "chat", "description": "AI chat and conversation management"},
        {"name": "edit", "description": "AI-powered document editing"},
        {"name": "files", "description": "File management (CRUD operations)"},
        {"name": "versions", "description": "Document version control"},
        {"name": "knowledge_base", "description": "Knowledge base and RAG search"},
        {"name": "skills", "description": "Writing skills and templates"},
        {"name": "export", "description": "Document export (PDF, DOCX, MD)"},
        {"name": "import", "description": "Document import"},
        {"name": "autocomplete", "description": "AI autocomplete suggestions"},
        {"name": "review", "description": "AI document review"},
        {"name": "shares", "description": "Document sharing and public access"},
        {"name": "speech", "description": "Speech-to-text transcription"},
    ],
    contact={
        "name": "doXmind Team",
        "url": "https://doxmind.com",
        "email": "support@doxmind.com",
    },
    license_info={
        "name": "MIT",
        "url": "https://opensource.org/licenses/MIT",
    },
)

# Add rate limiter to app state
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)


# ============================================================================
# Global Exception Handlers
# ============================================================================


@app.exception_handler(AppException)
async def app_exception_handler(request: Request, exc: AppException):
    """Handle all custom application exceptions."""
    logger.error(
        f"AppException: {exc.error_code} - {exc.message}",
        extra={"path": request.url.path, "details": exc.details},
    )
    return JSONResponse(
        status_code=exc.status_code,
        content=exc.to_dict(),
        headers=get_cors_headers(request.headers.get("origin")),
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Handle unexpected exceptions."""
    logger.exception(f"Unhandled exception on {request.url.path}: {str(exc)}")
    return JSONResponse(
        status_code=500,
        content={"error": {"code": "INTERNAL_ERROR", "message": "An unexpected error occurred"}},
        headers=get_cors_headers(request.headers.get("origin")),
    )


# ============================================================================
# Middleware
# ============================================================================


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Attach a unique request ID to every request/response for chain tracing."""

    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:8]
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        # Prevent MIME type sniffing
        response.headers["X-Content-Type-Options"] = "nosniff"

        # Prevent clickjacking
        response.headers["X-Frame-Options"] = "DENY"

        # XSS protection (legacy, but still useful for older browsers)
        response.headers["X-XSS-Protection"] = "1; mode=block"

        # Referrer policy
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # Content Security Policy (basic, adjust as needed)
        response.headers["Content-Security-Policy"] = "default-src 'self'; frame-ancestors 'none'"

        # HSTS (only in production, when not in debug mode)
        if not settings.debug:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains; preload"
            )

        return response


# Add security headers middleware
app.add_middleware(SecurityHeadersMiddleware)


# CORS middleware - tightened configuration
# CORS_ORIGINS is imported from config.py

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    # Restrict to specific HTTP methods
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    # Restrict to specific headers
    allow_headers=[
        "Content-Type",
        "Authorization",
        "X-API-Key",
        "X-Requested-With",
        "Accept",
        "Origin",
    ],
    # Expose headers that client can access
    expose_headers=[
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset",
        "Retry-After",
    ],
    # Cache preflight requests for 1 hour
    max_age=3600,
)

# Add request ID middleware (outermost — first middleware hit on every request)
app.add_middleware(RequestIDMiddleware)


# ============================================================================
# Routers
# ============================================================================

# Auth router (no prefix for standard OAuth2 paths)
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])

# Protected API routes
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(conversations.router, prefix="/api/chat", tags=["chat"])
app.include_router(edit.router, prefix="/api/edit", tags=["edit"])
app.include_router(autocomplete.router, prefix="/api/autocomplete", tags=["autocomplete"])
app.include_router(files.router, prefix="/api/files", tags=["files"])
app.include_router(versions.router, prefix="/api/versions", tags=["versions"])
app.include_router(review.router, prefix="/api/review", tags=["review"])
app.include_router(export.router, prefix="/api/export", tags=["export"])
app.include_router(import_file.router, prefix="/api/import", tags=["import"])
app.include_router(kb_agent.router, prefix="/api/kb-agent", tags=["kb_agent"])
app.include_router(knowledge_base.router, prefix="/api/kb", tags=["knowledge_base"])
app.include_router(data_files.router, tags=["data_files"])
app.include_router(shares.router, prefix="/api/shares", tags=["shares"])
app.include_router(community.router, prefix="/api/community", tags=["community"])
app.include_router(comments.router, prefix="/api/comments", tags=["comments"])
app.include_router(skills.router, prefix="/api/skills", tags=["skills"])
app.include_router(speech.router, prefix="/api/speech", tags=["speech"])
app.include_router(telemetry.router, prefix="/api/telemetry", tags=["telemetry"])
app.include_router(user_settings.router, prefix="/api/user-settings", tags=["user_settings"])
app.include_router(images.router, prefix="/api/images", tags=["images"])
app.include_router(usage.router, prefix="/api/usage", tags=["usage"])


# ============================================================================
# Root Endpoints
# ============================================================================


@app.get("/")
async def root():
    """Root endpoint."""
    return {"name": "doXmind Mini API", "version": "1.0.0", "status": "running"}


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=settings.debug)
