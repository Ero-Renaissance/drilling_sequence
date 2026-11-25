"""Equipment quantity (docs/equipment-quantity-spec.md §3).

- ``readiness_checks`` gains ``takes_quantity`` (Boolean, NOT NULL, default
  false): a target may state HOW MANY of this type it needs. Admin-editable; it
  affects no readiness figure. Always false on a check that locks with the plan.
- ``readiness_quantities``: the number itself, per campaign + check + target,
  keyed by NAMES exactly like ``readiness_entries`` and
  ``readiness_applicability`` (the six columns of their unique keys, "" as the
  not-applicable sentinel), so it survives a CSV replace and follows a rename
  with them. A whole number 1-999 (``ck_readiness_quantity_range``). Its own
  table, not a column on ``readiness_applicability``: an applicability row is
  deleted when a choice equals the check's default, and the number must survive
  deselecting.
- The Logistics checks in the five equipment categories that are counted —
  Aviation, Vessels, Barges, Land transport, Lifting — take a quantity (retired
  ones included, so a restored type reads like its category). Permits don't: a
  permit is held or not. One ``readiness_check_updated`` catalog event per check
  changed (no user, detail ending "migration 041"), written BEFORE the update so
  the same test picks out the same checks. No quantity is stated for anything:
  every number starts blank.

Bind-free, like 038-040: every data step is ``op.execute`` of a SQLAlchemy Core
statement (tests/test_migration_model_parity.py replays upgrade() against a fake
bind). Booleans are ``sa.true()`` / ``sa.false()``; audit ids are generated in
SQL (``newid()`` on SQL Server, ``gen_random_uuid()`` elsewhere). Literals are
written out here, never imported from app code. Details are ASCII.

Downgrade is lossy: the table is dropped, so every stated quantity is lost; each
check that took one gets a ``readiness_check_updated`` event saying so before
the column goes. Upgrading again flags the same categories; the numbers don't
come back.

The SQLite suite never runs migrations; tests/test_migration_041_sqlite.py
replays this one on SQLite and renders every statement for SQL Server and
PostgreSQL.

Revision ID: 041
Revises: 040
Create Date: 2026-11-25
"""

import sqlalchemy as sa

from alembic import op

revision = "041"
down_revision = "040"
branch_labels = None
depends_on = None

LOGISTICS_TEAM = "logistics"
# The equipment categories of migration 039 whose types are counted.
QUANTITY_CATEGORIES = ("Aviation", "Vessels", "Barges", "Land transport", "Lifting")
MIN_QUANTITY = 1
MAX_QUANTITY = 999

ENTITY_READINESS_CATALOG = "readiness_catalog"
CHECK_UPDATED = "readiness_check_updated"
MARK = "migration 041"
# The admin endpoint's wording for the change, then this migration's mark.
TAKES = f": takes a quantity - {MARK}"
NO_LONGER_TAKES = f": no longer takes a quantity on downgrade - {MARK}"

TABLE = "readiness_quantities"
INDEX = "ix_readiness_quantities_project_id"
_KEY = ("project_id", "check_code", "scope", "well_project", "well_name", "activity_type")


def _checks() -> sa.TableClause:
    return sa.table(
        "readiness_checks",
        sa.column("id", sa.Uuid()),
        sa.column("code", sa.String(16)),
        sa.column("team_code", sa.String(32)),
        sa.column("locks_with_plan", sa.Boolean()),
        sa.column("category", sa.String(64)),
        sa.column("takes_quantity", sa.Boolean()),
    )


def _audit() -> sa.TableClause:
    return sa.table(
        "audit_logs",
        sa.column("id", sa.Uuid()),
        sa.column("entity_type", sa.String(64)),
        sa.column("entity_id", sa.Uuid()),
        sa.column("field", sa.String(128)),
        sa.column("new_value", sa.Text()),
    )


_AUDIT_COLUMNS = ["id", "entity_type", "entity_id", "field", "new_value"]


def _new_id() -> sa.FunctionElement:
    """A UUID generated in SQL. The parity test's fake bind reports sqlite, so it
    takes the else branch."""
    if op.get_bind().dialect.name == "mssql":
        return sa.func.newid()
    return sa.func.gen_random_uuid()


def _updated_event(
    audit: sa.TableClause, checks: sa.TableClause, suffix: str, where: sa.ColumnElement[bool]
) -> sa.Insert:
    """One ``readiness_check_updated`` event per check ``where`` picks out:
    "Updated readiness check CODE<suffix>"."""
    return audit.insert().from_select(
        _AUDIT_COLUMNS,
        sa.select(
            _new_id(),
            sa.literal(ENTITY_READINESS_CATALOG),
            checks.c.id,
            sa.literal(CHECK_UPDATED),
            sa.literal("Updated readiness check ") + checks.c.code + sa.literal(suffix),
        ).where(where),
    )


def upgrade() -> None:
    # 1. The flag. The server default fills every existing check: no quantity.
    op.add_column(
        "readiness_checks",
        sa.Column("takes_quantity", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    # 2. The numbers. The key is uq_readiness_entry's six columns, which already
    #    fit SQL Server's 1700-byte index key limit.
    op.create_table(
        TABLE,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("check_code", sa.String(16), nullable=False),
        sa.Column("scope", sa.String(8), nullable=False),
        sa.Column("well_project", sa.String(256), nullable=False),
        sa.Column("well_name", sa.String(256), nullable=False),
        sa.Column("activity_type", sa.String(256), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["check_code"], ["readiness_checks.code"]),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(*_KEY, name="uq_readiness_quantity"),
        sa.CheckConstraint(
            f"quantity >= {MIN_QUANTITY} AND quantity <= {MAX_QUANTITY}",
            name="ck_readiness_quantity_range",
        ),
    )
    op.create_index(INDEX, TABLE, ["project_id"])

    # 3. The counted equipment categories take a quantity — audited first, then
    #    set, so the same test picks out the same checks. A check that locks
    #    with the plan never takes one.
    checks = _checks()
    counted = sa.and_(
        checks.c.team_code == LOGISTICS_TEAM,
        checks.c.category.in_(QUANTITY_CATEGORIES),
        checks.c.locks_with_plan == sa.false(),
        checks.c.takes_quantity == sa.false(),
    )
    op.execute(_updated_event(_audit(), checks, TAKES, counted))
    op.execute(checks.update().where(counted).values(takes_quantity=sa.true()))


def _drop_column(table: str, column: str) -> None:
    """Portable DROP COLUMN (MSSQL requires dropping the DEFAULT constraint first —
    see migration 008 for the full rationale). Identifiers are fixed constants.
    Copied from migration 022: migrations never import each other."""
    if op.get_bind().dialect.name == "mssql":
        op.execute(
            f"DECLARE @c sysname; "
            f"SELECT @c = dc.name FROM sys.default_constraints dc "
            f"JOIN sys.columns col ON col.object_id = dc.parent_object_id "
            f"AND col.column_id = dc.parent_column_id "
            f"WHERE dc.parent_object_id = OBJECT_ID(N'{table}') AND col.name = N'{column}'; "
            f"IF @c IS NOT NULL EXEC('ALTER TABLE [{table}] DROP CONSTRAINT [' + @c + ']');"
        )
    op.drop_column(table, column)


def downgrade() -> None:
    # 1. Say which checks stop taking a quantity, before the column goes.
    checks = _checks()
    op.execute(
        _updated_event(_audit(), checks, NO_LONGER_TAKES, checks.c.takes_quantity == sa.true())
    )

    # 2. The numbers (lost), then the flag (SQL Server: its default first).
    op.drop_index(INDEX, table_name=TABLE)
    op.drop_table(TABLE)
    _drop_column("readiness_checks", "takes_quantity")
