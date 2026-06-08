import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ProjectStatus(str, Enum):
    active = "active"
    archived = "archived"


class ProjectRole(str, Enum):
    planner = "planner"
    reviewer = "reviewer"
    approver = "approver"
    viewer = "viewer"


class ReviewPolicy(str, Enum):
    """Whether a revision must pass review before approval.

    - required: every revision goes through the review stage first.
    - optional: the planner chooses per submission (default).
    - off: review is unavailable; revisions go straight to approval.

    Stored as a plain string (allow-list enforced in the Pydantic layer) rather
    than a DB enum, to stay portable across Postgres and MSSQL.
    """

    required = "required"
    optional = "optional"
    off = "off"


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    field: Mapped[str | None] = mapped_column(String(256), nullable=True)
    region: Mapped[str | None] = mapped_column(String(256), nullable=True)
    status: Mapped[ProjectStatus] = mapped_column(
        SAEnum(ProjectStatus, name="projectstatus"), default=ProjectStatus.active
    )
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # Set when this project was created by cloning another (e.g. Q2 cloned from
    # Q1). Lets quarter-to-quarter comparison resolve the prior sequence without
    # the caller having to hunt for it. No ondelete (NOT "SET NULL"): this is a
    # self-referential FK and SQL Server forbids SET NULL/CASCADE on a self-reference
    # (error 1785). Projects are archived, not hard-deleted. See migration 011.
    cloned_from_project_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("projects.id"), nullable=True, index=True
    )
    # Governs whether a revision must pass review before approval.
    # Plain string + Pydantic allow-list (ReviewPolicy) — not a DB enum — for
    # MSSQL/Postgres portability. See docs/review-approval-workflow-spec.md.
    review_policy: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="optional", default="optional"
    )

    members: Mapped[list["ProjectMember"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", lazy="selectin"
    )
    creator: Mapped["User"] = relationship(foreign_keys=[created_by])


class ProjectMember(Base):
    __tablename__ = "project_members"
    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_project_member"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[ProjectRole] = mapped_column(
        SAEnum(ProjectRole, name="projectrole"), nullable=False
    )

    project: Mapped["Project"] = relationship(back_populates="members")
    user: Mapped["User"] = relationship(back_populates="project_memberships")
