import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.core.auth import get_current_user
from app.core.logging_config import RequestIdMiddleware, configure_logging
from app.database import Base, _is_sqlite, engine
from app.models import approver as _approver_models  # noqa: F401
from app.models import audit as _audit_models  # noqa: F401
from app.models import readiness as _readiness_models  # noqa: F401
from app.models import revision as _revision_models  # noqa: F401
from app.models import rig_contract as _rig_contract_models  # noqa: F401
from app.models import viewer as _viewer_models  # noqa: F401
from app.routers import (
    activities,
    admin,
    approvers,
    auth,
    change_notes,
    client_logs,
    contracts,
    dashboard,
    hwu_contracts,
    me,
    optimizer,
    projects,
    readiness,
    resources,
    reviewers,
    revision_comments,
    revisions,
    viewers,
)
from app.static_spa import mount_spa

configure_logging(
    level=settings.log_level,
    json_logs=settings.environment.strip().lower() not in ("development", "test"),
)
logger = logging.getLogger("app")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # Auto-create tables when running against SQLite (local dev).
    # For PostgreSQL, run `alembic upgrade head` instead.
    if _is_sqlite:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    yield


app = FastAPI(
    title="Drilling Sequence API",
    version="2.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Correlate every request's logs (sets a contextvar; echoes X-Request-ID).
app.add_middleware(RequestIdMiddleware)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Last-resort handler for unexpected errors: log the full detail server-side
    but return a generic message so stack traces / internals never reach the client.
    HTTPException and request-validation errors are handled by FastAPI before they
    reach here, so their specific status codes and messages are preserved."""
    logger.exception("Unhandled error during %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )

# Defense-in-depth: every router is included with a router-level authentication
# dependency, so a future endpoint that forgets its get_current_user parameter
# is still never reachable unauthenticated. FastAPI caches dependency results
# per request, so endpoints that also declare the user pay nothing extra.
# Authorization (assert_member / assert_can_sign / admin) stays per-endpoint.
# GET /api/health below is deliberately public — defined on the app, not a router.
for _router in (
    auth.router,
    me.router,
    admin.router,
    projects.router,
    activities.router,
    readiness.router,
    viewers.router,
    revisions.router,
    revision_comments.router,
    approvers.router,
    reviewers.router,
    contracts.router,
    hwu_contracts.router,
    resources.router,
    dashboard.router,
    change_notes.router,
    client_logs.router,
    optimizer.router,
):
    app.include_router(_router, dependencies=[Depends(get_current_user)])


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "version": "2.0.0"}


# Single-origin deploy: serve the built frontend from this process when STATIC_DIR
# is set. Registered LAST so the catch-all never shadows the /api routes above.
if settings.static_dir:
    if mount_spa(app, settings.static_dir):
        logger.info("Serving the built frontend from %s", settings.static_dir)
    else:
        logger.warning("STATIC_DIR is set but is not a directory: %s", settings.static_dir)
