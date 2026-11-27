"""Pilot sign-in (PILOT_MODE): the list, the passcode, the session cookie, the
read-only session, approvals switched off, and the admin's list controls.

These drive the REAL get_current_user (the suite's override is removed for each
test by the `pilot` fixture), because the session cookie is the thing under test.
"""
import time
import types
import uuid
from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from fastapi import HTTPException
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core import pilot as pilot_core
from app.core.auth import get_current_user
from app.core.pilot import APPROVALS_OFF_DETAIL, COOKIE_NAME, issue_session, read_session
from app.main import app
from app.models.audit import AuditLog
from app.models.readiness import UserTeamGrant
from app.models.user import User
from tests.conftest import TEST_USER_ID, _TestTransport

DOMAIN = "renaissanceafrica.com"
PASSCODE = "drill-pilot-passcode"
SECRET = "s" * 40
BOSS = "boss"  # the ADMIN_EMAILS admin — never added by hand


@pytest.fixture
def pilot(monkeypatch) -> None:
    """Pilot sign-in on, with the real authentication dependency."""
    monkeypatch.setattr(settings, "dev_mode", False)
    monkeypatch.setattr(settings, "proxy_user_header", "")
    monkeypatch.setattr(settings, "pilot_mode", True)
    monkeypatch.setattr(settings, "pilot_passcode", PASSCODE)
    monkeypatch.setattr(settings, "pilot_session_secret", SECRET)
    monkeypatch.setattr(settings, "pilot_session_days", 30)
    monkeypatch.setattr(settings, "user_email_domain", DOMAIN)
    monkeypatch.setattr(settings, "admin_emails", f"{BOSS}@{DOMAIN}")
    monkeypatch.delitem(app.dependency_overrides, get_current_user)
    pilot_core.reset_throttle()
    yield
    pilot_core.reset_throttle()


@pytest_asyncio.fixture
async def browser(db: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """A browser with its own cookie jar and nobody signed in."""
    async with AsyncClient(
        transport=_TestTransport(user_id=TEST_USER_ID, db=db), base_url="http://test"
    ) as c:
        yield c


async def _person(
    db: AsyncSession,
    name: str,
    *,
    is_admin: bool = False,
    can_plan: bool = False,
    is_active: bool = True,
) -> User:
    user = User(
        ad_object_id=name,
        name=name.title(),
        email=f"{name}@{DOMAIN}",
        is_admin=is_admin,
        can_plan=can_plan,
        is_active=is_active,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _sign_in(browser: AsyncClient, name: str, passcode: str | None = None):
    body: dict = {"username": name}
    if passcode is not None:
        body["passcode"] = passcode
    return await browser.post("/api/auth/sign-in", json=body)


# --- options -----------------------------------------------------------------


async def test_options_describe_pilot_sign_in(pilot, browser) -> None:
    resp = await browser.get("/api/auth/options")
    assert resp.status_code == 200
    assert resp.json() == {
        "sign_in": "pilot",
        "email_domain": DOMAIN,
        "approvals_enabled": False,
        "session_days": 30,
    }


async def test_options_outside_pilot_keep_approvals(browser) -> None:
    resp = await browser.get("/api/auth/options")
    assert resp.status_code == 200
    body = resp.json()
    assert body["sign_in"] != "pilot"
    assert body["email_domain"] is None
    assert body["session_days"] is None
    assert body["approvals_enabled"] is True


async def test_sign_in_does_not_exist_outside_pilot(browser) -> None:
    resp = await _sign_in(browser, "anyone", PASSCODE)
    assert resp.status_code == 404


# --- who gets in -------------------------------------------------------------


async def test_everything_needs_a_session(pilot, browser) -> None:
    assert (await browser.get("/api/projects")).status_code == 401
    assert (await browser.get("/api/auth/me")).status_code == 401


async def test_viewer_on_the_list_signs_in_with_the_name_alone(pilot, browser, db) -> None:
    await _person(db, "j.okoro")
    resp = await _sign_in(browser, "J.Okoro")  # case does not matter
    assert resp.status_code == 200
    assert resp.json()["email"] == f"j.okoro@{DOMAIN}"
    cookie = resp.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie and "max-age=2592000" in cookie

    me = await browser.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == f"j.okoro@{DOMAIN}"
    assert (await browser.get("/api/projects")).status_code == 200


async def test_full_company_address_is_accepted_and_others_refused(pilot, browser, db) -> None:
    await _person(db, "j.okoro")
    assert (await _sign_in(browser, f"j.okoro@{DOMAIN}")).status_code == 200
    assert (await _sign_in(browser, "j.okoro@elsewhere.com")).status_code == 401


async def test_name_not_on_the_list_is_refused(pilot, browser) -> None:
    resp = await _sign_in(browser, "stranger")
    assert resp.status_code == 401
    assert "set-cookie" not in resp.headers
    # Not even with the passcode: the passcode is not a way onto the list.
    assert (await _sign_in(browser, "stranger", PASSCODE)).status_code == 401


@pytest.mark.parametrize("bad", ["", "   ", "a b", "x" * 300, "<script>", "a@b@c"])
async def test_malformed_names_are_refused(pilot, browser, bad) -> None:
    resp = await _sign_in(browser, bad)
    assert resp.status_code in (401, 422)
    assert "set-cookie" not in resp.headers


async def test_unknown_fields_are_refused(pilot, browser) -> None:
    resp = await browser.post("/api/auth/sign-in", json={"username": "a", "is_admin": True})
    assert resp.status_code == 422


async def test_planner_needs_the_passcode(pilot, browser, db) -> None:
    await _person(db, "p.lanner", can_plan=True)
    assert (await _sign_in(browser, "p.lanner")).status_code == 401
    assert (await _sign_in(browser, "p.lanner", "wrong-passcode-123")).status_code == 401
    assert (await _sign_in(browser, "p.lanner", PASSCODE)).status_code == 200


async def test_admin_needs_the_passcode(pilot, browser, db) -> None:
    await _person(db, "a.dmin", is_admin=True)
    assert (await _sign_in(browser, "a.dmin")).status_code == 401
    assert (await _sign_in(browser, "a.dmin", PASSCODE)).status_code == 200


async def test_readiness_team_editor_needs_the_passcode(pilot, browser, db) -> None:
    user = await _person(db, "l.ogistics")
    db.add(UserTeamGrant(user_id=user.id, team_code="logistics"))
    await db.commit()
    assert (await _sign_in(browser, "l.ogistics")).status_code == 401
    assert (await _sign_in(browser, "l.ogistics", PASSCODE)).status_code == 200


async def test_a_wrong_passcode_is_refused_even_for_a_viewer(pilot, browser, db) -> None:
    await _person(db, "j.okoro")
    assert (await _sign_in(browser, "j.okoro", "wrong-passcode-123")).status_code == 401


async def test_refusals_all_read_the_same(pilot, browser, db) -> None:
    """Not on the list, blocked, and missing passcode must be indistinguishable."""
    await _person(db, "p.lanner", can_plan=True)
    await _person(db, "g.one", is_active=False)
    details = {
        (await _sign_in(browser, "stranger")).json()["detail"],
        (await _sign_in(browser, "p.lanner")).json()["detail"],
        (await _sign_in(browser, "g.one")).json()["detail"],
    }
    assert len(details) == 1


async def test_allowlisted_admin_starts_the_list(pilot, browser, db) -> None:
    # Without the passcode nothing is created.
    assert (await _sign_in(browser, BOSS)).status_code == 401
    assert (await db.execute(select(User))).scalars().all() == []

    resp = await _sign_in(browser, BOSS, PASSCODE)
    assert resp.status_code == 200
    assert resp.json()["is_admin"] is True
    assert (await browser.get("/api/admin/users")).status_code == 200


async def test_blocked_person_is_refused_and_loses_their_session(pilot, browser, db) -> None:
    user = await _person(db, "j.okoro")
    assert (await _sign_in(browser, "j.okoro")).status_code == 200
    assert (await browser.get("/api/auth/me")).status_code == 200

    user.is_active = False
    await db.commit()
    assert (await browser.get("/api/auth/me")).status_code == 401
    assert (await _sign_in(browser, "j.okoro")).status_code == 401


async def test_sign_out_ends_the_session(pilot, browser, db) -> None:
    await _person(db, "j.okoro")
    await _sign_in(browser, "j.okoro")
    assert (await browser.post("/api/auth/sign-out")).status_code == 204
    assert (await browser.get("/api/auth/me")).status_code == 401


# --- the cookie ----------------------------------------------------------------


async def test_forged_tampered_and_expired_cookies_are_refused(pilot, browser, db) -> None:
    await _person(db, "j.okoro")
    good = issue_session("j.okoro", passcode_verified=False)
    assert read_session(good) is not None

    body = good.split(".")[1]
    upgraded = issue_session("j.okoro", passcode_verified=True)
    for bad in (
        "",
        "not-a-token",
        good[:-2] + ("AA" if not good.endswith("AA") else "BB"),  # signature changed
        f"v1.{upgraded.split('.')[1]}.{good.split('.')[2]}",  # payload swapped
        f"v2.{body}.{good.split('.')[2]}",  # unknown version
        issue_session("j.okoro", passcode_verified=False, now=time.time() - 31 * 86400),
        "x" * 5000,
    ):
        assert read_session(bad) is None
        browser.cookies.clear()
        browser.cookies.set(COOKIE_NAME, bad)
        assert (await browser.get("/api/auth/me")).status_code == 401


@pytest.mark.parametrize("token", ["v1.\u00e9.invalid", "v1.bad.\u00e9", "\u00e9", "v1.\u00e9.\u00e9"])
async def test_non_ascii_cookie_reads_as_not_signed_in(pilot, browser, token) -> None:
    # Signing or comparing a non-ASCII token would raise; it must read as "no
    # session" (the generic 401), never a 500.
    assert read_session(token) is None
    resp = await browser.get(
        "/api/auth/me", headers={"cookie": f"{COOKIE_NAME}={token}".encode("latin-1")}
    )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Not authenticated"


async def test_cookie_signed_with_another_key_is_refused(pilot, monkeypatch) -> None:
    token = issue_session("j.okoro", passcode_verified=True)
    monkeypatch.setattr(settings, "pilot_session_secret", "t" * 40)
    assert read_session(token) is None


async def test_session_for_a_name_no_longer_on_the_list_is_refused(pilot, browser) -> None:
    browser.cookies.set(COOKIE_NAME, issue_session("ghost", passcode_verified=True))
    assert (await browser.get("/api/auth/me")).status_code == 401


# --- the read-only session ------------------------------------------------------


async def test_session_without_the_passcode_is_read_only(pilot, browser, db) -> None:
    """A viewer promoted AFTER signing in gains nothing until they sign in again
    with the passcode — and whoever typed their name gains nothing at all."""
    user = await _person(db, "j.okoro")
    await _sign_in(browser, "j.okoro")
    user.can_plan = True
    user.is_admin = True
    await db.commit()

    assert (await browser.get("/api/projects")).status_code == 200
    write = await browser.post("/api/projects", json={"name": "Sneaky"})
    assert write.status_code == 403
    assert write.json()["detail"] == "Sign in with the passcode to make changes"
    assert (await browser.get("/api/admin/users")).status_code == 403
    # The browser's own error reports still go through.
    assert (await browser.post("/api/client-logs", json={"message": "boom"})).status_code == 204

    # With the passcode the same person may do both.
    assert (await _sign_in(browser, "j.okoro", PASSCODE)).status_code == 200
    assert (await browser.post("/api/projects", json={"name": "Real"})).status_code == 201
    assert (await browser.get("/api/admin/users")).status_code == 200


# --- the throttle ------------------------------------------------------------------


async def test_repeated_failures_lock_the_name_for_a_while(pilot, browser, db) -> None:
    await _person(db, "p.lanner", can_plan=True)
    for _ in range(pilot_core.MAX_FAILURES_PER_NAME):
        assert (await _sign_in(browser, "p.lanner", "wrong-passcode-123")).status_code == 401
    locked = await _sign_in(browser, "p.lanner", PASSCODE)
    assert locked.status_code == 429
    # Another name is not affected by this one's failures.
    await _person(db, "j.okoro")
    assert (await _sign_in(browser, "j.okoro")).status_code == 200


async def test_attempts_still_in_flight_count_towards_the_lock(pilot, browser, db) -> None:
    # A burst sent at once: each request is counted when it BEGINS, so the ones
    # still being worked on already lock the name for the next.
    await _person(db, "p.lanner", can_plan=True)
    for _ in range(pilot_core.MAX_FAILURES_PER_NAME):
        assert pilot_core.begin_sign_in_attempt("p.lanner")
    assert not pilot_core.begin_sign_in_attempt("p.lanner")
    assert (await _sign_in(browser, "p.lanner", PASSCODE)).status_code == 429


async def test_successful_sign_ins_are_not_counted(pilot, browser, db) -> None:
    await _person(db, "p.lanner", can_plan=True)
    for _ in range(pilot_core.MAX_FAILURES_PER_NAME * 2):
        assert (await _sign_in(browser, "p.lanner", PASSCODE)).status_code == 200
    # Failures before a success still count: the success gives back only its own.
    for _ in range(pilot_core.MAX_FAILURES_PER_NAME - 1):
        assert (await _sign_in(browser, "p.lanner", "wrong-passcode-123")).status_code == 401
    assert (await _sign_in(browser, "p.lanner", PASSCODE)).status_code == 200
    assert (await _sign_in(browser, "p.lanner", "wrong-passcode-123")).status_code == 401
    assert (await _sign_in(browser, "p.lanner", PASSCODE)).status_code == 429


def test_forgiving_an_attempt_gives_back_one_count_only() -> None:
    pilot_core.reset_throttle()
    try:
        for _ in range(pilot_core.MAX_FAILURES_PER_NAME):
            assert pilot_core.begin_sign_in_attempt("a", now=1000.0)
        assert not pilot_core.begin_sign_in_attempt("a", now=1001.0)
        pilot_core.forgive_sign_in_attempt("a", now=1001.0)
        assert pilot_core.begin_sign_in_attempt("a", now=1002.0)
        assert not pilot_core.begin_sign_in_attempt("a", now=1003.0)
        # Forgiving a name with nothing counted changes nothing.
        pilot_core.forgive_sign_in_attempt("nobody", now=1003.0)
        assert not pilot_core.sign_in_throttled("nobody", now=1003.0)
    finally:
        pilot_core.reset_throttle()


def test_throttle_window_expires_and_overall_cap_applies() -> None:
    pilot_core.reset_throttle()
    try:
        for _ in range(pilot_core.MAX_FAILURES_PER_NAME):
            pilot_core.record_sign_in_failure("a", now=1000.0)
        assert pilot_core.sign_in_throttled("a", now=1001.0)
        assert not pilot_core.sign_in_throttled("b", now=1001.0)
        assert not pilot_core.sign_in_throttled(
            "a", now=1000.0 + pilot_core.THROTTLE_WINDOW_SECONDS + 1
        )

        pilot_core.reset_throttle()
        for i in range(pilot_core.MAX_FAILURES_OVERALL):
            pilot_core.record_sign_in_failure(f"n{i}", now=2000.0)
        assert pilot_core.sign_in_throttled("someone-else", now=2001.0)
    finally:
        pilot_core.reset_throttle()


# --- approvals are off --------------------------------------------------------------


async def test_submit_sign_and_decline_are_refused(pilot, browser, db) -> None:
    await _person(db, "p.lanner", can_plan=True)
    await _sign_in(browser, "p.lanner", PASSCODE)
    created = await browser.post("/api/projects", json={"name": "Pilot campaign"})
    assert created.status_code == 201
    base = f"/api/projects/{created.json()['id']}/revisions"
    rev = f"{base}/{uuid.uuid4()}"

    calls = [
        ("POST", base, {"label": "Rev 1"}),
        ("PUT", f"{rev}/sign", None),
        ("PUT", f"{rev}/sign-review", None),
        ("POST", f"{rev}/reject", {"reason": "no"}),
        ("POST", f"{rev}/request-changes", {"reason": "no"}),
        ("POST", f"{rev}/review-changes", {"reason": "no"}),
    ]
    for method, url, body in calls:
        resp = await browser.request(method, url, json=body)
        assert resp.status_code == 403, (method, url)
        assert resp.json()["detail"] == APPROVALS_OFF_DETAIL
    # Reading revisions is untouched.
    assert (await browser.get(base)).status_code == 200


async def test_submit_is_still_available_outside_pilot(client: AsyncClient) -> None:
    created = await client.post("/api/projects", json={"name": "Normal campaign"})
    resp = await client.post(
        f"/api/projects/{created.json()['id']}/revisions", json={"label": "Rev 1"}
    )
    assert resp.status_code != 403 or resp.json()["detail"] != APPROVALS_OFF_DETAIL


# --- the admin keeps the list ---------------------------------------------------------


async def test_admin_adds_a_person_who_can_then_sign_in(pilot, browser, db) -> None:
    await _sign_in(browser, BOSS, PASSCODE)
    resp = await browser.post(
        "/api/admin/users", json={"username": "N.Eze", "name": "  Ngozi Eze "}
    )
    assert resp.status_code == 201
    added = resp.json()
    assert added["email"] == f"n.eze@{DOMAIN}"
    assert added["name"] == "Ngozi Eze"
    assert added["is_admin"] is False and added["can_plan"] is False and added["is_active"] is True

    event = (
        await db.execute(select(AuditLog).where(AuditLog.field == "user_added"))
    ).scalar_one()
    assert event.project_id is None
    assert f"n.eze@{DOMAIN}" in event.new_value

    # Already there: 409, by name or by a different capitalisation.
    again = await browser.post("/api/admin/users", json={"username": "n.eze", "name": "Dup"})
    assert again.status_code == 409

    async with AsyncClient(
        transport=_TestTransport(user_id=TEST_USER_ID, db=db), base_url="http://test"
    ) as other:
        assert (await _sign_in(other, "n.eze")).status_code == 200


@pytest.mark.parametrize(
    "body",
    [
        {"username": "has space", "name": "X"},
        {"username": "a@b.com", "name": "X"},
        {"username": "", "name": "X"},
        {"username": "ok", "name": "   "},
        {"username": "ok", "name": "X", "is_admin": True},
    ],
)
async def test_add_person_validates_its_input(pilot, browser, body) -> None:
    await _sign_in(browser, BOSS, PASSCODE)
    assert (await browser.post("/api/admin/users", json=body)).status_code == 422


async def test_only_an_admin_adds_people(pilot, browser, db) -> None:
    await _person(db, "p.lanner", can_plan=True)
    await _sign_in(browser, "p.lanner", PASSCODE)
    resp = await browser.post("/api/admin/users", json={"username": "x.y", "name": "X"})
    assert resp.status_code == 403


async def test_people_are_not_added_by_hand_outside_pilot(client: AsyncClient, db) -> None:
    await client.get("/api/projects")
    me = (await db.execute(select(User).where(User.id == TEST_USER_ID))).scalar_one()
    me.is_admin = True
    await db.commit()
    resp = await client.post("/api/admin/users", json={"username": "x.y", "name": "X"})
    assert resp.status_code == 409


async def test_admin_blocks_and_allows_sign_in(pilot, browser, db) -> None:
    target = await _person(db, "j.okoro")
    await _sign_in(browser, BOSS, PASSCODE)

    blocked = await browser.patch(f"/api/admin/users/{target.id}", json={"is_active": False})
    assert blocked.status_code == 200
    assert blocked.json()["is_active"] is False
    async with AsyncClient(
        transport=_TestTransport(user_id=TEST_USER_ID, db=db), base_url="http://test"
    ) as other:
        assert (await _sign_in(other, "j.okoro")).status_code == 401

    allowed = await browser.patch(f"/api/admin/users/{target.id}", json={"is_active": True})
    assert allowed.json()["is_active"] is True

    actions = [
        row.field
        for row in (
            await db.execute(
                select(AuditLog).where(AuditLog.entity_id == target.id)
            )
        ).scalars()
    ]
    assert sorted(actions) == ["user_blocked", "user_unblocked"]

    # Saying the same thing twice writes no second event.
    await browser.patch(f"/api/admin/users/{target.id}", json={"is_active": True})
    count = len(
        (await db.execute(select(AuditLog).where(AuditLog.entity_id == target.id))).scalars().all()
    )
    assert count == 2


async def test_admin_cannot_block_themselves_or_an_allowlisted_admin(pilot, browser, db) -> None:
    other_admin = await _person(db, "a.dmin", is_admin=True)
    await _sign_in(browser, "a.dmin", PASSCODE)
    assert (
        await browser.patch(f"/api/admin/users/{other_admin.id}", json={"is_active": False})
    ).status_code == 400

    boss = await _person(db, BOSS, is_admin=True)
    assert (
        await browser.patch(f"/api/admin/users/{boss.id}", json={"is_active": False})
    ).status_code == 409


async def test_admin_named_in_the_allowlist_by_username_is_protected_too(
    pilot, browser, db, monkeypatch
) -> None:
    # ADMIN_EMAILS may hold a bare username; sign-in honours that, so the Admin
    # page must as well — the same rule, by email OR username.
    monkeypatch.setattr(settings, "admin_emails", BOSS)
    boss = await _person(db, BOSS, is_admin=True)
    await _person(db, "a.dmin", is_admin=True)
    await _sign_in(browser, "a.dmin", PASSCODE)

    listed = {u["email"]: u for u in (await browser.get("/api/admin/users")).json()}
    assert listed[f"{BOSS}@{DOMAIN}"]["admin_via_allowlist"] is True
    assert listed[f"a.dmin@{DOMAIN}"]["admin_via_allowlist"] is False

    block = await browser.patch(f"/api/admin/users/{boss.id}", json={"is_active": False})
    assert block.status_code == 409
    revoke = await browser.patch(f"/api/admin/users/{boss.id}", json={"is_admin": False})
    assert revoke.status_code == 409
    await db.refresh(boss)
    assert boss.is_active is True and boss.is_admin is True


async def test_is_active_must_be_a_real_boolean(pilot, browser, db) -> None:
    target = await _person(db, "j.okoro")
    await _sign_in(browser, BOSS, PASSCODE)
    resp = await browser.patch(f"/api/admin/users/{target.id}", json={"is_active": "no"})
    assert resp.status_code == 422


# --- blocked users under Windows sign-in ------------------------------------------------


async def test_blocked_user_is_refused_under_header_sign_in(db: AsyncSession) -> None:
    """is_active is honoured in every sign-in mode, not only the pilot."""
    await _person(db, "j.okoro", is_active=False)
    request = types.SimpleNamespace(
        method="GET", url=types.SimpleNamespace(path="/api/projects"), state=types.SimpleNamespace()
    )
    claims = {
        "oid": "j.okoro",
        "name": "J.Okoro",
        "preferred_username": f"j.okoro@{DOMAIN}",
        "username": "j.okoro",
    }
    with pytest.raises(HTTPException) as refused:
        await get_current_user(request=request, claims=claims, db=db)
    assert refused.value.status_code == 401
