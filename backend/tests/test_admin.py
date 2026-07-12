import logging

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.audit import AuditLog
from app.models.user import User


async def _promote_self_to_admin(client: AsyncClient, db: AsyncSession) -> User:
    await client.get("/api/projects")  # auth dependency upserts the requesting user
    user = (
        await db.execute(select(User).where(User.email == "test@company.com"))
    ).scalar_one()
    user.is_admin = True
    await db.commit()
    return user


async def _materialize_other_user(other_client: AsyncClient, db: AsyncSession) -> User:
    await other_client.get("/api/projects")
    return (
        await db.execute(select(User).where(User.email == "other@company.com"))
    ).scalar_one()


@pytest.mark.asyncio
async def test_non_admin_cannot_list_users(client: AsyncClient) -> None:
    response = await client.get("/api/admin/users")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_grant_admin_records_audit_log(
    client: AsyncClient, other_client: AsyncClient, db: AsyncSession, caplog
) -> None:
    await _promote_self_to_admin(client, db)
    target = await _materialize_other_user(other_client, db)

    with caplog.at_level(logging.INFO, logger="app.routers.admin"):
        response = await client.patch(
            f"/api/admin/users/{target.id}", json={"is_admin": True}
        )

    assert response.status_code == 200, response.text
    assert response.json()["is_admin"] is True

    logged = " ".join(r.getMessage() for r in caplog.records)
    assert "admin_privilege_change" in logged
    assert "is_admin=False->True" in logged
    # Emails are PII and stay OUT of process logs (ids only) — the durable,
    # human-readable record lives in the append-only audit table instead.
    assert "other@company.com" not in logged
    assert "test@company.com" not in logged

    row = (
        await db.execute(
            select(AuditLog).where(
                AuditLog.entity_type == "user",
                AuditLog.entity_id == target.id,
                AuditLog.field == "admin_granted",
            )
        )
    ).scalar_one()
    assert row.project_id is None  # global governance event
    assert "other@company.com" in (row.new_value or "")


@pytest.mark.asyncio
async def test_admin_cannot_revoke_own_access(
    client: AsyncClient, db: AsyncSession
) -> None:
    me = await _promote_self_to_admin(client, db)
    response = await client.patch(
        f"/api/admin/users/{me.id}", json={"is_admin": False}
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_list_users_flags_allowlist_admins(
    client: AsyncClient, other_client: AsyncClient, db: AsyncSession, monkeypatch
) -> None:
    await _promote_self_to_admin(client, db)
    await _materialize_other_user(other_client, db)
    monkeypatch.setattr(settings, "admin_emails", "other@company.com")

    by_email = {u["email"]: u for u in (await client.get("/api/admin/users")).json()}
    assert by_email["other@company.com"]["admin_via_allowlist"] is True
    assert by_email["test@company.com"]["admin_via_allowlist"] is False


@pytest.mark.asyncio
async def test_cannot_revoke_an_allowlist_admin(
    client: AsyncClient, other_client: AsyncClient, db: AsyncSession, monkeypatch
) -> None:
    # A revoke wouldn't stick (the allowlist re-grants at next login), so it's a 409
    # with an actionable message — but keeping/granting admin is still fine.
    await _promote_self_to_admin(client, db)
    target = await _materialize_other_user(other_client, db)
    target.is_admin = True
    await db.commit()
    monkeypatch.setattr(settings, "admin_emails", "other@company.com")

    revoke = await client.patch(f"/api/admin/users/{target.id}", json={"is_admin": False})
    assert revoke.status_code == 409, revoke.text
    assert "allowlist" in revoke.json()["detail"].lower()

    keep = await client.patch(f"/api/admin/users/{target.id}", json={"is_admin": True})
    assert keep.status_code == 200
    assert keep.json()["admin_via_allowlist"] is True


@pytest.mark.asyncio
async def test_planner_grant_records_governance_event(
    client: AsyncClient, other_client: AsyncClient, db: AsyncSession
) -> None:
    """can_plan gates campaign creation and every planner power — granting or
    revoking it must land in the append-only audit table (project_id NULL =
    global event), not only in transient process logs."""
    await _promote_self_to_admin(client, db)
    target = await _materialize_other_user(other_client, db)

    # The conftest workhorse users already hold can_plan, so revoke FIRST
    # (True->False emits an event), then grant it back.
    r = await client.patch(f"/api/admin/users/{target.id}", json={"can_plan": False})
    assert r.status_code == 200, r.text
    r = await client.patch(f"/api/admin/users/{target.id}", json={"can_plan": True})
    assert r.status_code == 200, r.text

    rows = (
        await db.execute(
            select(AuditLog)
            .where(AuditLog.entity_type == "user", AuditLog.entity_id == target.id)
            .order_by(AuditLog.timestamp)
        )
    ).scalars().all()
    actions = [row.field for row in rows]
    assert "can_plan_granted" in actions
    assert "can_plan_revoked" in actions
    assert all(row.project_id is None for row in rows)
