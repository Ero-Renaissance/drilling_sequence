"""Derived readiness gates.

The CON (Contract) readiness gate is **not** stored as a `ReadinessCheck` row —
it's computed from the activity's rig contract. It must be derived consistently
everywhere readiness is read: the Readiness tab, the dashboard, and revision
snapshots. Keeping the rule here (rather than in one router) prevents the surfaces
from drifting apart.
"""
from app.models.activity import Activity
from app.models.hwu_contract import HwuContract
from app.models.rig_contract import RigContract

# An activity's CON gate derives from its rig contract or — for an HWU activity —
# its HWU contract. The two models are duck-typed for this (both expose .status
# and .contract_end), so the derivation treats them interchangeably.
ResourceContract = RigContract | HwuContract


def derive_con_status(activity: Activity, contract: ResourceContract | None) -> str:
    """Derive the CON (Contract) readiness status for an activity from its
    resource contract — a rig contract, or an HWU contract for an HWU activity.

    Readiness statuses are On Track / Behind / Completed / N/A. The contract's
    OWN workflow status (N/A / Not Started / In Progress / Completed) is a
    separate enum that we map onto the readiness vocabulary. Dates only bind once
    the contract is workflow-"Completed", at which point its end must cover the
    activity.

      • activity has no rig and no HWU              → N/A
      • no contract on file for that resource        → On Track
      • contract.status N/A                          → N/A
      • contract.status Not Started / In Progress    → On Track
      • contract.status Completed:
            – contract_end missing                   → On Track (data gap)
            – end < activity end                     → Behind (won't cover)
            – end ≥ activity end                     → Completed (covers)
    """
    if not (activity.rig_name or activity.hwu_name):
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


def resolve_con_contract(
    activity: Activity,
    contracts_by_rig: dict[str, RigContract],
    contracts_by_hwu: dict[str, HwuContract],
) -> ResourceContract | None:
    """The contract that gates an activity's CON readiness — its rig's contract,
    or (for an HWU activity) its HWU's. None when the activity has neither
    resource or no matching contract is on file."""
    if activity.rig_name:
        return contracts_by_rig.get(activity.rig_name)
    if activity.hwu_name:
        return contracts_by_hwu.get(activity.hwu_name)
    return None
