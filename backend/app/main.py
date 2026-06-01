import logging
from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.database import Base, engine, _is_sqlite
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
    contracts,
    dashboard,
    me,
    projects,
    readiness,
    reviewers,
    revisions,
    viewers,
)

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
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

app.include_router(auth.router)
app.include_router(me.router)
app.include_router(admin.router)
app.include_router(projects.router)
app.include_router(activities.router)
app.include_router(readiness.router)
app.include_router(viewers.router)
app.include_router(revisions.router)
app.include_router(approvers.router)
app.include_router(reviewers.router)
app.include_router(contracts.router)
app.include_router(dashboard.router)


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "version": "2.0.0"}
