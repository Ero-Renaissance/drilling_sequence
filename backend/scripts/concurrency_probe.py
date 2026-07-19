"""Prove — on the REAL MSSQL engine — the two DB primitives the revision-lifecycle
concurrency fix depends on. The pytest suite runs on single-session in-memory
SQLite and cannot open a genuine concurrent window; this connects to the live
container (READ COMMITTED, RCSI off) and demonstrates, deterministically:

  P1  SELECT ... FOR UPDATE (UPDLOCK/ROWLOCK) on a revision row held by one
      transaction BLOCKS a second transaction's lock attempt until the first
      commits — the primitive that fixes the sign-vs-reject overwrite (F3) and
      the stranded-signer strand (F2).

  P2  Without a uniqueness guard, two "open" (pending) revisions can coexist for
      one project (the double-submit hazard, F4); the migration's filtered
      unique index rejects the second — demonstrated by creating the exact index
      DDL on a scratch table and violating it.

Deterministic and connection-frugal (two long-lived sessions, no per-request
login churn). Seeds a throwaway project + user, tears everything down in a
finally. Run:
    DATABASE_URL=mssql+... .venv/bin/python -m scripts.concurrency_probe
"""
import asyncio
import os
import uuid

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models.project import Project
from app.models.revision import Revision
from app.models.user import User

PROBE_TAG = "__probe__"


def _revision(project_id: uuid.UUID, user_id: uuid.UUID, n: int) -> Revision:
    return Revision(
        id=uuid.uuid4(),
        project_id=project_id,
        rev_number=n,
        snapshot_json="[]",
        status="pending_approval",
        review_required=False,
        created_by=user_id,
    )


async def p1_for_update_blocks(engine, project_id, user_id) -> str:
    """Two transactions contend for the same revision row under UPDLOCK."""
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    # A revision to fight over.
    async with Session() as s:
        rev = _revision(project_id, user_id, 900)
        s.add(rev)
        await s.commit()
        rid = rev.id

    sa_conn = await engine.connect()
    sb_conn = await engine.connect()
    try:
        # A acquires the row lock inside an open transaction and holds it.
        ta = await sa_conn.begin()
        await sa_conn.execute(
            sa.text("SELECT id FROM revisions WITH (UPDLOCK, ROWLOCK) WHERE id = :i"),
            {"i": rid},
        )
        # B attempts the same lock — must block while A holds it.
        tb = await sb_conn.begin()
        b_lock = asyncio.create_task(
            sb_conn.execute(
                sa.text("SELECT id FROM revisions WITH (UPDLOCK, ROWLOCK) WHERE id = :i"),
                {"i": rid},
            )
        )
        blocked = False
        try:
            await asyncio.wait_for(asyncio.shield(b_lock), timeout=2.0)
        except asyncio.TimeoutError:
            blocked = True  # B is stuck behind A's lock — the primitive works.

        # A commits → B should now acquire and complete.
        await ta.commit()
        acquired_after = False
        try:
            await asyncio.wait_for(b_lock, timeout=5.0)
            acquired_after = True
        except asyncio.TimeoutError:
            b_lock.cancel()
        await tb.commit()
    finally:
        await sa_conn.close()
        await sb_conn.close()
        async with Session() as s:
            await s.execute(sa.delete(Revision).where(Revision.id == rid))
            await s.commit()

    ok = blocked and acquired_after
    return (
        f"P1 FOR UPDATE serialization: {'PASS' if ok else 'FAIL'} "
        f"(B blocked while A held: {blocked}; B acquired after A committed: {acquired_after})"
    )


async def p2_filtered_unique_index(engine) -> str:
    """The migration's filtered unique index rejects a 2nd open revision."""
    tbl = f"probe_open_rev_{uuid.uuid4().hex[:8]}"
    pid = str(uuid.uuid4())
    idx = f"uq_{tbl}"
    async with engine.begin() as c:
        await c.execute(
            sa.text(
                f"CREATE TABLE {tbl} (id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY, "
                f"project_id UNIQUEIDENTIFIER NOT NULL, status VARCHAR(32) NOT NULL)"
            )
        )
    try:
        # Before the index: two "open" rows coexist (the hazard).
        async with engine.begin() as c:
            for _ in range(2):
                await c.execute(
                    sa.text(f"INSERT INTO {tbl} (id, project_id, status) VALUES (:i,:p,'pending_approval')"),
                    {"i": str(uuid.uuid4()), "p": pid},
                )
            before = (
                await c.execute(sa.text(f"SELECT COUNT(*) FROM {tbl} WHERE project_id=:p"), {"p": pid})
            ).scalar()
        # Clear, add the exact filtered unique index the migration will create.
        async with engine.begin() as c:
            await c.execute(sa.text(f"DELETE FROM {tbl}"))
            await c.execute(
                sa.text(
                    f"CREATE UNIQUE INDEX {idx} ON {tbl} (project_id) "
                    f"WHERE status IN ('pending_review','pending_approval')"
                )
            )
        # One open row is fine; the second must be rejected.
        async with engine.begin() as c:
            await c.execute(
                sa.text(f"INSERT INTO {tbl} (id, project_id, status) VALUES (:i,:p,'pending_approval')"),
                {"i": str(uuid.uuid4()), "p": pid},
            )
        rejected = False
        try:
            async with engine.begin() as c:
                await c.execute(
                    sa.text(f"INSERT INTO {tbl} (id, project_id, status) VALUES (:i,:p,'pending_review')"),
                    {"i": str(uuid.uuid4()), "p": pid},
                )
        except Exception:
            rejected = True
        # But a NON-open (approved) second row is allowed — the filter's whole point.
        async with engine.begin() as c:
            await c.execute(
                sa.text(f"INSERT INTO {tbl} (id, project_id, status) VALUES (:i,:p,'approved')"),
                {"i": str(uuid.uuid4()), "p": pid},
            )
            approved_ok = (
                await c.execute(sa.text(f"SELECT COUNT(*) FROM {tbl} WHERE project_id=:p AND status='approved'"), {"p": pid})
            ).scalar()
    finally:
        async with engine.begin() as c:
            await c.execute(sa.text(f"DROP TABLE {tbl}"))

    ok = before == 2 and rejected and approved_ok == 1
    return (
        f"P2 filtered unique index: {'PASS' if ok else 'FAIL'} "
        f"(coexisting-before-index: {before}; 2nd open rejected: {rejected}; "
        f"approved still allowed: {approved_ok == 1})"
    )


async def main() -> None:
    url = os.environ.get("DATABASE_URL", "")
    if not url.startswith("mssql"):
        raise SystemExit(f"Probe requires MSSQL; DATABASE_URL is {url.split('://')[0] or '(unset)'}")
    engine = create_async_engine(url)
    print(f"Probing {engine.url.drivername} — READ COMMITTED, RCSI off\n")

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    pid = uuid.uuid4()
    uid = uuid.uuid4()
    try:
        async with Session() as s:
            s.add(User(id=uid, ad_object_id=str(uid), name="Probe", email=f"probe-{uid.hex[:8]}@example.test"))
            s.add(Project(id=pid, name=f"{PROBE_TAG} {uid.hex[:8]}", created_by=uid))
            await s.commit()

        print("•", await p1_for_update_blocks(engine, pid, uid))
        print("•", await p2_filtered_unique_index(engine))
    finally:
        async with Session() as s:
            await s.execute(sa.delete(Revision).where(Revision.project_id == pid))
            await s.execute(sa.delete(Project).where(Project.id == pid))
            await s.execute(sa.delete(User).where(User.id == uid))
            await s.commit()
        async with engine.connect() as c:
            leftover = (
                await c.execute(sa.text(f"SELECT COUNT(*) FROM projects WHERE name LIKE '{PROBE_TAG}%'"))
            ).scalar()
        await engine.dispose()
        print(f"\ncleanup: {leftover} probe projects remain")


if __name__ == "__main__":
    asyncio.run(main())
