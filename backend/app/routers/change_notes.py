import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.locks import assert_project_not_locked
from app.core.rbac import assert_member
from app.database import get_db
from app.models.change_note import ChangeNote
from app.models.project import ProjectRole
from app.models.user import User
from app.schemas.change_note import ChangeNoteResponse, ChangeNoteUpsert

router = APIRouter(prefix="/api/projects/{project_id}/change-notes", tags=["change-notes"])

CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[AsyncSession, Depends(get_db)]


def _match(project_id: uuid.UUID, kind: str, resource_name: str | None):
    stmt = select(ChangeNote).where(
        ChangeNote.project_id == project_id, ChangeNote.kind == kind
    )
    # "general" is a singleton per project (NULL resource_name); the others key by name.
    if kind == "general":
        return stmt.where(ChangeNote.resource_name.is_(None))
    return stmt.where(ChangeNote.resource_name == resource_name)


@router.get("", response_model=list[ChangeNoteResponse])
async def list_change_notes(
    project_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> list[ChangeNote]:
    await assert_member(project_id, current_user, db)
    result = await db.execute(
        select(ChangeNote)
        .where(ChangeNote.project_id == project_id)
        .order_by(ChangeNote.kind, ChangeNote.resource_name)
    )
    return list(result.scalars().all())


@router.put("", response_model=ChangeNoteResponse | None)
async def upsert_change_note(
    project_id: uuid.UUID, payload: ChangeNoteUpsert, current_user: CurrentUser, db: DB
) -> ChangeNote | None:
    """Author/replace one resource's change note. Planner-only and frozen with the
    plan (lock-guarded) — they're authored while drafting and snapshotted on submit.
    An empty body deletes the note, so a resource with nothing to say drops out."""
    await assert_member(project_id, current_user, db, allowed_roles={ProjectRole.planner})
    await assert_project_not_locked(project_id, db)

    existing = (
        await db.execute(_match(project_id, payload.kind, payload.resource_name))
    ).scalar_one_or_none()

    body = payload.body.strip()
    if not body:
        if existing is not None:
            await db.delete(existing)
            await db.commit()
        return None

    if existing is None:
        existing = ChangeNote(
            project_id=project_id,
            kind=payload.kind,
            resource_name=payload.resource_name,
            body=body,
            updated_by=current_user.id,
        )
        db.add(existing)
    else:
        existing.body = body
        existing.updated_by = current_user.id
    await db.commit()
    await db.refresh(existing)
    return existing
