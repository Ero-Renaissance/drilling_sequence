"""Outbound email via the company SMTP relay.

Fire-and-forget by design: send_email never raises, so a notification failure
(or an unconfigured/unreachable relay) can never break the request that triggered
it. When smtp_host is empty the whole thing no-ops, which is the default state
until IT provides relay details.
"""
import logging
import smtplib
from email.message import EmailMessage

from app.config import settings

logger = logging.getLogger(__name__)


def send_email(to: list[str], subject: str, body: str) -> None:
    """Send a plain-text email to one or more recipients. Never raises."""
    recipients = sorted({addr.strip() for addr in to if addr and addr.strip()})
    if not recipients:
        return
    if not settings.email_enabled:
        logger.info("Email disabled; skipping %r to %s", subject, recipients)
        return

    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = subject
    msg.set_content(body)

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
            if settings.smtp_use_tls:
                smtp.starttls()
            if settings.smtp_username:
                smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(msg)
        logger.info("Sent %r to %s", subject, recipients)
    except Exception:  # noqa: BLE001 — notifications must never break the caller
        logger.exception("Failed to send email %r to %s", subject, recipients)


def notify_revision_pending(
    *,
    recipients: list[str],
    project_name: str,
    rev_label: str,
    project_id,
) -> None:
    """Notify designated approvers that a revision needs their signature."""
    link = f"{settings.app_base_url.rstrip('/')}/projects/{project_id}/approvals"
    subject = f"[Drilling Sequence] {rev_label} awaiting your approval — {project_name}"
    body = (
        f"A new revision is ready for your review on project \"{project_name}\".\n\n"
        f"Revision: {rev_label}\n\n"
        f"Open the approvals page to sign, request changes, or reject:\n{link}\n"
    )
    send_email(recipients, subject, body)


def notify_revision_decision(
    *,
    recipient: str,
    project_name: str,
    rev_label: str,
    outcome: str,
    reason: str,
    decided_by: str,
    project_id,
) -> None:
    """Notify the planner who created a revision that it was rejected or sent
    back for changes, including the reviewer's reason. `outcome` is a short
    human phrase like "rejected" or "sent back for changes"."""
    link = f"{settings.app_base_url.rstrip('/')}/projects/{project_id}/approvals"
    subject = f"[Drilling Sequence] {rev_label} {outcome} — {project_name}"
    body = (
        f"Your revision \"{rev_label}\" on project \"{project_name}\" was {outcome} "
        f"by {decided_by}.\n\n"
        f"Reason:\n{reason}\n\n"
        f"The activities have been unlocked so you can revise and resubmit:\n{link}\n"
    )
    send_email([recipient], subject, body)
