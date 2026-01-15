"""
doXmind Mini - AI Writing Studio Backend
FastAPI + LangGraph + Claude API
"""

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import logging

from config import get_settings, ensure_directories
from db.database import init_db
from services.rag_service import init_vector_store
from exceptions import AppException
from api import chat, edit, autocomplete, files, versions, review, export, import_file, knowledge_base

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events."""
    # Startup
    logger.info("Starting doXmind Mini server...")
    ensure_directories()
    await init_db()
    await init_vector_store()
    logger.info("Server started successfully!")

    yield

    # Shutdown
    logger.info("Shutting down server...")


# Create FastAPI app
app = FastAPI(
    title="doXmind Mini API",
    description="AI-powered writing assistant API",
    version="1.0.0",
    lifespan=lifespan
)


# ============================================================================
# Global Exception Handlers
# ============================================================================

@app.exception_handler(AppException)
async def app_exception_handler(request: Request, exc: AppException):
    """Handle all custom application exceptions."""
    logger.error(
        f"AppException: {exc.error_code} - {exc.message}",
        extra={"path": request.url.path, "details": exc.details}
    )
    return JSONResponse(
        status_code=exc.status_code,
        content=exc.to_dict()
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Handle unexpected exceptions."""
    logger.exception(
        f"Unhandled exception on {request.url.path}: {str(exc)}"
    )
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "An unexpected error occurred"
            }
        }
    )


# ============================================================================
# Middleware
# ============================================================================

# CORS middleware
settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://beta.doxmind.com",
        "https://doxmind-mini-frontend-2fac03803995.herokuapp.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# Routers
# ============================================================================

app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(edit.router, prefix="/api/edit", tags=["edit"])
app.include_router(autocomplete.router, prefix="/api/autocomplete", tags=["autocomplete"])
app.include_router(files.router, prefix="/api/files", tags=["files"])
app.include_router(versions.router, prefix="/api/versions", tags=["versions"])
app.include_router(review.router, prefix="/api/review", tags=["review"])
app.include_router(export.router, prefix="/api/export", tags=["export"])
app.include_router(import_file.router, prefix="/api/import", tags=["import"])
app.include_router(knowledge_base.router, prefix="/api/kb", tags=["knowledge_base"])


# ============================================================================
# Root Endpoints
# ============================================================================

@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "name": "doXmind Mini API",
        "version": "1.0.0",
        "status": "running"
    }


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug
    )
