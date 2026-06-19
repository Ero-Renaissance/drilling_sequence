"""Retire FLOOD/SUBS + Low/Medium/High; clean up data for the FDP/FE + flood-risk model

The readiness check set changed (FDP, LLI, LOC, FE, FID, EIA, BUD + CON; FLOOD and
SUBS removed) and the activity risk classification changed (Low/Medium/High ->
Flood Risk / No Flood Risk). Both `activities.risk` and `readiness_checks.check_code`
are plain string columns validated in application code (Pydantic ``Literal`` + the
readiness router's allow-list), so there is **no schema/enum change** here — this is a
data-only cleanup so no stale value lingers in a migration-managed database:

  - ``activities.risk``: any value outside the new set is nulled (NULL rows are left
    as-is; a planner re-assesses flood risk). ``risk`` stays optional/nullable.
  - ``readiness_checks``: rows for the retired FLOOD/SUBS gates are deleted. Rows for
    the new FDP/FE gates are created on demand by the app, so none are inserted here.

Historical revision snapshots (``revisions.snapshot_json``) are an immutable record of
what was approved and are intentionally left untouched.

Only DML (UPDATE/DELETE) over standard SQL — portable across PostgreSQL / SQL Server /
SQLite with no dialect-specific handling.

Revision ID: 015
Revises: 014
Create Date: 2026-06-19
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "015"
down_revision = "014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop risk values that predate the Flood Risk / No Flood Risk classification.
    # The explicit IS NOT NULL keeps intent clear (NULL NOT IN (...) is NULL, never TRUE,
    # so already-blank rows would be skipped regardless).
    op.execute(
        "UPDATE activities SET risk = NULL "
        "WHERE risk IS NOT NULL AND risk NOT IN ('Flood Risk', 'No Flood Risk')"
    )
    # Remove readiness rows for the two retired gates.
    op.execute("DELETE FROM readiness_checks WHERE check_code IN ('FLOOD', 'SUBS')")


def downgrade() -> None:
    # Data-only cleanup: the retired values cannot be reconstructed, and the column
    # shapes never changed, so the downgrade is a deliberate no-op.
    pass
