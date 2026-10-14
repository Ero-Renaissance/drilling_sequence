"""Effective readiness values — what a well (or field project) actually shows.

One rule, used by the team lens API, the revision snapshot's
``readiness_at_submission`` and the dashboard's team tiles (spec §3.6):

- A field project shows its own entry, else the status set's default.
- A well shows, per check: its own entry (checks that apply at well level), else
  its field project's entry (checks that also apply at project level), else the
  default. Tags (checks with a tag list) are the project's ∪ the well's own.

Readiness opt-out: an activity with ``readiness_required = False`` carries NO
readiness from any team (decided 2026-10-14) — callers skip it.
"""
import uuid
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.readiness import (
    STATUS_SETS,
    ReadinessCheck,
    ReadinessEntry,
    ReadinessEntryTag,
    ReadinessTagItem,
)

WellKey = tuple[str, str, str]  # (well_project or "", well_name, activity_type)


@dataclass
class Effective:
    status: str
    source: str  # "well" | "project" | "default"
    notes: str | None = None
    updated_at: datetime | None = None
    tags: list[str] = field(default_factory=list)  # the entry's own tags
    inherited_tags: list[str] = field(default_factory=list)  # the project's (wells)

    @property
    def all_tags(self) -> list[str]:
        return list(dict.fromkeys([*self.inherited_tags, *self.tags]))


@dataclass
class EntryIndex:
    project: dict[tuple[str, str], ReadinessEntry]
    well: dict[tuple[str, str, str, str], ReadinessEntry]
    tags: dict[uuid.UUID, list[str]]

    def tags_of(self, entry: ReadinessEntry | None) -> list[str]:
        return list(self.tags.get(entry.id, [])) if entry is not None else []


def severity(status_set: str, status: str) -> str:
    """The shared severity of a status (done / in_progress / blocked /
    not_counted); an unknown status counts as in progress."""
    return STATUS_SETS.get(status_set, {}).get("statuses", {}).get(status, "in_progress")


async def load_index(
    db: AsyncSession, project_id: uuid.UUID, codes: list[str]
) -> EntryIndex:
    entries = (
        await db.execute(
            select(ReadinessEntry).where(
                ReadinessEntry.project_id == project_id,
                ReadinessEntry.check_code.in_(codes),
            )
        )
    ).scalars().all()
    tags: dict[uuid.UUID, list[str]] = {}
    if entries:
        order = {
            code: i
            for i, code in enumerate(
                (
                    await db.execute(
                        select(ReadinessTagItem.code).order_by(
                            ReadinessTagItem.sort_order, ReadinessTagItem.code
                        )
                    )
                ).scalars()
            )
        }
        rows = (
            await db.execute(
                select(ReadinessEntryTag.entry_id, ReadinessEntryTag.item_code).where(
                    ReadinessEntryTag.entry_id.in_([e.id for e in entries])
                )
            )
        ).all()
        for entry_id, code in rows:
            tags.setdefault(entry_id, []).append(code)
        for codes_ in tags.values():
            codes_.sort(key=lambda c: (order.get(c, len(order)), c))
    return EntryIndex(
        project={(e.well_project, e.check_code): e for e in entries if e.scope == "project"},
        well={
            (e.well_project, e.well_name, e.activity_type, e.check_code): e
            for e in entries
            if e.scope == "well"
        },
        tags=tags,
    )


def _default(check: ReadinessCheck) -> Effective:
    return Effective(status=STATUS_SETS[check.status_set]["default"], source="default")


def project_value(index: EntryIndex, check: ReadinessCheck, well_project: str) -> Effective:
    entry = index.project.get((well_project, check.code)) if well_project else None
    if entry is None:
        return _default(check)
    return Effective(
        status=entry.status,
        source="project",
        notes=entry.notes,
        updated_at=entry.updated_at,
        tags=index.tags_of(entry),
    )


def well_value(index: EntryIndex, check: ReadinessCheck, key: WellKey) -> Effective:
    """A well's effective value for ``check`` (any scope — a project-only check
    reads its field project's value)."""
    wp, wn, at = key
    inherited = (
        project_value(index, check, wp) if check.applies_project else _default(check)
    )
    inherited_tags = inherited.tags if inherited.source == "project" else []
    own = index.well.get((wp, wn, at, check.code)) if check.applies_well else None
    if own is not None:
        return Effective(
            status=own.status,
            source="well",
            notes=own.notes,
            updated_at=own.updated_at,
            tags=index.tags_of(own),
            inherited_tags=inherited_tags,
        )
    if inherited.source == "project":
        # Inherited: the project's tags are "inherited", the well has none of its own.
        return Effective(
            status=inherited.status,
            source="project",
            notes=inherited.notes,
            updated_at=inherited.updated_at,
            inherited_tags=inherited_tags,
        )
    return inherited
