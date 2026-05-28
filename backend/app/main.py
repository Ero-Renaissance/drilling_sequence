from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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
    me,
    projects,
    readiness,
    revisions,
    viewers,
)


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

app.include_router(auth.router)
app.include_router(me.router)
app.include_router(admin.router)
app.include_router(projects.router)
app.include_router(activities.router)
app.include_router(readiness.router)
app.include_router(viewers.router)
app.include_router(revisions.router)
app.include_router(approvers.router)
app.include_router(contracts.router)


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "version": "2.0.0"}
