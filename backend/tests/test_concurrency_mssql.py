"""Concurrency guards — the parts that only a real server DB can prove.

The main suite runs on single-session in-memory SQLite, where FOR UPDATE is a
no-op and no genuine concurrent window exists. These tests skip there and run
only when DATABASE_URL points at MSSQL (the production engine), asserting the
two DB guarantees the revision-lifecycle fix relies on:

  1. the filtered unique index refuses a second OPEN revision per project
     (while still allowing many approved/rejected ones) — closes double-submit;
  2. SELECT ... FOR UPDATE serialises two transactions on one revision row —
     the primitive that stops a sign overwriting a concurrent reject and two
     final signers both missing the all-signed advancement.

They seed throwaway rows on their own engine and tear them down in a finally.
"""
import asyncio
import os
import uuid

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models.project import Project
from app.models.revision import Revision
from app.models.user import User

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


async def test_for_update_serialises_two_transactions() -> None:
    engine = create_async_engine(_URL)
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    pid, uid = await _seed(Session)
    async with Session() as s:
        rev = _rev(pid, uid, 1, "pending_approval")
        s.add(rev)
        await s.commit()
        rid = rev.id

    a = await engine.connect()
    b = await engine.connect()
    try:
        ta = await a.begin()
        await a.execute(
            sa.text("SELECT id FROM revisions WITH (UPDLOCK, ROWLOCK) WHERE id = :i"), {"i": rid}
        )
        tb = await b.begin()
        b_lock = asyncio.create_task(
            b.execute(
                sa.text("SELECT id FROM revisions WITH (UPDLOCK, ROWLOCK) WHERE id = :i"), {"i": rid}
            )
        )
        # B must block while A holds the row lock.
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(asyncio.shield(b_lock), timeout=2.0)
        # A releases → B acquires.
        await ta.commit()
        await asyncio.wait_for(b_lock, timeout=5.0)
        await tb.commit()
    finally:
        await a.close()
        await b.close()
        await _teardown(Session, pid, uid)
        await engine.dispose()
