"""
doXmind Mini - AI Writing Studio Backend
FastAPI + LangGraph + Claude API
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging

from config import get_settings, ensure_directories
from db.database import init_db
from services.rag_service import init_vector_store
from api import chat, edit, autocomplete, files, versions, review, export

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

# CORS middleware
settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(edit.router, prefix="/api/edit", tags=["edit"])
app.include_router(autocomplete.router, prefix="/api/autocomplete", tags=["autocomplete"])
app.include_router(files.router, prefix="/api/files", tags=["files"])
app.include_router(versions.router, prefix="/api/versions", tags=["versions"])
app.include_router(review.router, prefix="/api/review", tags=["review"])
app.include_router(export.router, prefix="/api/export", tags=["export"])


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
