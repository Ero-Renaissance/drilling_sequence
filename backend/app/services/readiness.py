"""Resolve an activity's resource contract.

An activity is gated by its rig's contract (or, for an HWU activity, its HWU's).
This resolves that contract so the snapshot can denormalise the contract-expiry
fields and the dashboard can flag contracts at risk. (It formerly also fed the
now-retired CON readiness gate; the contract itself is surfaced via the
contract-expiry marker, not as a readiness check.)
"""
from app.models.activity import Activity
from app.models.hwu_contract import HwuContract
from app.models.resource_registry import normalize_resource_name
from app.models.rig_contract import RigContract

# A rig contract, or — for an HWU activity — an HWU contract. The two are
# duck-typed for this (both expose .contract_start / .contract_end).
ResourceContract = RigContract | HwuContract


def resolve_activity_contract(
    activity: Activity,
    contracts_by_rig: dict[tuple[str, str], RigContract],
    contracts_by_hwu: dict[str, HwuContract],
) -> ResourceContract | None:
    """The contract that gates an activity — its rig's, or (for an HWU activity)
    its HWU's. Rig contracts are per PHYSICAL unit — keyed
    (normalize_resource_name(name), stripped terrain), with a ""-terrain
    (legacy/unassigned) contract accepted as a fallback — while HWUs are mobile
    and match on normalized name alone. Callers must build the dicts with the
    same normalized keys: registry identity is case-insensitive, so an activity
    typed "10k rig 1" still resolves the contract saved as "10K Rig 1". None
    when the activity has neither resource, or no matching contract is on file."""
    if activity.rig_name:
        name_key = normalize_resource_name(activity.rig_name)
        terrain = (activity.location or "").strip()
        return contracts_by_rig.get((name_key, terrain)) or contracts_by_rig.get(
            (name_key, "")
        )
    if activity.hwu_name:
        return contracts_by_hwu.get(normalize_resource_name(activity.hwu_name))
    return None
