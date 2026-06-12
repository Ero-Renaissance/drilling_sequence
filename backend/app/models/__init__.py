"""Aggregate every ORM model so importing this package registers all tables on
``Base.metadata``.

Alembic's ``env.py`` does ``import app.models`` and uses ``Base.metadata`` as the
autogenerate target. If any model is missing here, its table is absent from the
metadata: cross-table foreign keys fail to resolve (e.g. ``activities`` ->
``revisions``) and autogenerate would treat the unregistered tables as droppable.
Keep this list complete whenever a new model module is added.
"""
from app.models.activity import Activity
from app.models.approver import ProjectApprover
from app.models.audit import AuditLog
from app.models.project import (
    Project,
    ProjectMember,
    ProjectRole,
    ProjectStatus,
    ReviewPolicy,
)
from app.models.readiness import ReadinessCheck
from app.models.revision import Revision, Signature
from app.models.rig_contract import RigContract
from app.models.user import User
from app.models.viewer import ProjectViewer

__all__ = [
    "Activity",
    "AuditLog",
    "Project",
    "ProjectApprover",
    "ProjectMember",
    "ProjectRole",
    "ProjectStatus",
    "ReadinessCheck",
    "ReviewPolicy",
    "Revision",
    "RigContract",
    "Signature",
    "User",
    "ProjectViewer",
]
