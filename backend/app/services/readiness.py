"""Derived readiness gates.

The CON (Contract) readiness gate is **not** stored as a `ReadinessCheck` row —
it's computed from the activity's rig contract. It must be derived consistently
everywhere readiness is read: the Readiness tab, the dashboard, and revision
snapshots. Keeping the rule here (rather than in one router) prevents the surfaces
from drifting apart.
"""
from app.models.activity import Activity
from app.models.rig_contract import RigContract


def derive_con_status(activity: Activity, contract: RigContract | None) -> str:
    """Derive the CON (Contract) readiness status for an activity from its rig
    contract.

    The contract is a workflow item: the planner sets its status (N/A / Not
    Started / In Progress / Completed). Dates only bind once status is
    "Completed", at which point the contract end must cover the activity.

      • activity has no rig_name                         → N/A
      • no contract row on file for that rig             → Not Started
      • contract.status N/A / Not Started / In Progress  → mirrors that status
      • contract.status Completed:
            – contract_end missing                       → In Progress (data gap)
            – end < activity end                         → Behind (won't cover)
            – end ≥ activity end                         → Completed (covers)
    """
    if not activity.rig_name:
        return "N/A"
    if contract is None:
        return "Not Started"

    status = contract.status
    if status in ("N/A", "Not Started", "In Progress"):
        return status

    # status == "Completed" — only now do the dates carry weight.
    if contract.contract_end is None:
        return "In Progress"
    if activity.end_date and contract.contract_end < activity.end_date:
        return "Behind"
    return "Completed"
