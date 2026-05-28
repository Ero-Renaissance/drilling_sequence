import uuid

from sqlalchemy import String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import ForeignKey

from app.database import Base


class ProjectApprover(Base):
    __tablename__ = "project_approvers"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    email: Mapped[str] = mapped_column(String(256), nullable=False)
    name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    role_label: Mapped[str] = mapped_column(String(128), nullable=False, default="Approver")

    __table_args__ = (
        UniqueConstraint("project_id", "email", name="uq_project_approver_email"),
    )
