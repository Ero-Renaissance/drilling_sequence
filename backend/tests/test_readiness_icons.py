"""The owned icon registry (spec §8.5, phase 7 / decision 40).

Admins choose an icon key from a code-defined allow-list; they never upload SVG.
Phase 7 appends 53 lucide keys (68 in all). These tests pin the registry's shape,
that the frontend's React registry and its generated canvas paths list exactly the
same keys in the same order, and that the admin API accepts the new keys and
still refuses anything else — for admins only.
"""
import re
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog
from app.models.readiness import ICON_KEYS
from app.models.user import User

# The registry before phase 7 — appending must not move any of these.
PHASE_6_KEYS = (
    "land-plot",
    "rotary-table",
    "map-pin",
    "drafting-compass",
    "gavel",
    "leaf",
    "banknote",
    "truck",
    "hand-coins",
    "file-signature",
    "forklift",
    "shield-check",
    "handshake",
    "receipt",
    "ship",
)
# Migration 039's equipment categories (spec §3.4) and their seed icons.
SEED_CATEGORY_ICONS = {
    "Aviation": "helicopter",
    "Vessels": "anchor",
    "Barges": "container",
    "Land transport": "bus",
    "Lifting": "construction",
    "Permits": "radiation",
}

FRONTEND_SRC = Path(__file__).resolve().parents[2] / "frontend" / "src"


def test_registry_appends_53_keys_to_the_phase_6_list() -> None:
    assert len(ICON_KEYS) == 68
    assert len(set(ICON_KEYS)) == len(ICON_KEYS)
    assert ICON_KEYS[: len(PHASE_6_KEYS)] == PHASE_6_KEYS
    for key in ICON_KEYS:
        # Plain kebab-case: safe as a file name for the generator and fits the
        # String(32) icon_key columns.
        assert re.fullmatch(r"[a-z][a-z0-9-]*", key), key
        assert len(key) <= 32, key


def test_the_equipment_categories_seed_icons_are_allowed() -> None:
    for category, key in SEED_CATEGORY_ICONS.items():
        assert key in ICON_KEYS, category


@pytest.mark.skipif(not FRONTEND_SRC.exists(), reason="frontend sources not present")
def test_generated_canvas_paths_list_the_registry_keys_in_order() -> None:
    """scripts/gen-check-icons.mjs writes LUCIDE_PATHS in registry order between
    two markers; the hand-drawn rotary table references its own constant."""
    source = (FRONTEND_SRC / "lib" / "check-icon-svg.ts").read_text()
    block = re.search(
        r"// BEGIN GENERATED LUCIDE_PATHS.*?\n(.*?)\n\s*// END GENERATED LUCIDE_PATHS",
        source,
        re.S,
    )
    assert block, "check-icon-svg.ts lost its generated block markers"
    keys = re.findall(r'^  "?([a-z][a-z0-9-]*)"?: ', block.group(1), re.M)
    assert keys == list(ICON_KEYS)
    assert re.search(r'^  "rotary-table": ROTARY_TABLE_PATHS,$', block.group(1), re.M)


async def _make_admin(client: AsyncClient, db: AsyncSession) -> User:
    await client.get("/api/projects")  # the auth dependency materialises the user
    me = (await db.execute(select(User).where(User.email == "test@company.com"))).scalar_one()
    me.is_admin = True
    await db.commit()
    return me


def _check(code: str, icon_key: str) -> dict:
    return {
        "code": code,
        "label": "Crane",
        "team_code": "logistics",
        "applies_project": True,
        "applies_well": True,
        "status_set": "standard",
        "icon_key": icon_key,
        "locks_with_plan": False,
        "sort_order": 100,
    }


@pytest.mark.asyncio
async def test_admin_catalog_offers_every_icon_key_in_order(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _make_admin(client, db)
    resp = await client.get("/api/admin/readiness/catalog")
    assert resp.status_code == 200
    assert resp.json()["icon_keys"] == list(ICON_KEYS)


@pytest.mark.asyncio
async def test_admins_can_use_the_new_icons_and_nothing_else(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _make_admin(client, db)
    team = await client.post(
        "/api/admin/readiness/teams",
        json={"code": "logistics", "name": "Logistics", "icon_key": "anchor"},
    )
    assert team.status_code == 201, team.text
    assert team.json()["icon_key"] == "anchor"

    created = await client.post("/api/admin/readiness/checks", json=_check("CRX", "construction"))
    assert created.status_code == 201, created.text
    assert created.json()["icon_key"] == "construction"

    # An edit to a new key is applied and on the record (ASCII detail).
    edited = await client.patch("/api/admin/readiness/checks/CRX", json={"icon_key": "hard-hat"})
    assert edited.status_code == 200, edited.text
    assert edited.json()["icon_key"] == "hard-hat"
    event = (
        await db.execute(
            select(AuditLog).where(
                AuditLog.entity_type == "readiness_catalog",
                AuditLog.field == "readiness_check_updated",
            )
        )
    ).scalar_one()
    assert "icon_key: construction -> hard-hat" in event.new_value
    assert event.new_value.isascii()

    # Still an allow-list: a near miss, another case, an alias name lucide has but
    # the registry doesn't, or markup is refused on every write path.
    for bad in ("helicopters", "Helicopter", "file-pen-line", "<svg/>", "", " anchor"):
        assert (
            await client.post("/api/admin/readiness/checks", json=_check("CRY", bad))
        ).status_code == 422, bad
        assert (
            await client.patch("/api/admin/readiness/checks/CRX", json={"icon_key": bad})
        ).status_code == 422, bad
        assert (
            await client.patch("/api/admin/readiness/teams/logistics", json={"icon_key": bad})
        ).status_code == 422, bad
        assert (
            await client.post(
                "/api/admin/readiness/teams",
                json={"code": "supply", "name": "Supply", "icon_key": bad},
            )
        ).status_code == 422, bad
    # The refused edits changed nothing.
    catalog = (await client.get("/api/admin/readiness/catalog")).json()
    assert {c["code"]: c["icon_key"] for c in catalog["checks"]}["CRX"] == "hard-hat"
    assert {t["code"]: t["icon_key"] for t in catalog["teams"]}["logistics"] == "anchor"
    assert "CRY" not in {c["code"] for c in catalog["checks"]}


@pytest.mark.asyncio
async def test_only_admins_can_set_an_icon(
    client: AsyncClient, noplan_client: AsyncClient, db: AsyncSession
) -> None:
    await _make_admin(client, db)
    assert (
        await client.post(
            "/api/admin/readiness/teams",
            json={"code": "logistics", "name": "Logistics", "icon_key": "anchor"},
        )
    ).status_code == 201

    denied = (
        await noplan_client.patch("/api/admin/readiness/checks/LOC", json={"icon_key": "stamp"}),
        await noplan_client.patch(
            "/api/admin/readiness/teams/logistics", json={"icon_key": "helicopter"}
        ),
        await noplan_client.post("/api/admin/readiness/checks", json=_check("CRZ", "construction")),
    )
    assert [r.status_code for r in denied] == [403, 403, 403]
    # Nothing changed, nothing recorded.
    catalog = (await client.get("/api/admin/readiness/catalog")).json()
    assert {c["code"]: c["icon_key"] for c in catalog["checks"]}["LOC"] == "map-pin"
    assert {t["code"]: t["icon_key"] for t in catalog["teams"]}["logistics"] == "anchor"
    assert "CRZ" not in {c["code"] for c in catalog["checks"]}
    updates = (
        await db.execute(
            select(AuditLog).where(
                AuditLog.entity_type == "readiness_catalog",
                AuditLog.field.in_(("readiness_check_updated", "readiness_team_updated")),
            )
        )
    ).scalars().all()
    assert updates == []
