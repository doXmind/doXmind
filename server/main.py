"""doXmind optional localhost tooling service.

The document source of truth is the user's Markdown workspace on disk. This
server only mirrors native workspace commands for browser development and keeps
a read-only legacy-image recovery route; it does not own Page content.
"""

import logging
import uuid
from ipaddress import ip_address
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from api import images, workspace
from config import CORS_ORIGIN_REGEX, CORS_ORIGINS, get_cors_headers, get_settings
from exceptions import AppException
from lib.timing import timed as perf_timed

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


settings = get_settings()


def _is_loopback_address(host: str) -> bool:
    try:
        return ip_address(host).is_loopback
    except ValueError:
        return False


def _is_loopback_host_header(value: str) -> bool:
    try:
        hostname = urlsplit(f"//{value}").hostname
    except ValueError:
        return False
    if hostname is None:
        return False
    return hostname.casefold().rstrip(".") == "localhost" or _is_loopback_address(hostname)


app = FastAPI(
    title="doXmind (Local)",
    description="Local-first document editor backend",
    version="2.0.0-local",
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


class PerfTimingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # No-op when DOXMIND_PERF is unset — perf_timed checks the flag and
        # the surrounding `with` becomes ~free.
        with perf_timed(
            "request.total",
            method=request.method,
            path=request.url.path,
        ) as span:
            response = await call_next(request)
            span["status"] = response.status_code
            return response


class LoopbackOnlyMiddleware(BaseHTTPMiddleware):
    """Keep the unauthenticated tooling app unreachable from non-local peers."""

    async def dispatch(self, request: Request, call_next):
        client_host = request.client.host if request.client else ""
        # Starlette's in-process TestClient uses this sentinel instead of an IP.
        if client_host != "testclient" and not _is_loopback_address(client_host):
            return JSONResponse(status_code=403, content={"detail": "loopback access only"})
        if not _is_loopback_host_header(request.headers.get("host", "")):
            return JSONResponse(status_code=403, content={"detail": "loopback access only"})
        return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)
app.add_middleware(RequestIDMiddleware)
app.add_middleware(PerfTimingMiddleware)
app.add_middleware(LoopbackOnlyMiddleware)


# Routers: current Page/asset writes go through workspace commands. The image
# route is read-only compatibility for old /api/images Markdown references.
app.include_router(images.router, prefix="/api/images", tags=["images"])
app.include_router(workspace.router, prefix="/api/workspace", tags=["workspace"])


@app.get("/")
async def root():
    return {"name": "doXmind (Local)", "version": "2.0.0-local", "status": "running"}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=settings.debug)
