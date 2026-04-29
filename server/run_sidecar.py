"""PyInstaller entry point for the bundled FastAPI sidecar.

The Tauri shell spawns this binary with the desired port in the `PORT` env
var (and optionally `HOST`). We then start uvicorn in-process so the whole
backend lives in one self-contained executable — no external Python install
needed on the user's machine.
"""

import logging
import os
import sys

import uvicorn


def _resolve_port() -> int:
    raw = os.environ.get("PORT")
    if raw:
        try:
            return int(raw)
        except ValueError:
            pass
    # Fallback for `--port N` / `--port=N` on argv (used in the dev path).
    args = sys.argv[1:]
    for i, arg in enumerate(args):
        if arg == "--port" and i + 1 < len(args):
            try:
                return int(args[i + 1])
            except ValueError:
                continue
        if arg.startswith("--port="):
            try:
                return int(arg.split("=", 1)[1])
            except ValueError:
                continue
    return 8000


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    host = os.environ.get("HOST", "127.0.0.1")
    port = _resolve_port()
    # Import here so PyInstaller's hook collects all transitive deps from main.
    from main import app  # noqa: WPS433 — intentional late import

    uvicorn.run(app, host=host, port=port, log_level="info", access_log=False)


if __name__ == "__main__":
    main()
