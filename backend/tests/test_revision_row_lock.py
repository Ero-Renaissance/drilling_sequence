"""`_lock_revision`'s row lock, as far as the SQLite suite can check it.

SQLAlchemy's SQL Server dialect renders nothing for FOR UPDATE, so the lock
there must come from the mssql-scoped UPDLOCK/ROWLOCK table hint. These tests
pin the SQL each production dialect gets; the blocking itself is proven against
a real server in test_concurrency_mssql.py.
"""
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.dialects import mssql, postgresql
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.models.revision import Revision
from app.models.user import User
from app.routers.revisions import _lock_revision, _revision_lock_stmt


def _sql(dialect) -> str:
    return " ".join(str(_revision_lock_stmt(uuid.uuid4()).compile(dialect=dialect)).split())


def test_mssql_lock_uses_updlock_rowlock_hint() -> None:
    sql = _sql(mssql.dialect())
    assert "FROM revisions WITH (UPDLOCK, ROWLOCK) WHERE" in sql
    assert "FOR UPDATE" not in sql


def test_postgresql_lock_uses_for_update_without_mssql_hint() -> None:
    sql = _sql(postgresql.dialect())
    assert sql.endswith("FOR UPDATE")
    assert "UPDLOCK" not in sql


async def _seed(db: AsyncSession) -> tuple[uuid.UUID, Revision]:
    uid, pid = uuid.uuid4(), uuid.uuid4()
    db.add(User(id=uid, ad_object_id=str(uid), name="Lock", email="lock@example.test"))
    db.add(Project(id=pid, name="Row Lock", created_by=uid))
    rev = Revision(
        id=uuid.uuid4(),
        project_id=pid,
        rev_number=1,
        snapshot_json="[]",
        status="pending_approval",
        review_required=False,
        created_by=uid,
    )
    db.add(rev)
    await db.commit()
    return pid, rev


async def test_lock_revision_reads_committed_status_over_identity_map(
    db: AsyncSession,
) -> None:
    """The locked read must win over a stale copy already in the session —
    callers re-check status after the lock, so a cached 'pending_approval' would
    let a sign overwrite a concurrent reject."""
    pid, rev = await _seed(db)
    assert rev.status == "pending_approval"  # cached in the identity map
    # A concurrent decision lands behind the ORM's back.
    await db.execute(
        update(Revision)
        .where(Revision.id == rev.id)
        .values(status="rejected")
        .execution_options(synchronize_session=False)
    )
    locked = await _lock_revision(pid, rev.id, db)
    assert locked is rev
    assert locked.status == "rejected"


async def test_lock_revision_refuses_revision_of_another_project(db: AsyncSession) -> None:
    _, rev = await _seed(db)
    with pytest.raises(HTTPException) as exc:
        await _lock_revision(uuid.uuid4(), rev.id, db)
    assert exc.value.status_code == 404
    assert exc.value.detail == "Revision not found"
