# Agent Runtime Notes

## Python Backend Environment

- Always run backend Python commands inside the project virtual environment, not the global Python environment.
- From `server/`, create and activate `.venv` before running `uvicorn`, scripts, or `pip` installs.

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload
```

## Why

- Prevents `ModuleNotFoundError` caused by packages being installed in a different interpreter/environment.
- Keeps dependencies reproducible and isolated from machine-level global packages.
