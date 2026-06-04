"""Optionally serve the built frontend from the API process itself.

For a single-origin deploy *without* a reverse proxy — e.g. a locked-down Windows
host where IIS / ARR / HttpPlatformHandler can't be installed — uvicorn serves the
SPA directly: hashed assets as files, and every other non-`/api` path falls back
to `index.html` so client-side routes deep-link and refresh correctly.

Enabled only when `STATIC_DIR` is set. In dev/test it's unset, so the Vite dev
server (or a reverse proxy) serves the frontend and this module is a no-op.
"""
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse


def mount_spa(app: FastAPI, static_dir: str) -> bool:
    """Register a catch-all that serves the built frontend in ``static_dir``.

    MUST be called *after* every `/api` router is included, so the catch-all
    never shadows the API surface. Returns True when mounted; a no-op returning
    False when the directory doesn't exist.
    """
    root = Path(static_dir).resolve()
    if not root.is_dir():
        return False
    index = root / "index.html"

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str) -> FileResponse:
        # The SPA fallback must never answer for the API surface: an unmatched
        # /api/* path is a real 404, not the app shell.
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        # Serve a real built file when it exists, guarding against path traversal
        # — the resolved target must stay inside the static root.
        if full_path:
            target = (root / full_path).resolve()
            if target.is_file() and root in target.parents:
                return FileResponse(target)
        # Otherwise hand back index.html so client-side routing takes over.
        return FileResponse(index)

    return True
