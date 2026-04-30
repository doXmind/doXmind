# PyInstaller spec — single-file FastAPI sidecar for the Tauri bundle.
#
# Usage:
#   server/.venv/bin/pyinstaller --clean --noconfirm server/doxmind-server.spec
#
# The build script (scripts/build-sidecar.mjs) wraps this and renames the
# resulting binary to `doxmind-server-<target-triple>` so Tauri's externalBin
# lookup finds it.

# ruff: noqa
# pyright: ignore

from PyInstaller.utils.hooks import collect_submodules, collect_data_files

hiddenimports: list[str] = []
hiddenimports += collect_submodules("uvicorn")
hiddenimports += collect_submodules("aiosqlite")
hiddenimports += collect_submodules("sqlalchemy.dialects.sqlite")
hiddenimports += collect_submodules("email_validator")
# Local packages — collect everything so dynamic imports (router glob,
# middleware, agents) resolve at runtime.
hiddenimports += collect_submodules("api")
hiddenimports += collect_submodules("services")
hiddenimports += collect_submodules("db")
hiddenimports += collect_submodules("utils")
hiddenimports += collect_submodules("lib")

datas: list[tuple[str, str]] = []
# Marker / Surya / pymupdf4llm / mammoth / python-pptx ship a handful of
# small bundled assets (font files, class label maps, default templates).
# The Surya weights are NOT bundled — they live in the user's HuggingFace
# cache and are downloaded on demand the first time a scanned PDF is
# imported (see services/marker_state.py).
#
# NOTE: bundling marker-pdf into a single PyInstaller binary inflates the
# artifact significantly (PyTorch alone is ~800MB). When we cut the next
# .app build we may want to switch the sidecar from a one-file PyInstaller
# bundle to a directory bundle (or ship a thin venv) so the weights and
# PyTorch don't have to be unpacked on every launch.
for _pkg in ("marker", "surya", "pymupdf4llm", "pymupdf", "mammoth", "pptx"):
    try:
        datas += collect_data_files(_pkg)
    except Exception:
        pass

# Marker / Surya pull in torch + transformers via dynamic imports that
# PyInstaller can't always trace statically. Be explicit.
for _pkg in ("torch", "transformers", "surya", "marker", "pymupdf4llm", "mammoth", "pptx"):
    try:
        hiddenimports += collect_submodules(_pkg)
    except Exception:
        pass

a = Analysis(
    ["run_sidecar.py"],
    pathex=["."],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Trim the bundle: nothing in the desktop edition needs these.
        "tkinter",
        "matplotlib",
        "IPython",
        "jupyter",
        "notebook",
        "pytest",
        "pytest_asyncio",
    ],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="doxmind-server",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
