"""Retire the contract workflow status — a contract IS its end date.

The Draft/Completed two-state workflow is removed: it duplicated "no binding
contract" as a status value, which left zombie rows that displayed as "Draft"
instead of "No contract" and blocked the fleet view's no-contract signal.
Post-024 a contract exists iff an end date is on file (the upsert schema now
requires `contract_end`; tentative terms belong in `notes`).

Data migration (before the column drop):

* Rows with NO end date are DELETED from rig_contracts and hwu_contracts —
  they carry no decision-driving information (their dates never drove the
  expiry marker, the dashboard, or the approval snapshot). Any notes on such
  rows are folded into the audit-visible reality by being dropped with them;
  the live campaign's date-less rows are known data-entry residue.
* Rows WITH an end date survive unchanged: "Completed" ones were already
  binding, and "Draft" ones with a real date now become binding — a tentative
  date should inform planning rather than sit silently non-binding.

Older stored revision snapshots keep their `rig_contract_status` key; readers
stay faithful to it (a historical Draft's dates remain non-binding there).

Revision ID: 024
Revises: 023
Create Date: 2026-07-10
"""

import sqlalchemy as sa

from alembic import op

revision = "024"
down_revision = "023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    # The model-parity test replays upgrades against a schema recorder whose
    # fake bind can't execute queries — skip the data purge there only.
    if hasattr(bind, "execute"):
        bind.execute(sa.text("DELETE FROM rig_contracts WHERE contract_end IS NULL"))
        bind.execute(sa.text("DELETE FROM hwu_contracts WHERE contract_end IS NULL"))

    # Batch mode so this ALSO runs on the SQLite dev database (a table rebuild
    # there; a plain ALTER passthrough on PostgreSQL / SQL Server).
    # mssql_drop_default: SQL Server materializes the column's server_default
    # ("Draft") as a separate auto-named DEFAULT constraint (DF__...), and
    # refuses DROP COLUMN while it exists (error 5074). The flag makes Alembic
    # look the constraint up in sys.default_constraints and drop it first; the
    # other backends ignore it.
    with op.batch_alter_table("rig_contracts") as batch:
        batch.drop_column("status", mssql_drop_default=True)
    with op.batch_alter_table("hwu_contracts") as batch:
        batch.drop_column("status", mssql_drop_default=True)


def downgrade() -> None:
    # Every surviving row has an end date, so "Completed" (dates binding) is the
    # faithful restoration — defaulting to "Draft" would silently un-bind every
    # contract's expiry alarm.
    with op.batch_alter_table("rig_contracts") as batch:
        batch.add_column(
            sa.Column("status", sa.String(32), nullable=False, server_default="Completed")
        )
    with op.batch_alter_table("hwu_contracts") as batch:
        batch.add_column(
            sa.Column("status", sa.String(32), nullable=False, server_default="Completed")
        )
