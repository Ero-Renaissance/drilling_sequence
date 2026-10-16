"""Concurrency guards — the parts that only a real server DB can prove.

The main suite runs on single-session in-memory SQLite, where FOR UPDATE is a
no-op and no genuine concurrent window exists. These tests skip there and run
only when DATABASE_URL points at MSSQL (the production engine), asserting the
two DB guarantees the revision-lifecycle fix relies on:

  1. the filtered unique index refuses a second OPEN revision per project
     (while still allowing many approved/rejected ones) — closes double-submit;
  2. the app's `_lock_revision` serialises two transactions on one revision
     row and hands the second the first's committed status — what stops a sign
     overwriting a concurrent reject and two final signers both missing the
     all-signed advancement. SQLAlchemy renders nothing for FOR UPDATE on SQL
     Server, so this exercises the real ORM query (its UPDLOCK/ROWLOCK hint),
     not a hand-written one.

They seed throwaway rows on their own engine and tear them down in a finally.
"""
import asyncio
import contextlib
import os
import uuid

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models.project import Project
from app.models.revision import Revision
from app.models.user import User
from app.routers.revisions import _lock_revision

_URL = os.environ.get("DATABASE_URL", "")
pytestmark = pytest.mark.skipif(
    not _URL.startswith("mssql"),
    reason="Concurrency guarantees require the MSSQL engine (FOR UPDATE / filtered index)",
)


def _rev(project_id: uuid.UUID, user_id: uuid.UUID, n: int, status: str) -> Revision:
    return Revision(
        id=uuid.uuid4(),
        project_id=project_id,
        rev_number=n,
        snapshot_json="[]",
        status=status,
        review_required=False,
        created_by=user_id,
    )


async def _seed(Session) -> tuple[uuid.UUID, uuid.UUID]:
    pid, uid = uuid.uuid4(), uuid.uuid4()
    async with Session() as s:
        s.add(User(id=uid, ad_object_id=str(uid), name="Conc", email=f"conc-{uid.hex[:8]}@example.test"))
        s.add(Project(id=pid, name=f"__conc__ {uid.hex[:8]}", created_by=uid))
        await s.commit()
    return pid, uid


async def _teardown(Session, pid, uid) -> None:
    async with Session() as s:
        await s.execute(sa.delete(Revision).where(Revision.project_id == pid))
        await s.execute(sa.delete(Project).where(Project.id == pid))
        await s.execute(sa.delete(User).where(User.id == uid))
        await s.commit()


async def test_filtered_index_allows_one_open_revision_per_project() -> None:
    engine = create_async_engine(_URL)
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    pid, uid = await _seed(Session)
    try:
        # First open revision — fine.
        async with Session() as s:
            s.add(_rev(pid, uid, 1, "pending_approval"))
            await s.commit()

        # Second OPEN revision (either pending stage) — rejected by the index.
        with pytest.raises(IntegrityError):
            async with Session() as s:
                s.add(_rev(pid, uid, 2, "pending_review"))
                await s.commit()

        # But resolving the first (approved) then opening a new one is allowed —
        # the filter only constrains pending rows.
        async with Session() as s:
            rev = (
                await s.execute(sa.select(Revision).where(Revision.project_id == pid))
            ).scalars().first()
            rev.status = "approved"
            await s.commit()
        async with Session() as s:
            s.add(_rev(pid, uid, 2, "pending_approval"))
            await s.commit()
        async with Session() as s:
            open_count = (
                await s.execute(
                    sa.select(sa.func.count())
                    .select_from(Revision)
                    .where(
                        Revision.project_id == pid,
                        Revision.status.in_(["pending_review", "pending_approval"]),
                    )
                )
            ).scalar()
        assert open_count == 1
    finally:
        await _teardown(Session, pid, uid)
        await engine.dispose()


async def test_lock_revision_serialises_status_transitions() -> None:
    """The app's own `_lock_revision` — not a hand-written hinted query — must
    row-lock on SQL Server: a second caller blocks until the first commits, then
    reads the first's committed decision even though it had already loaded the
    revision (so a sign can't overwrite a concurrent reject)."""
    engine = create_async_engine(_URL)
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    pid, uid = await _seed(Session)
    async with Session() as s:
        rev = _rev(pid, uid, 1, "pending_approval")
        s.add(rev)
        await s.commit()
        rid = rev.id

    a, b = Session(), Session()
    b_lock = None
    try:
        # B already holds a pre-decision copy in its identity map.
        stale = await b.get(Revision, rid)
        assert stale.status == "pending_approval"

        rev_a = await _lock_revision(pid, rid, a)
        b_lock = asyncio.create_task(_lock_revision(pid, rid, b))
        # B must block while A holds the row lock.
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(asyncio.shield(b_lock), timeout=2.0)

        # A decides and commits → B acquires and sees A's decision.
        rev_a.status = "rejected"
        await a.commit()
        rev_b = await asyncio.wait_for(b_lock, timeout=5.0)
        assert rev_b is stale
        assert rev_b.status == "rejected"
        await b.commit()
    finally:
        await a.close()  # rolls back anything still open → releases A's lock
        if b_lock is not None:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(b_lock, timeout=5.0)
        await b.close()
        await _teardown(Session, pid, uid)
        await engine.dispose()
