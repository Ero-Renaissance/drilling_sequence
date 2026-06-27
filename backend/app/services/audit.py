import uuid

from app.models.audit import AuditLog

# Event-style entity types (distinct from field-level "activity" edits)
ENTITY_REVISION = "revision"
ENTITY_APPROVER = "approver"
ENTITY_REVIEWER = "reviewer"
ENTITY_PROJECT = "project"
ENTITY_CONTRACT = "contract"


def contract_state(status: str, contract_end: object | None) -> str:
    """One-line contract summary (status + end date) for the audit trail."""
    return f"{status} · ends {contract_end}" if contract_end else status


def governance_event(
    *,
    project_id: uuid.UUID,
    user_id: uuid.UUID | None,
    entity_type: str,
    entity_id: uuid.UUID,
    action: str,
    detail: str | None = None,
    old_value: str | None = None,
) -> AuditLog:
    """Build an AuditLog row for a governance event (sign, discard, approver
    add/remove, project create/clone). Unlike activity field edits, the `field`
    column holds an action verb and `new_value` holds a human-readable detail.

    The caller is responsible for adding the returned row to the session.
    """
    return AuditLog(
        project_id=project_id,
        user_id=user_id,
        entity_type=entity_type,
        entity_id=entity_id,
        field=action,
        old_value=old_value,
        new_value=detail,
    )
