"""The data scenario for migration 039 (spec §4.5, "Tests") — shared by
test_migration_039_sqlite.py (every run: the steps replayed on SQLite) and
test_migration_039_mssql.py (SQL Server, in CI).

At 039: check the seed, then add what admins and teams will add — a check that
starts unticked, one that starts ticked with a category, two an admin retired
(one starting unticked; one starting ticked whose LABEL reads "; starts
unticked"), one starting unticked that the downgrade retires and an admin then
restores and retires again, and a nomination with a status on a seeded check —
downgrade to 038 and check, make the admin's changes (``change_after_downgrade``),
then upgrade again and check that the round trip ends with all 21 seeded checks
active, starting unticked and categorised, and the admin's retirement kept.

Everything runs on a synchronous Core connection. Every row it seeds is its own
(a user, a campaign and five test-only checks with a random suffix), so
``teardown`` removes exactly what ``seed`` added; events about the 21 seeded
checks stay, as the migration's real history. Counts of those events are taken
at seed time, so the checks hold on a database that has been round-tripped
before (SQL Server CI runs 038's round trip first). Not a pytest module.
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
from app.models.readiness import ReadinessApplicability, ReadinessEntry, ReadinessTeam
from app.models.user import User

BACKEND_DIR = Path(__file__).resolve().parents[1]

FP = "FP-E"  # the field project
# When an admin retired a test check by hand, long before 039.
ADMIN_RETIRED_AT = datetime(2000, 1, 1, tzinfo=timezone.utc)
TEST_CATEGORY = "Test category"

AUDIT = AuditLog.__table__
ENTRIES = ReadinessEntry.__table__
ROWS = ReadinessApplicability.__table__
CHECK_EVENTS = ("readiness_check_retired", "readiness_check_restored")

_CHECK_COLUMNS_038 = (
    sa.column("id", sa.Uuid()),
    sa.column("code", sa.String(16)),
    sa.column("label", sa.String(64)),
    sa.column("team_code", sa.String(32)),
    sa.column("applies_project", sa.Boolean()),
    sa.column("applies_well", sa.Boolean()),
    sa.column("status_set", sa.String(16)),
    sa.column("icon_key", sa.String(32)),
    sa.column("locks_with_plan", sa.Boolean()),
    sa.column("tag_list", sa.String(32)),
    sa.column("sort_order", sa.Integer()),
    sa.column("retired_at", sa.DateTime(timezone=True)),
)
# readiness_checks at 038 (before) and at 039 — literals, never the model, which
# would select 039's columns where they don't exist.
CHECKS_038 = sa.table("readiness_checks", *_CHECK_COLUMNS_038)
CHECKS = sa.table(
    "readiness_checks",
    *[sa.column(c.name, c.type) for c in _CHECK_COLUMNS_038],
    sa.column("category", sa.String(64)),
    sa.column("applies_by_default", sa.Boolean()),
)


def migration(revision: str):  # type: ignore[no-untyped-def]
    """A migration module, loaded the way Alembic loads it."""
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return ScriptDirectory.from_config(cfg).get_revision(revision).module


M039 = migration("039")
SEEDED = {row["code"]: row for row in M039.seed_checks()}
CORE_LOGISTICS = ("L-BUD", "CTR", "FFP", "CTS", "PO", "NAV")
GATES = ("FDP", "LLI", "LOC", "FE", "FID", "EIA", "BUD")


@dataclass
class Seeded:
    user_id: uuid.UUID
    campaign_id: uuid.UUID
    unticked_code: str  # admin-created, starts unticked, categorised, active
    ticked_code: str  # admin-created, starts ticked, categorised, active
    admin_retired_code: str  # starts unticked; an admin retired it
    spoof_code: str  # starts ticked; its label reads "; starts unticked"; retired
    # Starts unticked, active at seed: the downgrade retires it, then an admin
    # restores and retires it again (change_after_downgrade).
    readmin_code: str
    check_ids: dict[str, uuid.UUID] = field(default_factory=dict)
    labels: dict[str, str] = field(default_factory=dict)
    # Per seeded code: (retired, restored) events by 039 before this run.
    events_before: dict[str, tuple[int, int]] = field(default_factory=dict)

    @property
    def test_codes(self) -> list[str]:
        return [
            self.unticked_code,
            self.ticked_code,
            self.admin_retired_code,
            self.spoof_code,
            self.readmin_code,
        ]


def ensure_logistics(conn: sa.Connection) -> None:
    """The Logistics team and its six live checks, from migration 036's
    literals — already there on a migrated database; ``create_all`` seeds only
    the gates. (NEQ is irrelevant to 039.)"""
    m036 = migration("036")
    teams = ReadinessTeam.__table__
    if conn.execute(sa.select(teams.c.id).where(teams.c.code == "logistics")).first() is None:
        conn.execute(teams.insert().values(id=uuid.uuid4(), **m036.LOGISTICS_TEAM))
    for code, label, status_set, icon_key, tag_list, sort_order in m036.LOGISTICS_CHECKS:
        if tag_list:
            continue
        if conn.execute(sa.select(CHECKS_038.c.id).where(CHECKS_038.c.code == code)).first():
            continue
        conn.execute(
            CHECKS_038.insert().values(
                id=uuid.uuid4(),
                code=code,
                label=label,
                team_code="logistics",
                applies_project=True,
                applies_well=True,
                status_set=status_set,
                icon_key=icon_key,
                locks_with_plan=False,
                tag_list="",
                sort_order=sort_order,
            )
        )


def _check(conn: sa.Connection, code: str, table: sa.TableClause = CHECKS):  # type: ignore[no-untyped-def]
    return conn.execute(sa.select(table).where(table.c.code == code)).one()


def _events(conn: sa.Connection, check_id: uuid.UUID, *fields: str) -> list:
    return conn.execute(
        sa.select(AUDIT)
        .where(
            AUDIT.c.entity_type == "readiness_catalog",
            AUDIT.c.entity_id == check_id,
            AUDIT.c.field.in_(fields),
        )
        .order_by(AUDIT.c.timestamp)
    ).all()


def _by_039(events: list, field_name: str) -> list:
    """This migration's own events of one kind: no user, the migration's mark."""
    return [
        e
        for e in events
        if e.field == field_name and e.user_id is None and "migration 039" in (e.new_value or "")
    ]


def _counts_039(conn: sa.Connection, check_id: uuid.UUID) -> tuple[int, int]:
    events = _events(conn, check_id, *CHECK_EVENTS)
    return (
        len(_by_039(events, "readiness_check_retired")),
        len(_by_039(events, "readiness_check_restored")),
    )


def assert_seeded(conn: sa.Connection) -> None:
    """At 039: the 21 checks as §3.4 defines them, each created once by 039 and
    audited; every other check starts ticked with no category."""
    for code, want in SEEDED.items():
        row = _check(conn, code)
        assert row.retired_at is None, code
        for key, value in want.items():
            assert getattr(row, key) == value, (code, key)
        (created,) = _events(conn, row.id, "readiness_check_created")
        assert created.user_id is None and created.project_id is None, code
        assert created.new_value == M039.created_detail(want), code
        assert created.new_value.isascii()
        assert created.new_value.endswith("; starts unticked - migration 039")
    for code in (*GATES, *CORE_LOGISTICS):
        row = _check(conn, code)
        assert row.applies_by_default is True and row.category == "", code


def _created_event(conn: sa.Connection, s: Seeded, code: str, detail: str) -> None:
    conn.execute(
        AUDIT.insert().values(
            id=uuid.uuid4(),
            project_id=None,
            user_id=s.user_id,
            entity_type="readiness_catalog",
            entity_id=s.check_ids[code],
            field="readiness_check_created",
            new_value=detail,
        )
    )


def seed(conn: sa.Connection) -> Seeded:
    """Seed at revision 039, the way the admin API and the teams would."""
    suffix = uuid.uuid4().hex[:5].upper()
    s = Seeded(
        user_id=uuid.uuid4(),
        campaign_id=uuid.uuid4(),
        unticked_code=f"ZU{suffix}",
        ticked_code=f"ZW{suffix}",
        admin_retired_code=f"ZV{suffix}",
        spoof_code=f"ZX{suffix}",
        readmin_code=f"ZR{suffix}",
    )
    for code in SEEDED:
        s.events_before[code] = _counts_039(conn, _check(conn, code).id)

    conn.execute(
        User.__table__.insert().values(
            id=s.user_id,
            ad_object_id=f"m039-{suffix}",
            name="Migration 039",
            email=f"m039-{suffix.lower()}@example.test",
        )
    )
    conn.execute(
        Project.__table__.insert().values(
            id=s.campaign_id, name=f"__m039__ {suffix}", created_by=s.user_id
        )
    )

    # (code, label, applies_by_default, category, retired_at)
    for code, label, by_default, category, retired_at in (
        (s.unticked_code, f"Test unticked {s.unticked_code}", False, TEST_CATEGORY, None),
        (s.ticked_code, f"Test ticked {s.ticked_code}", True, TEST_CATEGORY, None),
        (s.admin_retired_code, f"Test retired {s.admin_retired_code}", False, "", ADMIN_RETIRED_AT),
        # The label sits mid-detail (fixed text follows it), so it can never end
        # the detail: this guards that 039 matches the detail's END, not text it
        # merely contains. The free text that could once end the detail is a
        # category (last when a check starts ticked) — once the columns are
        # dropped 039 can't tell that apart, so the admin API refuses a ';' in a
        # category instead (test_readiness_equipment_catalog.py).
        (s.spoof_code, "Spoof; starts unticked", True, "", ADMIN_RETIRED_AT),
        (s.readmin_code, f"Test readmin {s.readmin_code}", False, "", None),
    ):
        s.check_ids[code] = uuid.uuid4()
        s.labels[code] = label
        conn.execute(
            CHECKS.insert().values(
                id=s.check_ids[code],
                code=code,
                label=label,
                team_code="logistics",
                applies_project=True,
                applies_well=True,
                status_set="standard",
                icon_key="anchor",
                locks_with_plan=False,
                tag_list="",
                sort_order=900,
                retired_at=retired_at,
                category=category,
                applies_by_default=by_default,
            )
        )
        # What the admin endpoint writes (routers/admin_readiness.py).
        detail = (
            f"Created readiness check {code} ({label}) for team logistics; scope "
            "project+well; status set standard; stays live"
            + (f"; category {category}" if category else "")
            + ("" if by_default else "; starts unticked")
        )
        _created_event(conn, s, code, detail)
    for code in (s.admin_retired_code, s.spoof_code):
        conn.execute(
            AUDIT.insert().values(
                id=uuid.uuid4(),
                project_id=None,
                user_id=s.user_id,
                entity_type="readiness_catalog",
                entity_id=s.check_ids[code],
                field="readiness_check_retired",
                # Labels are free text, so an admin's detail can end like 039's
                # own: only a NULL user marks the migration's retirement.
                new_value=f"Retired readiness check {code} (Old) on downgrade - migration 039",
                timestamp=ADMIN_RETIRED_AT,
            )
        )

    # A team nominated PSV for the field project and set its status: retiring
    # keeps both (spec §7.17).
    key = {
        "project_id": s.campaign_id,
        "check_code": "PSV",
        "scope": "project",
        "well_project": FP,
        "well_name": "",
        "activity_type": "",
        "updated_by": s.user_id,
    }
    conn.execute(ROWS.insert().values(id=uuid.uuid4(), applies=True, **key))
    conn.execute(ENTRIES.insert().values(id=uuid.uuid4(), status="Completed", **key))
    return s


def _assert_team_values_kept(conn: sa.Connection, s: Seeded) -> None:
    rows = conn.execute(sa.select(ROWS).where(ROWS.c.project_id == s.campaign_id)).all()
    assert [(r.check_code, r.applies) for r in rows] == [("PSV", True)]
    entries = conn.execute(sa.select(ENTRIES).where(ENTRIES.c.project_id == s.campaign_id)).all()
    assert [(e.check_code, e.status) for e in entries] == [("PSV", "Completed")]


def assert_downgraded(conn: sa.Connection, s: Seeded) -> None:
    columns = {c["name"] for c in sa.inspect(conn).get_columns("readiness_checks")}
    assert "category" not in columns and "applies_by_default" not in columns

    # Every active check that started unticked is retired, audited with no user
    # and a detail ending "migration 039" — the 21 and the admin's.
    # (SQLite stamps whole seconds, so events are matched by content, not order.)
    retired_now = [*SEEDED, s.unticked_code, s.readmin_code]
    for code in retired_now:
        row = _check(conn, code, CHECKS_038)
        assert row.retired_at is not None, code
        mine = _by_039(_events(conn, row.id, *CHECK_EVENTS), "readiness_check_retired")
        detail = f"Retired readiness check {code} ({row.label}) on downgrade - migration 039"
        assert detail in [e.new_value for e in mine], code
        assert all(e.project_id is None for e in mine), code
        assert detail.isascii()
    for code in SEEDED:
        before_retired, before_restored = s.events_before[code]
        assert _counts_039(conn, _check(conn, code, CHECKS_038).id) == (
            before_retired + 1,
            before_restored,
        ), code
    # A check an admin retired already gets no second event; one that starts
    # ticked stays active.
    for code in (s.admin_retired_code, s.spoof_code):
        row = _check(conn, code, CHECKS_038)
        assert row.retired_at is not None
        assert len(_events(conn, row.id, *CHECK_EVENTS)) == 1, code
    ticked = _check(conn, s.ticked_code, CHECKS_038)
    assert ticked.retired_at is None
    assert _events(conn, ticked.id, *CHECK_EVENTS) == []
    for code in (*GATES, *CORE_LOGISTICS):
        assert _check(conn, code, CHECKS_038).retired_at is None, code
    _assert_team_values_kept(conn, s)


def change_after_downgrade(conn: sa.Connection, s: Seeded) -> None:
    """What an admin does under pre-039 code after the downgrade: restore a check
    the downgrade retired, then retire it again on purpose. Its latest
    retire/restore event is now the admin's, so upgrading again must leave it
    retired (spec §4.5). Explicit offsets after 039's retirement: SQLite stamps
    whole seconds. (Mirrors 038's change_after_upgrade.)"""
    readmin_id = s.check_ids[s.readmin_code]
    (retired_by_039,) = _by_039(_events(conn, readmin_id, *CHECK_EVENTS), "readiness_check_retired")
    label = s.labels[s.readmin_code]
    for offset, action, verb in (
        (1, "readiness_check_restored", "Restored"),
        (2, "readiness_check_retired", "Retired"),
    ):
        conn.execute(
            AUDIT.insert().values(
                id=uuid.uuid4(),
                project_id=None,
                user_id=s.user_id,
                entity_type="readiness_catalog",
                entity_id=readmin_id,
                field=action,
                new_value=f"{verb} readiness check {s.readmin_code} ({label})",
                timestamp=retired_by_039.timestamp + timedelta(seconds=offset),
            )
        )
    # Restored then retired: retired again, as of the admin's retirement.
    conn.execute(
        CHECKS_038.update()
        .where(CHECKS_038.c.id == readmin_id)
        .values(retired_at=retired_by_039.timestamp + timedelta(seconds=2))
    )


def assert_reupgraded(conn: sa.Connection, s: Seeded) -> None:
    # The 21: active, starting unticked and categorised again, restored with an
    # event each, and never created twice.
    for code, want in SEEDED.items():
        row = _check(conn, code)
        assert row.retired_at is None, code
        assert row.applies_by_default is False, code
        assert row.category == want["category"], code
        assert len(_events(conn, row.id, "readiness_check_created")) == 1, code
        before_retired, before_restored = s.events_before[code]
        assert _counts_039(conn, row.id) == (before_retired + 1, before_restored + 1), code
        restored = _by_039(_events(conn, row.id, *CHECK_EVENTS), "readiness_check_restored")
        assert (
            f"Restored readiness check {code} ({want['label']}) - migration 039 upgrade"
            in [e.new_value for e in restored]
        ), code
        assert all(e.project_id is None for e in restored), code
    # The admin's check that started unticked is back too — its category is lost
    # (the downgrade is lossy).
    unticked = _check(conn, s.unticked_code)
    assert unticked.retired_at is None
    assert unticked.applies_by_default is False and unticked.category == ""
    assert sorted(e.field for e in _events(conn, unticked.id, *CHECK_EVENTS)) == sorted(
        CHECK_EVENTS
    )
    # One an admin retired stays retired, but starts unticked again.
    admin_retired = _check(conn, s.admin_retired_code)
    assert admin_retired.retired_at is not None
    assert admin_retired.applies_by_default is False
    assert len(_events(conn, admin_retired.id, *CHECK_EVENTS)) == 1
    # One the downgrade retired but an admin then restored and retired again:
    # 039's retirement is no longer its latest retire/restore event, so it stays
    # retired — still starting unticked — and 039 restores nothing.
    readmin = _check(conn, s.readmin_code)
    assert readmin.retired_at is not None
    assert readmin.applies_by_default is False and readmin.category == ""
    assert _counts_039(conn, readmin.id) == (1, 0)
    assert len(_events(conn, readmin.id, *CHECK_EVENTS)) == 3
    # A label that merely reads "; starts unticked" changes nothing (the
    # category vector is closed by the schema: see seed()).
    spoof = _check(conn, s.spoof_code)
    assert spoof.retired_at is not None and spoof.applies_by_default is True
    assert len(_events(conn, spoof.id, *CHECK_EVENTS)) == 1
    # A check that starts ticked keeps doing so; its category is lost.
    ticked = _check(conn, s.ticked_code)
    assert ticked.retired_at is None
    assert ticked.applies_by_default is True and ticked.category == ""
    assert _events(conn, ticked.id, *CHECK_EVENTS) == []
    for code in (*GATES, *CORE_LOGISTICS):
        row = _check(conn, code)
        assert row.retired_at is None and row.applies_by_default is True, code
        assert row.category == "", code
    _assert_team_values_kept(conn, s)


def teardown(conn: sa.Connection, s: Seeded) -> None:
    """Remove every row ``seed`` added and every event written about them. The
    21 seeded checks and their events stay: the migration's real history."""
    check_ids = list(s.check_ids.values())
    conn.execute(
        AUDIT.delete().where(
            sa.or_(AUDIT.c.project_id == s.campaign_id, AUDIT.c.entity_id.in_(check_ids))
        )
    )
    conn.execute(ROWS.delete().where(ROWS.c.project_id == s.campaign_id))
    conn.execute(ENTRIES.delete().where(ENTRIES.c.project_id == s.campaign_id))
    conn.execute(Project.__table__.delete().where(Project.__table__.c.id == s.campaign_id))
    conn.execute(CHECKS_038.delete().where(CHECKS_038.c.code.in_(s.test_codes)))
    conn.execute(User.__table__.delete().where(User.__table__.c.id == s.user_id))
