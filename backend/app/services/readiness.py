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

    Readiness statuses are On Track / Behind / Completed / N/A. The contract's
    OWN workflow status (N/A / Not Started / In Progress / Completed) is a
    separate enum that we map onto the readiness vocabulary. Dates only bind once
    the contract is workflow-"Completed", at which point its end must cover the
    activity.

      • activity has no rig_name                    → N/A
      • no contract row on file for that rig         → On Track
      • contract.status N/A                          → N/A
      • contract.status Not Started / In Progress    → On Track
      • contract.status Completed:
            – contract_end missing                   → On Track (data gap)
            – end < activity end                     → Behind (won't cover)
            – end ≥ activity end                     → Completed (covers)
    """
    if not activity.rig_name:
        return "N/A"
    if contract is None:
        return "On Track"

    status = contract.status
    if status == "N/A":
        return "N/A"
    if status in ("Not Started", "In Progress"):
        return "On Track"

    # status == "Completed" — only now do the dates carry weight.
    if contract.contract_end is None:
        return "On Track"
    if activity.end_date and contract.contract_end < activity.end_date:
        return "Behind"
    return "Completed"
