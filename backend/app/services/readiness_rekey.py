"""Readiness follows an activity when it is renamed (spec §7.1).

Readiness values are keyed by NAMES — field project for project-level checks,
field project + well + activity type for well-level ones — so editing those names
on an activity would otherwise strand its values under the old name.

Rule, per check: when an edit changes a key and NO other activity in the campaign
still carries the old key, the old key's values move to the new key — unless the
new key already has a value for that check, which wins (the old one stays
orphaned, logged; never a silent merge). When other activities still use the old
key, nothing moves: those activities still own it.

Phase 6 (spec §4.4): a check's value at a key is a PAIR — its status entry and
its applicability row (whether it applies there). They move together: if the new
key already has either one for that check, neither moves. The audit event names
any choice that moved ("NAV: does not apply").
"""
import logging
import uuid

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.readiness import ReadinessApplicability, ReadinessEntry
from app.services.audit import ENTITY_READINESS, governance_event

logger = logging.getLogger(__name__)

WellKey = tuple[str, str, str]  # (well_project or "", well_name, activity_type)


def well_key(well_project: str | None, well_name: str | None, activity_type: str) -> WellKey | None:
    """An activity's well-readiness key; None without a well name (no well gates)."""
    if not well_name:
        return None
    return (well_project or "", well_name, activity_type)


def _project_filter(well_project: str):  # type: ignore[no-untyped-def]
    if well_project:
        return Activity.well_project == well_project
    return or_(Activity.well_project.is_(None), Activity.well_project == "")


async def _others_use(
    db: AsyncSession,
    project_id: uuid.UUID,
    activity_id: uuid.UUID,
    well_project: str,
    well_name: str | None = None,
    activity_type: str | None = None,
) -> bool:
    stmt = select(Activity.id).where(
        Activity.project_id == project_id,
        Activity.id != activity_id,
        _project_filter(well_project),
    )
    if well_name is not None:
        stmt = stmt.where(Activity.well_name == well_name, Activity.activity_type == activity_type)
    return (await db.execute(stmt.limit(1))).scalar_one_or_none() is not None


# The two halves of a check's value at a key: its status and whether it applies.
_PAIR = (ReadinessEntry, ReadinessApplicability)


def _at(model, project_id: uuid.UUID, scope: str, key: WellKey):  # type: ignore[no-untyped-def]
    return (
        model.project_id == project_id,
        model.scope == scope,
        model.well_project == key[0],
        model.well_name == key[1],
        model.activity_type == key[2],
    )


async def _move(
    db: AsyncSession,
    project_id: uuid.UUID,
    scope: str,
    old: WellKey,
    new: WellKey,
) -> tuple[list[str], list[str]]:
    """Re-key ``scope`` values from ``old`` to ``new``, per check: the status
    entry and the applicability row move as a pair, and neither moves when the
    new key already has either one for that check. Returns (what moved — each
    code, naming any applicability choice that moved with it, e.g.
    "NAV: does not apply"; the codes left behind because the new key had one)."""
    at_old: dict[str, list[ReadinessEntry | ReadinessApplicability]] = {}
    choices: dict[str, bool] = {}
    for model in _PAIR:
        for value in (
            await db.execute(select(model).where(*_at(model, project_id, scope, old)))
        ).scalars():
            at_old.setdefault(value.check_code, []).append(value)
            if isinstance(value, ReadinessApplicability):
                choices[value.check_code] = bool(value.applies)
    if not at_old:
        return [], []
    # Either half at the new key keeps the whole pair where it is.
    taken: set[str] = set()
    for model in _PAIR:
        taken.update(
            (
                await db.execute(
                    select(model.check_code).where(*_at(model, project_id, scope, new))
                )
            ).scalars()
        )

    moved: list[str] = []
    kept: list[str] = []
    for code in sorted(at_old):
        if code in taken:
            kept.append(code)
            continue
        for value in at_old[code]:
            value.well_project, value.well_name, value.activity_type = new
        if code in choices:
            moved.append(f"{code}: {'applies' if choices[code] else 'does not apply'}")
        else:
            moved.append(code)
    return moved, kept


async def carry_readiness_over(
    db: AsyncSession,
    *,
    project_id: uuid.UUID,
    activity_id: uuid.UUID,
    user_id: uuid.UUID,
    old_project: str | None,
    new_project: str | None,
    old_well: WellKey | None,
    new_well: WellKey | None,
) -> None:
    """Call after an activity edit is applied (before commit), with its keys
    before and after. Adds an audit event for anything moved."""
    notes: list[str] = []

    # Field-project entries follow the LAST activity leaving a project name.
    if (
        old_project
        and new_project
        and old_project != new_project
        and not await _others_use(db, project_id, activity_id, old_project)
    ):
        moved, kept = await _move(
            db, project_id, "project", (old_project, "", ""), (new_project, "", "")
        )
        if moved:
            notes.append(f"field project {old_project} -> {new_project}: {', '.join(moved)}")
        if kept:
            logger.warning(
                "readiness_rekey_conflict project_id=%s activity_id=%s scope=project checks=%s",
                project_id,
                activity_id,
                ",".join(kept),
            )

    # Well entries follow the last activity leaving a well key.
    if (
        old_well
        and new_well
        and old_well != new_well
        and not await _others_use(db, project_id, activity_id, *old_well)
    ):
        moved, kept = await _move(db, project_id, "well", old_well, new_well)
        if moved:
            notes.append(
                f"well {old_well[1]} ({old_well[0] or 'no field project'}, {old_well[2]}) -> "
                f"{new_well[1]} ({new_well[0] or 'no field project'}, {new_well[2]}): "
                + ", ".join(moved)
            )
        if kept:
            logger.warning(
                "readiness_rekey_conflict project_id=%s activity_id=%s scope=well checks=%s",
                project_id,
                activity_id,
                ",".join(kept),
            )

    if notes:
        db.add(
            governance_event(
                project_id=project_id,
                user_id=user_id,
                entity_type=ENTITY_READINESS,
                entity_id=activity_id,
                action="readiness_rekeyed",
                detail=("Readiness moved with the rename: " + "; ".join(notes))[:512],
            )
        )
