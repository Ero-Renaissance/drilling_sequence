"""Activity-type resolution at import: the layered pipeline.

canonical → formatting (silent) → curated alias → THIS upload's manual mapping
→ unknown (imported verbatim, warned). The dry run feeds the mapping dialog
without writing anything; "remember" persists a mapping as an org-wide alias
(a global governance event) that future uploads apply automatically.
"""
import io
import json

import pytest
from httpx import AsyncClient

from app.services.data_processor import resolve_activity_type

HEADER = (
    "Location,Rig Name,HWU Name,Activity Type,Plan Type,Project,Well Name,"
    "Start Date,End Date,Rig Contract Expiry Date,HWU Contract Expiry Date,Risk,"
    "Readiness Check,Readiness Check Status,Comment"
)


def _sheet(activity_type: str) -> bytes:
    row = (
        f"LAND,RIG_1,,{activity_type},In Plan (Firm),PX,W-1,"
        f"05/01/2026,15/03/2026,,,No Flood Risk,BUD,On track,"
    )
    return ("\n".join([HEADER, row]) + "\n").encode()


async def _project(client: AsyncClient, name: str = "TypeMap") -> str:
    return (await client.post("/api/projects", json={"name": name})).json()["id"]


async def _import(client: AsyncClient, pid: str, body: bytes, **extra):
    return await client.post(
        f"/api/projects/{pid}/activities/import?replace=true"
        + ("&dry_run=true" if extra.pop("dry_run", False) else ""),
        files={"file": ("schedule.csv", io.BytesIO(body), "text/csv")},
        data=extra,
    )


# ── Unit: the resolver layers ─────────────────────────────────────────────────


def test_resolver_layers() -> None:
    # canonical: stored as-is
    assert resolve_activity_type("Gas Development") == ("Gas Development", "canonical")
    # formatting: same words, different typing → canonical spelling, silent
    assert resolve_activity_type("Gas Exploration(Including HPHT)") == (
        "Gas Exploration (including HPHT)",
        "formatting",
    )
    assert resolve_activity_type("  gas development ") == ("Gas Development", "formatting")
    # builtin alias: the Well Testing rename keeps old sheets importing clean
    assert resolve_activity_type("Well Testing") == ("Well Cleanup/Test", "alias")
    # remembered alias (db layer, passed in by the endpoint)
    assert resolve_activity_type("W/O", {"w/o": "Oil Workover"}) == ("Oil Workover", "alias")
    # manual mapping for this upload only
    assert resolve_activity_type("Gas Dvelopment", None, {"gas dvelopment": "Gas Development"}) == (
        "Gas Development",
        "mapped",
    )
    # unknown: verbatim — NEVER fuzzy-matched
    assert resolve_activity_type("Gas Dvelopment") == ("Gas Dvelopment", "unknown")


# ── API: dry run, mapping, remember ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_dry_run_previews_unknowns_without_writing(client: AsyncClient) -> None:
    pid = await _project(client)
    # An existing activity that replace-mode would normally delete.
    r = await client.post(
        f"/api/projects/{pid}/activities",
        json={
            "activity_type": "Oil Development",
            "start_date": "2026-01-01",
            "end_date": "2026-02-01",
            "well_name": "KEEP-ME",
            "location": "LAND",
            "plan_type": "Firm",
            "risk": "No Flood Risk",
        },
    )
    assert r.status_code == 201

    r = await _import(client, pid, _sheet("Gas Dvelopment"), dry_run=True)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dry_run"] is True
    assert body["unknown_types"] == [{"value": "Gas Dvelopment", "rows": 1}]

    # NOTHING was written or deleted — the preview is side-effect free.
    acts = (await client.get(f"/api/projects/{pid}/activities")).json()
    assert [a["well_name"] for a in acts] == ["KEEP-ME"]


@pytest.mark.asyncio
async def test_formatting_variants_resolve_silently(client: AsyncClient) -> None:
    pid = await _project(client)
    r = await _import(client, pid, _sheet("Gas Exploration(Including HPHT)"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["unknown_types"] == []
    assert body["applied_mappings"] == []  # formatting fixes are silent
    assert body["warnings"] == []
    acts = (await client.get(f"/api/projects/{pid}/activities")).json()
    assert acts[0]["activity_type"] == "Gas Exploration (including HPHT)"


@pytest.mark.asyncio
async def test_builtin_alias_applies_and_is_reported(client: AsyncClient) -> None:
    pid = await _project(client)
    r = await _import(client, pid, _sheet("Well Testing"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["applied_mappings"] == [
        {"source": "Well Testing", "target": "Well Cleanup/Test", "rows": 1}
    ]
    acts = (await client.get(f"/api/projects/{pid}/activities")).json()
    assert acts[0]["activity_type"] == "Well Cleanup/Test"


@pytest.mark.asyncio
async def test_manual_mapping_applies_and_remember_persists(client: AsyncClient) -> None:
    pid = await _project(client)
    r = await _import(
        client,
        pid,
        _sheet("Gas Dvelopment"),
        mappings=json.dumps({"Gas Dvelopment": "Gas Development"}),
        remember=json.dumps(["Gas Dvelopment"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["applied_mappings"] == [
        {"source": "Gas Dvelopment", "target": "Gas Development", "rows": 1}
    ]
    assert body["unknown_types"] == []
    acts = (await client.get(f"/api/projects/{pid}/activities")).json()
    assert acts[0]["activity_type"] == "Gas Development"

    # The remembered alias now applies automatically — no mapping sent.
    r = await _import(client, pid, _sheet("gas dvelopment"))
    assert r.status_code == 200, r.text
    assert r.json()["applied_mappings"] == [
        {"source": "gas dvelopment", "target": "Gas Development", "rows": 1}
    ]
    acts = (await client.get(f"/api/projects/{pid}/activities")).json()
    assert acts[0]["activity_type"] == "Gas Development"


@pytest.mark.asyncio
async def test_mapping_target_must_be_canonical(client: AsyncClient) -> None:
    pid = await _project(client)
    r = await _import(
        client, pid, _sheet("Gas Dvelopment"),
        mappings=json.dumps({"Gas Dvelopment": "Made Up Type"}),
    )
    assert r.status_code == 422, r.text
    assert "canonical" in r.json()["detail"]


@pytest.mark.asyncio
async def test_keep_as_is_stays_grey_with_warning(client: AsyncClient) -> None:
    """Not mapping a value is a legitimate choice — it imports verbatim and the
    warning names it (new vocabulary is visible, never blocked)."""
    pid = await _project(client)
    r = await _import(client, pid, _sheet("Riser Repair"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["unknown_types"] == [{"value": "Riser Repair", "rows": 1}]
    assert any("Riser Repair" in w for w in body["warnings"])
    acts = (await client.get(f"/api/projects/{pid}/activities")).json()
    assert acts[0]["activity_type"] == "Riser Repair"


@pytest.mark.asyncio
async def test_dry_run_never_remembers(client: AsyncClient, db) -> None:
    from sqlalchemy import select

    from app.models.activity_type_alias import ActivityTypeAlias

    pid = await _project(client)
    r = await _import(
        client, pid, _sheet("Gas Dvelopment"),
        dry_run=True,
        mappings=json.dumps({"Gas Dvelopment": "Gas Development"}),
        remember=json.dumps(["Gas Dvelopment"]),
    )
    assert r.status_code == 200, r.text
    aliases = (await db.execute(select(ActivityTypeAlias))).scalars().all()
    assert aliases == []
