"""doXmind Mini — local desktop backend (FastAPI + OpenRouter).

Single-user, no auth, SQLite. Runs as a localhost sidecar for the Next.js UI.
"""

import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from api import (
    autocomplete,
    chat,
    conversations,
    data_files,
    databases,
    export,
    files,
    global_agent,
    images,
    import_file,
    inline,
    knowledge_base,
    oauth,
    review,
    skills,
    user_settings,
    versions,
)
from config import CORS_ORIGINS, get_cors_headers, get_settings
from db.database import engine as db_engine
from db.database import init_db
from exceptions import AppException

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    logger.info("Starting doXmind Mini local server...")
    settings = get_settings()
    settings.ensure_data_dir()
    await init_db()
    logger.info(f"Server ready. Data dir: {settings.data_dir}")
    yield
    logger.info("Shutting down...")
    await db_engine.dispose()


settings = get_settings()

app = FastAPI(
    title="doXmind Mini (Local)",
    description="Local AI writing studio backend",
    version="2.0.0-local",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)


@app.exception_handler(AppException)
async def app_exception_handler(request: Request, exc: AppException):
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
    logger.exception(f"Unhandled exception on {request.url.path}: {exc}")
    return JSONResponse(
        status_code=500,
        content={"error": {"code": "INTERNAL_ERROR", "message": "An unexpected error occurred"}},
        headers=get_cors_headers(request.headers.get("origin")),
    )


class RequestIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:8]
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)
app.add_middleware(RequestIDMiddleware)


# Routers
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(conversations.router, prefix="/api/chat", tags=["chat"])
app.include_router(inline.router, prefix="/api/inline", tags=["inline"])
app.include_router(autocomplete.router, prefix="/api/autocomplete", tags=["autocomplete"])
app.include_router(files.router, prefix="/api/files", tags=["files"])
app.include_router(versions.router, prefix="/api/versions", tags=["versions"])
app.include_router(review.router, prefix="/api/review", tags=["review"])
app.include_router(export.router, prefix="/api/export", tags=["export"])
app.include_router(import_file.router, prefix="/api/import", tags=["import"])
app.include_router(global_agent.router, prefix="/api/global-agent", tags=["global_agent"])
app.include_router(knowledge_base.router, prefix="/api/kb", tags=["kb"])
app.include_router(data_files.router, tags=["data_files"])
app.include_router(skills.router, prefix="/api/skills", tags=["skills"])
app.include_router(user_settings.router, prefix="/api/user-settings", tags=["user_settings"])
app.include_router(oauth.router, prefix="/api/oauth", tags=["oauth"])
app.include_router(images.router, prefix="/api/images", tags=["images"])
app.include_router(databases.router, prefix="/api/databases", tags=["databases"])


@app.get("/")
async def root():
    return {"name": "doXmind Mini (Local)", "version": "2.0.0-local", "status": "running"}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=settings.debug)
