"""Resolve an activity's resource contract.

An activity is gated by its rig's contract (or, for an HWU activity, its HWU's).
This resolves that contract so the snapshot can denormalise the contract-expiry
fields and the dashboard can flag contracts at risk. (It formerly also fed the
now-retired CON readiness gate; the contract itself is surfaced via the
contract-expiry marker, not as a readiness check.)
"""
from app.models.activity import Activity
from app.models.hwu_contract import HwuContract
from app.models.rig_contract import RigContract

# A rig contract, or — for an HWU activity — an HWU contract. The two are
# duck-typed for this (both expose .status / .contract_end).
ResourceContract = RigContract | HwuContract


def resolve_activity_contract(
    activity: Activity,
    contracts_by_rig: dict[str, RigContract],
    contracts_by_hwu: dict[str, HwuContract],
) -> ResourceContract | None:
    """The contract that gates an activity — its rig's, or (for an HWU activity)
    its HWU's. None when the activity has neither resource, or no matching contract
    is on file."""
    if activity.rig_name:
        return contracts_by_rig.get(activity.rig_name)
    if activity.hwu_name:
        return contracts_by_hwu.get(activity.hwu_name)
    return None
