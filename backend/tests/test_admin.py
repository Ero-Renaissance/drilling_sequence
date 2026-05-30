import logging

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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
    assert "other@company.com" in logged  # target of the grant
    assert "test@company.com" in logged   # acting admin
    assert "is_admin=False->True" in logged


@pytest.mark.asyncio
async def test_admin_cannot_revoke_own_access(
    client: AsyncClient, db: AsyncSession
) -> None:
    me = await _promote_self_to_admin(client, db)
    response = await client.patch(
        f"/api/admin/users/{me.id}", json={"is_admin": False}
    )
    assert response.status_code == 400
