"""
Test configuration.

Uses an in-memory SQLite database — no PostgreSQL instance needed.

The key design: `app.dependency_overrides` is shared state, so running two authenticated
clients in one test would cause them to stomp on each other. We solve this with a
ContextVar-based approach: each request sets its own user/db context via a custom
transport, and the overrides read from those ContextVars.
"""

import uuid
from collections.abc import AsyncGenerator
from contextvars import ContextVar

import pytest_asyncio
from httpx import ASGITransport, AsyncClient, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.auth import get_current_user
from app.database import Base, get_db
from app.main import app
from app.models.user import User

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"
_engine = create_async_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
_TestSessionLocal = async_sessionmaker(_engine, class_=AsyncSession, expire_on_commit=False)

TEST_USER_ID = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
OTHER_USER_ID = uuid.UUID("bbbbbbbb-0000-0000-0000-000000000002")

_USERS: dict[uuid.UUID, dict] = {
    TEST_USER_ID: {"ad_object_id": "test-oid-001", "name": "Test User", "email": "test@company.com"},
    OTHER_USER_ID: {"ad_object_id": "test-oid-002", "name": "Other User", "email": "other@company.com"},
}

# Per-request ContextVars — safe when multiple clients are active in one test
_test_db_var: ContextVar[AsyncSession | None] = ContextVar("_test_db_var", default=None)
_test_user_id_var: ContextVar[uuid.UUID | None] = ContextVar("_test_user_id_var", default=None)


class _TestTransport(ASGITransport):
    """Injects the test user and DB into the request context before forwarding."""

    def __init__(self, user_id: uuid.UUID, db: AsyncSession) -> None:
        super().__init__(app=app)
        self._user_id = user_id
        self._db = db

    async def handle_async_request(self, request: Request) -> Response:
        user_tok = _test_user_id_var.set(self._user_id)
        db_tok = _test_db_var.set(self._db)
        try:
            return await super().handle_async_request(request)
        finally:
            _test_user_id_var.reset(user_tok)
            _test_db_var.reset(db_tok)


async def _override_get_db() -> AsyncGenerator[AsyncSession, None]:
    db = _test_db_var.get()
    assert db is not None, "No test DB in context — was the request made via _TestTransport?"
    yield db


async def _override_get_current_user() -> User:
    db = _test_db_var.get()
    user_id = _test_user_id_var.get()
    assert db is not None and user_id is not None

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        user = User(id=user_id, **_USERS[user_id])
        db.add(user)
        await db.commit()
        await db.refresh(user)
    return user


# Set overrides once at module level — the ContextVars handle per-request dispatch
app.dependency_overrides[get_db] = _override_get_db
app.dependency_overrides[get_current_user] = _override_get_current_user


@pytest_asyncio.fixture(autouse=True)
async def setup_db() -> AsyncGenerator[None, None]:
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def db() -> AsyncGenerator[AsyncSession, None]:
    async with _TestSessionLocal() as session:
        yield session


@pytest_asyncio.fixture
async def client(db: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    async with AsyncClient(
        transport=_TestTransport(user_id=TEST_USER_ID, db=db),
        base_url="http://test",
    ) as c:
        yield c


@pytest_asyncio.fixture
async def other_client(db: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """Second client authenticated as a different user — for access-control tests."""
    async with AsyncClient(
        transport=_TestTransport(user_id=OTHER_USER_ID, db=db),
        base_url="http://test",
    ) as c:
        yield c
