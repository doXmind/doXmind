"""doXmind Mini local sidecar backend.

The document source of truth is the user's Markdown workspace on disk. This
server only handles local conversion, image serving, and future metadata/cache
needs; it does not expose a SQLite document workspace.
"""

import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from api import images, import_file
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
    description="Local-first document editor backend",
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


# Routers: document CRUD lives in the Tauri filesystem commands.
app.include_router(import_file.router, prefix="/api/import", tags=["import"])
app.include_router(images.router, prefix="/api/images", tags=["images"])


@app.get("/")
async def root():
    return {"name": "doXmind Mini (Local)", "version": "2.0.0-local", "status": "running"}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=settings.debug)
