"""Resource registry + terrain-qualified rig contracts (docs/rig-registry-spec.md)

Creates `resource_registry` — one row per PHYSICAL unit per campaign. Rig
identity is (terrain, name); HWU identity is (name) with terrain "" (mobile —
spec decision Q1). Adds `terrain` to rig_contracts and widens its uniqueness to
(project, rig_name, terrain). "" (never NULL) is the "not terrain-bound /
unassigned" sentinel because NULLs are mutually distinct in UNIQUE constraints.

Backfill (runs on existing data, in Python for cross-backend portability):

* Registry rows from activities: one per distinct (project, kind, terrain,
  normalized name). Display casing = first casing seen. A RIG name appearing in
  more than one terrain within a project is the signature of class-style slot
  reuse ("10K Rig 1" on LAND and SWAMP = two planned units), so those rows are
  backfilled `is_placeholder=true`; single-terrain rigs and all HWUs start as
  real units (`false`) — the planner can flip either from the registry UI.
* rig_contracts.terrain: inherited from activities when the rig name maps to
  exactly one terrain in the project. A contract whose name spans terrains is
  unattributable — it cannot say WHICH physical rig it covers — and is DELETED
  (spec decision Q3: on the live campaign these carried placeholder dates, not
  contract data). A contract whose rig has no activities keeps terrain "".

Revision ID: 023
Revises: 022
Create Date: 2026-07-10
"""

import uuid

import sqlalchemy as sa

from alembic import op

revision = "023"
down_revision = "022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "resource_registry",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("terrain", sa.String(16), nullable=False, server_default=""),
        sa.Column("name", sa.String(256), nullable=False),
        sa.Column("name_key", sa.String(256), nullable=False),
        sa.Column("capability_class", sa.String(64), nullable=True),
        sa.Column("is_placeholder", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "project_id", "kind", "terrain", "name_key", name="uq_resource_identity"
        ),
    )
    op.create_index("ix_resource_registry_project_id", "resource_registry", ["project_id"])

    # rig_contracts: add terrain and widen the uniqueness to include it. Batch
    # mode so this ALSO runs on the SQLite dev database (a table rebuild there;
    # a plain ALTER passthrough on PostgreSQL / SQL Server).
    with op.batch_alter_table("rig_contracts") as batch:
        batch.add_column(
            sa.Column("terrain", sa.String(16), nullable=False, server_default="")
        )
        batch.drop_constraint("uq_rig_contract_project_rig", type_="unique")
        batch.create_unique_constraint(
            "uq_rig_contract_project_rig", ["project_id", "rig_name", "terrain"]
        )

    bind = op.get_bind()
    # The model-parity test replays upgrades against a schema recorder whose
    # fake bind can't execute queries — skip the data backfill there only.
    if hasattr(bind, "execute"):
        _backfill(bind)


def _backfill(bind: sa.engine.Connection) -> None:
    activities = sa.table(
        "activities",
        sa.column("project_id", sa.Uuid()),
        sa.column("rig_name", sa.String()),
        sa.column("hwu_name", sa.String()),
        sa.column("location", sa.String()),
    )
    registry = sa.table(
        "resource_registry",
        sa.column("id", sa.Uuid()),
        sa.column("project_id", sa.Uuid()),
        sa.column("kind", sa.String()),
        sa.column("terrain", sa.String()),
        sa.column("name", sa.String()),
        sa.column("name_key", sa.String()),
        sa.column("is_placeholder", sa.Boolean()),
    )
    contracts = sa.table(
        "rig_contracts",
        sa.column("id", sa.Uuid()),
        sa.column("project_id", sa.Uuid()),
        sa.column("rig_name", sa.String()),
        sa.column("terrain", sa.String()),
    )

    rows = bind.execute(
        sa.select(
            activities.c.project_id,
            activities.c.rig_name,
            activities.c.hwu_name,
            activities.c.location,
        )
    ).all()

    # (project, kind, terrain, name_key) -> display name (first casing seen);
    # rig_terrains tracks which terrains each rig NAME occupies per project.
    units: dict[tuple, str] = {}
    rig_terrains: dict[tuple, set] = {}
    for project_id, rig_name, hwu_name, location in rows:
        if rig_name and rig_name.strip():
            name = rig_name.strip()
            terrain = (location or "").strip()
            key = (project_id, "rig", terrain, name.lower())
            units.setdefault(key, name)
            rig_terrains.setdefault((project_id, name.lower()), set()).add(terrain)
        if hwu_name and hwu_name.strip():
            name = hwu_name.strip()
            key = (project_id, "hwu", "", name.lower())
            units.setdefault(key, name)

    for (project_id, kind, terrain, name_key), display in sorted(
        units.items(), key=lambda kv: tuple(str(p) for p in kv[0])
    ):
        multi_terrain = kind == "rig" and len(
            rig_terrains.get((project_id, name_key), set())
        ) > 1
        bind.execute(
            registry.insert().values(
                id=uuid.uuid4(),
                project_id=project_id,
                kind=kind,
                terrain=terrain,
                name=display,
                name_key=name_key,
                is_placeholder=multi_terrain,
            )
        )

    # Contract terrain: unambiguous names inherit; cross-terrain names are
    # unattributable — delete (spec Q3); no-activity rigs keep "".
    for contract_id, project_id, rig_name in bind.execute(
        sa.select(contracts.c.id, contracts.c.project_id, contracts.c.rig_name)
    ).all():
        terrains = rig_terrains.get((project_id, (rig_name or "").strip().lower()), set())
        if len(terrains) == 1:
            bind.execute(
                contracts.update()
                .where(contracts.c.id == contract_id)
                .values(terrain=next(iter(terrains)))
            )
        elif len(terrains) > 1:
            bind.execute(contracts.delete().where(contracts.c.id == contract_id))


def downgrade() -> None:
    with op.batch_alter_table("rig_contracts") as batch:
        batch.drop_constraint("uq_rig_contract_project_rig", type_="unique")
        batch.create_unique_constraint(
            "uq_rig_contract_project_rig", ["project_id", "rig_name"]
        )
        batch.drop_column("terrain")
    op.drop_index("ix_resource_registry_project_id", table_name="resource_registry")
    op.drop_table("resource_registry")
