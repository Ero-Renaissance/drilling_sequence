"""The data scenario for migration 038 (spec §4.4, "Test") — shared by
test_migration_038_sqlite.py (every run: the steps replayed on SQLite) and
test_migration_038_mssql.py (SQL Server, in CI).

Seeded at revision 037, checked after the upgrade, changed the way the app will
change it (an untick of a Completed Logistics check, a well ticked under an
unticked field project), checked again after the downgrade.

Everything runs on a synchronous Core connection. Every row it seeds is its own —
two fresh campaigns, a user and four test-only checks with a random suffix — so
``teardown`` removes exactly what ``seed`` added. Not a pytest module: no tests
are collected from it.
"""
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

import sqlalchemy as sa
from alembic.config import Config
from alembic.script import ScriptDirectory

from app.models.audit import AuditLog
from app.models.project import Project
from app.models.readiness import (
    ReadinessApplicability,
    ReadinessCheck,
    ReadinessEntry,
    ReadinessEntryTag,
    ReadinessTeam,
)
from app.models.user import User

BACKEND_DIR = Path(__file__).resolve().parents[1]

FP = "FP-A"  # the field project (well_project)
ACT = "OD"  # the wells' activity type
# When the converted entries were last set — copied onto their unticks.
SET_AT = datetime(2026, 3, 4, 5, 6, 7, tzinfo=timezone.utc)
# When the app made the post-upgrade changes.
CHANGED_AT = datetime(2026, 11, 2, 9, 0, 0, tzinfo=timezone.utc)
# When an admin retired a withdrawn check by hand, long before 038.
ADMIN_RETIRED_AT = datetime(2000, 1, 1, tzinfo=timezone.utc)

ENTRIES = ReadinessEntry.__table__
ROWS = ReadinessApplicability.__table__
CHECKS = ReadinessCheck.__table__
AUDIT = AuditLog.__table__
CHECK_EVENTS = ("readiness_check_retired", "readiness_check_restored")


def migration(revision: str):  # type: ignore[no-untyped-def]
    """A migration module, loaded the way Alembic loads it."""
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return ScriptDirectory.from_config(cfg).get_revision(revision).module


@dataclass
class Seeded:
    user_id: uuid.UUID
    campaign_id: uuid.UUID  # has team N/A values to convert
    other_campaign_id: uuid.UUID  # has none: gets no migration event
    retired_code: str  # a retired Logistics check with an N/A
    governed_code: str  # a governed check outside the Projects team
    tagged_code: str  # an active check with a tag list: withdrawn
    admin_retired_code: str  # an "availability" check an admin retired
    # Withdrawn and active: 038 retires it, then an admin restores and retires it
    # again by hand, so 038's retirement is no longer its latest event.
    readmin_code: str
    check_ids: dict[str, uuid.UUID] = field(default_factory=dict)
    labels: dict[str, str] = field(default_factory=dict)
    neq_entry_id: uuid.UUID = field(default_factory=uuid.uuid4)
    # NEQ's state at seed time: active unless an admin retired it for good.
    neq_active: bool = True
    neq_events: int = 0

    @property
    def test_codes(self) -> list[str]:
        return [
            self.retired_code,
            self.governed_code,
            self.tagged_code,
            self.admin_retired_code,
            self.readmin_code,
        ]

    @property
    def campaign_ids(self) -> list[uuid.UUID]:
        return [self.campaign_id, self.other_campaign_id]


def _entry(
    campaign_id: uuid.UUID,
    user_id: uuid.UUID,
    code: str,
    well: str,
    status: str,
    notes: str | None = None,
    entry_id: uuid.UUID | None = None,
) -> dict:
    return {
        "id": entry_id or uuid.uuid4(),
        "project_id": campaign_id,
        "check_code": code,
        "scope": "well" if well else "project",
        "well_project": FP,
        "well_name": well,
        "activity_type": ACT if well else "",
        "status": status,
        "notes": notes,
        "updated_at": SET_AT,
        "updated_by": user_id,
    }


def _ensure_logistics(conn: sa.Connection) -> None:
    """The Logistics team and its seven checks, from migration 036's literals —
    already there on a migrated database; ``create_all`` seeds only the gates."""
    m036 = migration("036")
    teams = ReadinessTeam.__table__
    if conn.execute(sa.select(teams.c.id).where(teams.c.code == "logistics")).first() is None:
        conn.execute(teams.insert().values(id=uuid.uuid4(), **m036.LOGISTICS_TEAM))
    for code, label, status_set, icon_key, tag_list, sort_order in m036.LOGISTICS_CHECKS:
        if conn.execute(sa.select(CHECKS.c.id).where(CHECKS.c.code == code)).first() is None:
            conn.execute(
                CHECKS.insert().values(
                    id=uuid.uuid4(),
                    code=code,
                    label=label,
                    team_code="logistics",
                    applies_project=True,
                    applies_well=True,
                    status_set=status_set,
                    icon_key=icon_key,
                    locks_with_plan=False,
                    tag_list=tag_list,
                    sort_order=sort_order,
                )
            )


def _check_events(conn: sa.Connection, check_id: uuid.UUID) -> list:
    return conn.execute(
        sa.select(AUDIT)
        .where(
            AUDIT.c.entity_type == "readiness_catalog",
            AUDIT.c.entity_id == check_id,
            AUDIT.c.field.in_(CHECK_EVENTS),
        )
        .order_by(AUDIT.c.timestamp)
    ).all()


def _check(conn: sa.Connection, code: str):  # type: ignore[no-untyped-def]
    return conn.execute(sa.select(CHECKS).where(CHECKS.c.code == code)).one()


def seed(conn: sa.Connection) -> Seeded:
    """Seed at revision 037 (no readiness_applicability table yet)."""
    suffix = uuid.uuid4().hex[:5].upper()
    s = Seeded(
        user_id=uuid.uuid4(),
        campaign_id=uuid.uuid4(),
        other_campaign_id=uuid.uuid4(),
        retired_code=f"ZR{suffix}",
        governed_code=f"ZG{suffix}",
        tagged_code=f"ZT{suffix}",
        admin_retired_code=f"ZA{suffix}",
        readmin_code=f"ZB{suffix}",
    )
    _ensure_logistics(conn)
    neq = _check(conn, "NEQ")
    s.neq_active = neq.retired_at is None
    s.neq_events = len(_check_events(conn, neq.id))

    conn.execute(
        User.__table__.insert().values(
            id=s.user_id,
            ad_object_id=f"m038-{suffix}",
            name="Migration 038",
            email=f"m038-{suffix.lower()}@example.test",
        )
    )
    for cid, name in ((s.campaign_id, "convert"), (s.other_campaign_id, "keep")):
        conn.execute(
            Project.__table__.insert().values(
                id=cid, name=f"__m038__ {name} {suffix}", created_by=s.user_id
            )
        )

    # (code, status_set, tag_list, locks_with_plan, applies_well, retired_at)
    for code, status_set, tag_list, governed, well, retired_at in (
        (s.retired_code, "standard", "", False, True, SET_AT),
        (s.governed_code, "standard", "", True, False, None),
        (s.tagged_code, "standard", "equipment", False, True, None),
        (s.admin_retired_code, "availability", "", False, True, ADMIN_RETIRED_AT),
        (s.readmin_code, "availability", "", False, True, None),
    ):
        check_id = uuid.uuid4()
        s.check_ids[code] = check_id
        s.labels[code] = f"Test check {code}"
        conn.execute(
            CHECKS.insert().values(
                id=check_id,
                code=code,
                label=s.labels[code],
                team_code="logistics",
                applies_project=True,
                applies_well=well,
                status_set=status_set,
                icon_key="ship",
                locks_with_plan=governed,
                tag_list=tag_list,
                sort_order=900,
                retired_at=retired_at,
            )
        )
    conn.execute(
        AUDIT.insert().values(
            id=uuid.uuid4(),
            project_id=None,
            user_id=s.user_id,
            entity_type="readiness_catalog",
            entity_id=s.check_ids[s.admin_retired_code],
            field="readiness_check_retired",
            # Labels are free text, so an admin's detail can end like 038's own:
            # only a NULL user marks the migration's retirement.
            new_value=f"Retired readiness check {s.admin_retired_code} (Old) - migration 038",
            timestamp=ADMIN_RETIRED_AT,
        )
    )

    p, u = s.campaign_id, s.user_id
    conn.execute(
        ENTRIES.insert(),
        [
            # A Project gate set to N/A: untouched, both ways.
            _entry(p, u, "FDP", "", "N/A"),
            # A field project's N/A (with a note) and a well that set its own
            # status under it (applies, own entries win), and one that is N/A too.
            _entry(p, u, "NAV", "", "N/A", notes="pre-038 note"),
            _entry(p, u, "NAV", "W1", "Completed"),
            _entry(p, u, "NAV", "W2", "N/A"),
            # A well's own N/A under a field project that applies.
            _entry(p, u, "PO", "W3", "N/A", notes="po note"),
            # Team values that aren't N/A: untouched by the upgrade.
            _entry(p, u, "CTR", "", "Completed", notes="ctr note"),
            _entry(p, u, "CTR", "W1", "Behind"),
            # A retired team check's N/A converts too.
            _entry(p, u, s.retired_code, "", "N/A"),
            # A governed check keeps N/A, whatever its team.
            _entry(p, u, s.governed_code, "", "N/A"),
            # NEQ history (status + equipment tag) stays as recorded.
            _entry(p, u, "NEQ", "", "Available", entry_id=s.neq_entry_id),
            # The other campaign: a gate N/A and a team status — nothing to convert.
            _entry(s.other_campaign_id, u, "FDP", "", "N/A"),
            _entry(s.other_campaign_id, u, "NAV", "", "Behind"),
        ],
    )
    conn.execute(
        ReadinessEntryTag.__table__.insert().values(
            id=uuid.uuid4(), entry_id=s.neq_entry_id, item_code="PSV"
        )
    )
    return s


def _utc_naive(value: datetime) -> datetime:
    """SQLite drops the offset; SQL Server keeps it. Compare in UTC."""
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _entries(conn: sa.Connection, campaign_id: uuid.UUID) -> dict[tuple[str, str], sa.Row]:
    """A campaign's entries by (check, well name — "" for the field project)."""
    rows = conn.execute(sa.select(ENTRIES).where(ENTRIES.c.project_id == campaign_id)).all()
    assert all(r.well_project == FP for r in rows)
    return {(r.check_code, r.well_name): r for r in rows}


def _statuses(conn: sa.Connection, campaign_id: uuid.UUID) -> dict[tuple[str, str], str]:
    return {k: r.status for k, r in _entries(conn, campaign_id).items()}


def applicability(conn: sa.Connection, campaign_id: uuid.UUID) -> dict[tuple[str, str], sa.Row]:
    rows = conn.execute(sa.select(ROWS).where(ROWS.c.project_id == campaign_id)).all()
    for r in rows:
        assert r.well_project == FP
        assert r.scope == ("well" if r.well_name else "project")
        assert r.activity_type == (ACT if r.well_name else "")
    return {(r.check_code, r.well_name): r for r in rows}


def _migrated_events(conn: sa.Connection, campaign_id: uuid.UUID) -> list:
    return conn.execute(
        sa.select(AUDIT).where(
            AUDIT.c.project_id == campaign_id,
            AUDIT.c.field == "readiness_applicability_migrated",
        )
    ).all()


def _assert_neq_tag_kept(conn: sa.Connection, s: Seeded) -> None:
    tags = ReadinessEntryTag.__table__
    assert conn.execute(
        sa.select(tags.c.item_code).where(tags.c.entry_id == s.neq_entry_id)
    ).scalars().all() == ["PSV"]


def assert_upgraded(conn: sa.Connection, s: Seeded) -> None:
    p = s.campaign_id
    # Steps 2 and 3: N/A values of checks that don't lock with the plan became
    # unticks at the same key, keeping who set them and when; the well that set
    # its own status under an N/A field project applies as its own choice.
    rows = applicability(conn, p)
    assert {k: r.applies for k, r in rows.items()} == {
        ("NAV", ""): False,
        ("NAV", "W1"): True,
        ("NAV", "W2"): False,
        ("PO", "W3"): False,
        (s.retired_code, ""): False,
    }
    for key in (("NAV", ""), ("NAV", "W2"), ("PO", "W3"), (s.retired_code, "")):
        assert _utc_naive(rows[key].updated_at) == _utc_naive(SET_AT), key
        assert rows[key].updated_by == s.user_id, key
    assert applicability(conn, s.other_campaign_id) == {}

    # Step 5: those entries are gone; the Project gates' N/A, the governed
    # check's N/A, team statuses and NEQ's history are untouched.
    assert _statuses(conn, p) == {
        ("FDP", ""): "N/A",
        ("NAV", "W1"): "Completed",
        ("CTR", ""): "Completed",
        ("CTR", "W1"): "Behind",
        (s.governed_code, ""): "N/A",
        ("NEQ", ""): "Available",
    }
    assert _entries(conn, p)[("CTR", "")].notes == "ctr note"
    assert _statuses(conn, s.other_campaign_id) == {("FDP", ""): "N/A", ("NAV", ""): "Behind"}
    _assert_neq_tag_kept(conn, s)

    # Step 4: one event for the campaign that had any — in its own feed, no user —
    # with the count and the notes of the deleted entries; none for the other.
    (event,) = _migrated_events(conn, p)
    assert event.entity_type == "readiness" and event.entity_id == p
    assert event.user_id is None and event.old_value is None
    detail = event.new_value
    assert detail.startswith(
        "Converted 4 N/A value(s) of checks that don't lock with the plan to "
        "'does not apply'; notes: "
    ), detail
    assert "NAV for FP-A: pre-038 note" in detail, detail
    assert "PO for W3 (FP-A, OD): po note" in detail, detail
    assert detail.endswith(" - migration 038"), detail
    assert detail.isascii() and len(detail) <= 512
    assert _migrated_events(conn, s.other_campaign_id) == []

    # Step 6: active withdrawn checks are retired, audited like the admin
    # endpoint; a check an admin already retired gets no second event.
    tagged = _check(conn, s.tagged_code)
    assert tagged.retired_at is not None
    (retired,) = _check_events(conn, tagged.id)
    assert retired.field == "readiness_check_retired"
    assert retired.user_id is None and retired.project_id is None
    assert retired.new_value == (
        f"Retired readiness check {s.tagged_code} ({s.labels[s.tagged_code]}) - migration 038"
    )
    readmin = _check(conn, s.readmin_code)
    assert readmin.retired_at is not None
    assert [e.field for e in _check_events(conn, readmin.id)] == ["readiness_check_retired"]
    admin_retired = _check(conn, s.admin_retired_code)
    assert _utc_naive(admin_retired.retired_at) == _utc_naive(ADMIN_RETIRED_AT)
    assert len(_check_events(conn, admin_retired.id)) == 1
    retired_team_check = _check(conn, s.retired_code)
    assert _utc_naive(retired_team_check.retired_at) == _utc_naive(SET_AT)
    assert _check_events(conn, retired_team_check.id) == []
    assert _check(conn, s.governed_code).retired_at is None

    neq = _check(conn, "NEQ")
    assert neq.retired_at is not None
    neq_events = _check_events(conn, neq.id)
    assert len(neq_events) == s.neq_events + (1 if s.neq_active else 0)
    if s.neq_active:
        assert "Retired readiness check NEQ (Nominated Equipment) - migration 038" in [
            e.new_value for e in neq_events if e.field == "readiness_check_retired"
        ]


def change_after_upgrade(conn: sa.Connection, s: Seeded) -> None:
    """What the app does after phase 6 ships: untick a Completed Logistics check
    on the field project, and tick a well (with no status of its own) under the
    unticked NAV. Plus an admin who restores and retires a check 038 retired
    (the API refuses that restore since phase 6; history can still hold it)."""
    readmin_id = s.check_ids[s.readmin_code]
    (retired_by_038,) = _check_events(conn, readmin_id)
    for offset, action in ((1, "readiness_check_restored"), (2, "readiness_check_retired")):
        conn.execute(
            AUDIT.insert().values(
                id=uuid.uuid4(),
                project_id=None,
                user_id=s.user_id,
                entity_type="readiness_catalog",
                entity_id=readmin_id,
                field=action,
                new_value=f"{action} {s.readmin_code} by an admin",
                timestamp=retired_by_038.timestamp + timedelta(seconds=offset),
            )
        )
    base = {"project_id": s.campaign_id, "well_project": FP, "updated_at": CHANGED_AT}
    conn.execute(
        ROWS.insert(),
        [
            {
                **base,
                "id": uuid.uuid4(),
                "check_code": "CTR",
                "scope": "project",
                "well_name": "",
                "activity_type": "",
                "applies": False,
                "updated_by": s.user_id,
            },
            {
                **base,
                "id": uuid.uuid4(),
                "check_code": "NAV",
                "scope": "well",
                "well_name": "W4",
                "activity_type": ACT,
                "applies": True,
                "updated_by": s.user_id,
            },
            # A well's own tick, kept after its field project was ticked again.
            {
                **base,
                "id": uuid.uuid4(),
                "check_code": "PO",
                "scope": "well",
                "well_name": "W5",
                "activity_type": ACT,
                "applies": True,
                "updated_by": s.user_id,
            },
        ],
    )


def assert_downgraded(conn: sa.Connection, s: Seeded) -> None:
    p = s.campaign_id
    assert not sa.inspect(conn).has_table("readiness_applicability")
    entries = _entries(conn, p)
    assert {k: r.status for k, r in entries.items()} == {
        ("FDP", ""): "N/A",  # the gate: untouched
        ("NAV", ""): "N/A",  # step 2: the untick is N/A again
        ("NAV", "W1"): "Completed",  # its own choice to apply: kept
        ("NAV", "W2"): "N/A",
        ("NAV", "W4"): "On Track",  # step 1: what the ticked well read
        ("PO", "W3"): "N/A",
        # (PO W5 ticked under a field project that applies: needs no entry.)
        ("CTR", ""): "N/A",  # step 2, lossy: Completed underneath is lost
        ("CTR", "W1"): "N/A",  # step 3: it followed the unticked project
        (s.retired_code, ""): "N/A",
        (s.governed_code, ""): "N/A",
        ("NEQ", ""): "Available",
    }
    # A re-created N/A carries the untick's time and author; its old note lives
    # on in the migration's audit event. An updated entry keeps its note.
    for key in (("NAV", ""), ("NAV", "W2"), ("PO", "W3"), (s.retired_code, "")):
        assert _utc_naive(entries[key].updated_at) == _utc_naive(SET_AT), key
        assert entries[key].updated_by == s.user_id, key
        assert entries[key].notes is None, key
    assert _utc_naive(entries[("NAV", "W4")].updated_at) == _utc_naive(CHANGED_AT)
    assert entries[("CTR", "")].notes == "ctr note"
    assert _statuses(conn, s.other_campaign_id) == {("FDP", ""): "N/A", ("NAV", ""): "Behind"}
    _assert_neq_tag_kept(conn, s)
    # The audit log is append-only: the migration's event stays.
    assert len(_migrated_events(conn, p)) == 1

    # Step 4: what 038 retired is restored and audited; an admin's retirement
    # stands.
    tagged = _check(conn, s.tagged_code)
    assert tagged.retired_at is None
    # (SQLite stamps whole seconds, so the two events may share a timestamp.)
    events = _check_events(conn, tagged.id)
    assert sorted(e.field for e in events) == list(reversed(CHECK_EVENTS))
    (restored,) = [e for e in events if e.field == "readiness_check_restored"]
    assert restored.user_id is None and restored.project_id is None
    assert restored.new_value == (
        f"Restored readiness check {s.tagged_code} ({s.labels[s.tagged_code]})"
        " - migration 038 downgrade"
    )
    admin_retired = _check(conn, s.admin_retired_code)
    assert admin_retired.retired_at is not None
    assert len(_check_events(conn, admin_retired.id)) == 1
    # 038 retired this one, but an admin's retirement came after: it stands.
    readmin = _check(conn, s.readmin_code)
    assert readmin.retired_at is not None
    assert len(_check_events(conn, readmin.id)) == 3
    assert _check(conn, s.retired_code).retired_at is not None

    neq = _check(conn, "NEQ")
    assert (neq.retired_at is None) == s.neq_active
    neq_events = _check_events(conn, neq.id)
    assert len(neq_events) == s.neq_events + (2 if s.neq_active else 0)


def teardown(conn: sa.Connection, s: Seeded) -> None:
    """Remove every row ``seed`` added and every event written about them.
    NEQ's own retire/restore events stay: they are the migration's real history."""
    campaigns = s.campaign_ids
    check_ids = list(s.check_ids.values())
    conn.execute(
        AUDIT.delete().where(
            sa.or_(AUDIT.c.project_id.in_(campaigns), AUDIT.c.entity_id.in_(check_ids))
        )
    )
    conn.execute(
        ReadinessEntryTag.__table__.delete().where(
            ReadinessEntryTag.__table__.c.entry_id.in_(
                sa.select(ENTRIES.c.id).where(ENTRIES.c.project_id.in_(campaigns))
            )
        )
    )
    if sa.inspect(conn).has_table("readiness_applicability"):
        conn.execute(ROWS.delete().where(ROWS.c.project_id.in_(campaigns)))
    conn.execute(ENTRIES.delete().where(ENTRIES.c.project_id.in_(campaigns)))
    conn.execute(Project.__table__.delete().where(Project.__table__.c.id.in_(campaigns)))
    conn.execute(CHECKS.delete().where(CHECKS.c.code.in_(s.test_codes)))
    conn.execute(User.__table__.delete().where(User.__table__.c.id == s.user_id))
