"""Admin: the readiness catalog (teams, checks) and global team grants.

Phase 2 of docs/readiness-framework-spec.md. Every endpoint is admin-only
(``get_current_admin``) and every change writes a governance audit event in the
same transaction (``project_id`` NULL — catalog and grants are global).

Catalog rules enforced here (the schemas bound and shape the input):
- Codes are immutable and never reused — a retired check's code stays taken, as
  do reserved retired codes (``CON``). Checks are retired, never deleted.
- A check's team, status set, scope and lock behaviour are fixed at creation:
  changing them would reinterpret values already stored and frozen in revisions.
- The built-in "projects" team (the field-project gates, edited by planners)
  can't be deactivated, and its checks must lock with the plan.
- New teams are always grant-edited; only the built-in team is planner-edited.
- A WITHDRAWN check (phase 6, spec §4.4 — a history-only status set or a tag
  list; today ``NEQ``) can't be restored (409) or re-created (its code stays
  taken; the schema refuses both for a new check). Tag lists are history only,
  so their endpoints are gone (Nominated Equipment withdrawn, spec §3.5).
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_admin
from app.database import get_db
from app.models.readiness import (
    ICON_KEYS,
    PROJECTS_TEAM,
    ReadinessCheck,
    ReadinessTeam,
    UserTeamGrant,
    is_withdrawn,
)
from app.models.user import User
from app.schemas.readiness import (
    AdminCatalogCheck,
    AdminCatalogTeam,
    AdminReadinessCatalog,
    CheckCreate,
    CheckUpdate,
    TeamCreate,
    TeamGrantsResponse,
    TeamGrantsUpdate,
    TeamUpdate,
    status_sets_payload,
)
from app.services.audit import ENTITY_READINESS_CATALOG, ENTITY_USER, governance_event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])

CurrentAdmin = Annotated[User, Depends(get_current_admin)]
DB = Annotated[AsyncSession, Depends(get_db)]

# Retired codes from before the catalog existed — never reusable.
RESERVED_CHECK_CODES = frozenset({"CON"})


def _audit(admin: User, entity_id: uuid.UUID, action: str, detail: str, old: str | None = None):
    return governance_event(
        project_id=None,
        user_id=admin.id,
        entity_type=ENTITY_READINESS_CATALOG,
        entity_id=entity_id,
        action=action,
        detail=detail[:512],
        old_value=old[:512] if old else None,
    )


def _changes(obj: object, updates: dict[str, object]) -> list[str]:
    """Apply the non-None updates to ``obj``; return "field: old -> new" lines for
    the ones that actually changed."""
    lines: list[str] = []
    for field, new in updates.items():
        if new is None:
            continue
        old = getattr(obj, field)
        if old != new:
            lines.append(f"{field}: {old} -> {new}")
            setattr(obj, field, new)
    return lines


async def _team_or_404(code: str, db: AsyncSession) -> ReadinessTeam:
    team = (
        await db.execute(select(ReadinessTeam).where(ReadinessTeam.code == code))
    ).scalar_one_or_none()
    if team is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    return team


async def _check_or_404(code: str, db: AsyncSession) -> ReadinessCheck:
    check = (
        await db.execute(select(ReadinessCheck).where(ReadinessCheck.code == code))
    ).scalar_one_or_none()
    if check is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Check not found")
    return check


# ── Catalog ─────────────────────────────────────────────────────────────────


@router.get("/readiness/catalog", response_model=AdminReadinessCatalog)
async def get_admin_catalog(_admin: CurrentAdmin, db: DB) -> AdminReadinessCatalog:
    teams = (
        (
            await db.execute(
                select(ReadinessTeam).order_by(ReadinessTeam.sort_order, ReadinessTeam.code)
            )
        )
        .scalars()
        .all()
    )
    checks = (
        (
            await db.execute(
                select(ReadinessCheck).order_by(ReadinessCheck.sort_order, ReadinessCheck.code)
            )
        )
        .scalars()
        .all()
    )
    # Every check, withdrawn ones included (flagged ``withdrawn``: no Restore);
    # history-only status sets are listed but flagged, so the form doesn't offer
    # them for a new check.
    return AdminReadinessCatalog(
        teams=[AdminCatalogTeam.model_validate(t, from_attributes=True) for t in teams],
        checks=[AdminCatalogCheck.model_validate(c, from_attributes=True) for c in checks],
        status_sets=status_sets_payload(),
        icon_keys=list(ICON_KEYS),
    )


@router.post(
    "/readiness/teams", response_model=AdminCatalogTeam, status_code=status.HTTP_201_CREATED
)
async def create_team(payload: TeamCreate, admin: CurrentAdmin, db: DB) -> AdminCatalogTeam:
    existing = (
        await db.execute(select(ReadinessTeam.id).where(ReadinessTeam.code == payload.code))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="That team code is already in use"
        )
    team = ReadinessTeam(
        code=payload.code,
        name=payload.name,
        editor_source="team_grant",  # only the built-in team is planner-edited
        icon_key=payload.icon_key,
        sort_order=payload.sort_order,
        is_active=True,
    )
    db.add(team)
    await db.flush()
    db.add(
        _audit(
            admin,
            team.id,
            "readiness_team_created",
            f"Created readiness team {team.code} ({team.name})",
        )
    )
    await db.commit()
    await db.refresh(team)
    logger.info("readiness_team_created actor_id=%s team=%s", admin.id, team.code)
    return AdminCatalogTeam.model_validate(team, from_attributes=True)


@router.patch("/readiness/teams/{team_code}", response_model=AdminCatalogTeam)
async def update_team(
    team_code: str, payload: TeamUpdate, admin: CurrentAdmin, db: DB
) -> AdminCatalogTeam:
    team = await _team_or_404(team_code, db)
    if team.code == PROJECTS_TEAM and payload.is_active is False:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The project-gates team can't be deactivated",
        )
    changes = _changes(
        team,
        {
            "name": payload.name,
            "icon_key": payload.icon_key,
            "sort_order": payload.sort_order,
            "is_active": payload.is_active,
        },
    )
    if changes:
        db.add(
            _audit(
                admin,
                team.id,
                "readiness_team_updated",
                f"Updated readiness team {team.code}: " + "; ".join(changes),
            )
        )
        await db.commit()
        await db.refresh(team)
        logger.info("readiness_team_updated actor_id=%s team=%s", admin.id, team.code)
    return AdminCatalogTeam.model_validate(team, from_attributes=True)


@router.post(
    "/readiness/checks", response_model=AdminCatalogCheck, status_code=status.HTTP_201_CREATED
)
async def create_check(payload: CheckCreate, admin: CurrentAdmin, db: DB) -> AdminCatalogCheck:
    team = (
        await db.execute(
            select(ReadinessTeam).where(
                ReadinessTeam.code == payload.team_code, ReadinessTeam.is_active
            )
        )
    ).scalar_one_or_none()
    if team is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown or inactive team"
        )
    # The field-project gates are what approvers sign: they always lock with the
    # plan and live at project level.
    if team.code == PROJECTS_TEAM and not payload.locks_with_plan:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Project gates must lock with the plan",
        )
    # …and only they do (spec §3.7): a governed check in another team would be
    # signed and frozen with the plan but never shown as a project gate — on the
    # Project gates lens, its tile or the gate KPIs.
    if team.code != PROJECTS_TEAM and payload.locks_with_plan:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only project gates lock with the plan",
        )
    taken = (
        await db.execute(select(ReadinessCheck.id).where(ReadinessCheck.code == payload.code))
    ).scalar_one_or_none()
    if taken is not None or payload.code in RESERVED_CHECK_CODES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That check code is already in use or reserved",
        )
    check = ReadinessCheck(
        code=payload.code,
        label=payload.label,
        team_code=team.code,
        applies_project=payload.applies_project,
        applies_well=payload.applies_well,
        status_set=payload.status_set,
        icon_key=payload.icon_key,
        locks_with_plan=payload.locks_with_plan,
        tag_list=payload.tag_list,
        sort_order=payload.sort_order,
    )
    db.add(check)
    await db.flush()
    scope = "+".join(
        s for s, on in (("project", check.applies_project), ("well", check.applies_well)) if on
    )
    db.add(
        _audit(
            admin,
            check.id,
            "readiness_check_created",
            f"Created readiness check {check.code} ({check.label}) for team {team.code}; "
            f"scope {scope}; status set {check.status_set}; "
            f"{'locks with the plan' if check.locks_with_plan else 'stays live'}",
        )
    )
    await db.commit()
    await db.refresh(check)
    logger.info("readiness_check_created actor_id=%s check=%s", admin.id, check.code)
    return AdminCatalogCheck.model_validate(check, from_attributes=True)


@router.patch("/readiness/checks/{check_code}", response_model=AdminCatalogCheck)
async def update_check(
    check_code: str, payload: CheckUpdate, admin: CurrentAdmin, db: DB
) -> AdminCatalogCheck:
    check = await _check_or_404(check_code, db)
    changes = _changes(
        check,
        {"label": payload.label, "icon_key": payload.icon_key, "sort_order": payload.sort_order},
    )
    if changes:
        db.add(
            _audit(
                admin,
                check.id,
                "readiness_check_updated",
                f"Updated readiness check {check.code}: " + "; ".join(changes),
            )
        )
        await db.commit()
        await db.refresh(check)
        logger.info("readiness_check_updated actor_id=%s check=%s", admin.id, check.code)
    return AdminCatalogCheck.model_validate(check, from_attributes=True)


async def _set_retired(
    check_code: str, retire: bool, admin: User, db: AsyncSession
) -> AdminCatalogCheck:
    check = await _check_or_404(check_code, db)
    # A withdrawn check is retired for good (spec §4.4): restoring it would bring
    # back a status set or tag list no screen offers any more. Its code was
    # already taken, so it can't be re-created either.
    if not retire and is_withdrawn(check):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This check was withdrawn and can't be restored",
        )
    if (check.retired_at is not None) != retire:
        check.retired_at = datetime.now(timezone.utc) if retire else None
        action = "readiness_check_retired" if retire else "readiness_check_restored"
        verb = "Retired" if retire else "Restored"
        # Retiring keeps every stored value and past revision intact — the check
        # just stops being shown and written.
        db.add(
            _audit(admin, check.id, action, f"{verb} readiness check {check.code} ({check.label})")
        )
        await db.commit()
        await db.refresh(check)
        logger.info("%s actor_id=%s check=%s", action, admin.id, check.code)
    return AdminCatalogCheck.model_validate(check, from_attributes=True)


@router.post("/readiness/checks/{check_code}/retire", response_model=AdminCatalogCheck)
async def retire_check(check_code: str, admin: CurrentAdmin, db: DB) -> AdminCatalogCheck:
    return await _set_retired(check_code, True, admin, db)


@router.post("/readiness/checks/{check_code}/restore", response_model=AdminCatalogCheck)
async def restore_check(check_code: str, admin: CurrentAdmin, db: DB) -> AdminCatalogCheck:
    return await _set_retired(check_code, False, admin, db)


# ── Team grants ─────────────────────────────────────────────────────────────


@router.put("/users/{user_id}/teams", response_model=TeamGrantsResponse)
async def set_user_teams(
    user_id: uuid.UUID, payload: TeamGrantsUpdate, admin: CurrentAdmin, db: DB
) -> TeamGrantsResponse:
    """Replace the set of readiness teams this user may edit. A grant covers
    every campaign and confers nothing beyond writing that team's checks."""
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    wanted = set(payload.teams)
    current = {
        g.team_code: g
        for g in (await db.execute(select(UserTeamGrant).where(UserTeamGrant.user_id == user.id)))
        .scalars()
        .all()
    }
    to_add = wanted - current.keys()
    to_remove = current.keys() - wanted

    # Only active, grant-edited teams can be GRANTED (the project gates belong to
    # campaign planners). Revoking is always allowed, even for an inactive team.
    teams = {
        t.code: t
        for t in (await db.execute(select(ReadinessTeam).where(ReadinessTeam.code.in_(to_add))))
        .scalars()
        .all()
    }
    if any(
        code not in teams or teams[code].editor_source != "team_grant" or not teams[code].is_active
        for code in to_add
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Grants are only available for active readiness teams",
        )

    for code in sorted(to_add):
        db.add(UserTeamGrant(user_id=user.id, team_code=code))
        db.add(
            governance_event(
                project_id=None,
                user_id=admin.id,
                entity_type=ENTITY_USER,
                entity_id=user.id,
                action="team_grant_granted",
                detail=f"Granted the {code} readiness grant to {user.email} (by {admin.email})"[
                    :512
                ],
            )
        )
    for code in sorted(to_remove):
        await db.delete(current[code])
        db.add(
            governance_event(
                project_id=None,
                user_id=admin.id,
                entity_type=ENTITY_USER,
                entity_id=user.id,
                action="team_grant_revoked",
                detail=f"Revoked the {code} readiness grant from {user.email} (by {admin.email})"[
                    :512
                ],
            )
        )
    await db.commit()

    for code in sorted(to_add):
        logger.info(
            "team_grant_change actor_id=%s target_id=%s team=%s granted", admin.id, user.id, code
        )
    for code in sorted(to_remove):
        logger.info(
            "team_grant_change actor_id=%s target_id=%s team=%s revoked", admin.id, user.id, code
        )
    return TeamGrantsResponse(teams=sorted(wanted))
