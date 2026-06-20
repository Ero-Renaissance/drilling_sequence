import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ProjectApprover(Base):
    """A designated signer for a project, matched by email.

    Generalised to two stages via `kind`: "approver" (binding approval signers —
    the historical meaning) and "reviewer" (technical-review signers). The two
    form independent required-signature matrices; see
    docs/review-approval-workflow-spec.md.
    """

    __tablename__ = "project_approvers"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    email: Mapped[str] = mapped_column(String(256), nullable=False)
    name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    role_label: Mapped[str] = mapped_column(String(128), nullable=False, default="Approver")
    # "approver" | "reviewer". Plain string (Pydantic allow-list) for portability.
    kind: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="approver", default="approver"
    )

    # An email may appear once per kind per project (so the same person can be both
    # a reviewer and an approver if a project is set up that way).
    __table_args__ = (
        UniqueConstraint(
            "project_id", "email", "kind", name="uq_project_approver_email_kind"
        ),
    )
