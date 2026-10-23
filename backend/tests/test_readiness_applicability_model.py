"""Phase 6 data layer (docs/readiness-framework-spec.md §3.3, §3.8, §4.4).

- The code rules: which statuses a person may pick for a check (N/A only for a
  check that locks with the plan; nothing on a history-only set), and which
  checks are WITHDRAWN (a history-only status set or a tag list — today NEQ).
- ``readiness_applicability``: keyed exactly like ``readiness_entries``.

Migration 038 itself: test_migration_038_sqlite.py and test_migration_038_mssql.py.
"""
import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.models.readiness import (
    BUILTIN_CHECKS,
    STATUS_SETS,
    ReadinessApplicability,
    ReadinessCheck,
    ReadinessTeam,
    is_history_only,
    is_withdrawn,
    pickable_statuses,
)
from app.models.user import User
from tests.migration_038_scenario import migration

# Migration 036's Logistics seed: (code, label, status_set, icon_key, tag_list, order).
M036 = migration("036")
LOGISTICS_SEED = M036.LOGISTICS_CHECKS


def _check(status_set: str = "standard", *, governed: bool = False, tag_list: str = ""):
    return SimpleNamespace(status_set=status_set, tag_list=tag_list, locks_with_plan=governed)


def test_only_the_availability_set_is_history_only() -> None:
    assert [name for name in STATUS_SETS if is_history_only(name)] == ["availability"]
    assert not is_history_only("standard")
    assert not is_history_only("no-such-set")


def test_project_gates_keep_n_a_and_team_checks_lose_it() -> None:
    """The pickable rule (§3.3): the set's statuses, minus N/A when the check
    doesn't lock with the plan. Picker order is the set's order."""
    gate = ReadinessCheck(**BUILTIN_CHECKS[0])
    assert gate.locks_with_plan
    assert pickable_statuses(gate) == ["On Track", "Completed", "Behind", "N/A"]
    assert pickable_statuses(_check(governed=False)) == ["On Track", "Completed", "Behind"]


def test_nothing_is_pickable_on_a_history_only_or_unknown_set() -> None:
    assert pickable_statuses(_check("availability")) == []
    assert pickable_statuses(_check("availability", governed=True)) == []
    assert pickable_statuses(_check("no-such-set", governed=True)) == []


@pytest.mark.parametrize(
    ("status_set", "tag_list", "withdrawn"),
    [
        ("standard", "", False),
        ("availability", "", True),  # history-only set
        ("standard", "equipment", True),  # a tag list
        ("availability", "equipment", True),  # NEQ
    ],
)
def test_withdrawn_is_a_history_only_set_or_a_tag_list(
    status_set: str, tag_list: str, withdrawn: bool
) -> None:
    assert is_withdrawn(_check(status_set, tag_list=tag_list)) is withdrawn


def test_neq_is_the_only_withdrawn_seeded_check() -> None:
    seeded = [
        (c["code"], c["status_set"], c["tag_list"]) for c in BUILTIN_CHECKS
    ] + [(code, status_set, tag_list) for code, _, status_set, _, tag_list, _ in LOGISTICS_SEED]
    assert [code for code, s, t in seeded if is_withdrawn(_check(s, tag_list=t))] == ["NEQ"]


async def _campaign(db: AsyncSession) -> uuid.UUID:
    """A campaign, and the Logistics NAV check (create_all seeds only the gates)."""
    db.add(ReadinessTeam(**M036.LOGISTICS_TEAM))
    await db.flush()
    db.add(
        ReadinessCheck(
            code="NAV",
            label="Naval Clearance",
            team_code="logistics",
            applies_project=True,
            applies_well=True,
            status_set="standard",
            icon_key="ship",
            locks_with_plan=False,
            tag_list="",
        )
    )
    user = User(id=uuid.uuid4(), ad_object_id="m038-model", name="M", email="m@example.test")
    db.add(user)
    await db.flush()
    project = Project(id=uuid.uuid4(), name="Applicability", created_by=user.id)
    db.add(project)
    await db.flush()
    return project.id


def _row(campaign_id: uuid.UUID, well: str = "", applies: bool = False) -> ReadinessApplicability:
    return ReadinessApplicability(
        project_id=campaign_id,
        check_code="NAV",
        scope="well" if well else "project",
        well_project="Bonga Phase 3",
        well_name=well,
        activity_type="Oil Development" if well else "",
        applies=applies,
    )


async def test_one_choice_per_check_and_target(db: AsyncSession) -> None:
    campaign_id = await _campaign(db)
    db.add_all([_row(campaign_id), _row(campaign_id, "EGB-12", applies=True)])
    await db.commit()
    stored = (
        await db.execute(
            select(ReadinessApplicability).where(ReadinessApplicability.project_id == campaign_id)
        )
    ).scalars().all()
    assert {(r.scope, r.well_name, r.applies) for r in stored} == {
        ("project", "", False),
        ("well", "EGB-12", True),
    }
    assert all(r.updated_at is not None and r.updated_by is None for r in stored)

    db.add(_row(campaign_id, "EGB-12", applies=False))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
