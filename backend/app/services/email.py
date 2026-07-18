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

_SUBJECT_PREFIX = "[Renaissance Drilling Sequence]"
_FOOTER = (
    "\n—\n"
    "Renaissance Drilling Sequence · Renaissance Africa Energy Company Limited\n"
    "Confidential. Automated message — please do not reply.\n"
)


def send_email(to: list[str], subject: str, body: str) -> None:
    """Send a plain-text email to one or more recipients. Never raises."""
    recipients = sorted({addr.strip() for addr in to if addr and addr.strip()})
    if not recipients:
        return
    if not settings.email_enabled:
        # Log counts, not addresses — recipient emails are PII (no PII in logs).
        logger.info("Email disabled; skipping %r to %d recipient(s)", subject, len(recipients))
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
        logger.info("Sent %r to %d recipient(s)", subject, len(recipients))
    except Exception:  # noqa: BLE001 — notifications must never break the caller
        logger.exception("Failed to send email %r to %d recipient(s)", subject, len(recipients))


def notify_revision_pending(
    *,
    recipients: list[str],
    project_name: str,
    rev_label: str,
    project_id,
    stage: str = "approval",
) -> None:
    """Notify the designated signers whose action is needed next. `stage` is
    "review" (endorsers — the UI calls their sign-off "endorsement") or "approval"
    (approvers); it only shapes the wording, never the routing."""
    # Land on the campaign OVERVIEW (context first) — a banner there takes an
    # eligible signer straight to the revision. (/approvals was a dead route.)
    link = f"{settings.app_base_url.rstrip('/')}/projects/{project_id}/overview"
    action = "endorsement" if stage == "review" else "approval"
    next_steps = (
        "endorse & sign, or request changes"
        if stage == "review"
        else "approve & sign, request changes, or reject"
    )
    subject = f"{_SUBJECT_PREFIX} {rev_label} awaiting your {action} — {project_name}"
    body = (
        f"A new revision is ready for your {action} on project \"{project_name}\".\n\n"
        f"Revision: {rev_label}\n\n"
        f"Open the campaign — the banner takes you straight to the revision "
        f"({next_steps}):\n{link}\n"
        f"{_FOOTER}"
    )
    send_email(recipients, subject, body)


def notify_revision_comment(
    *,
    recipients: list[str],
    project_name: str,
    rev_label: str,
    author_name: str,
    author_role: str,
    body: str,
    project_id,
    revision_id,
) -> None:
    """Notify the revision's participants (creator + prior commenters, minus
    the author) that the deliberation thread moved — a silent thread is a dead
    letterbox, and a stalled question otherwise escalates into an unnecessary
    request-changes round-trip."""
    link = (
        f"{settings.app_base_url.rstrip('/')}/projects/{project_id}"
        f"/revisions/{revision_id}"
    )
    subject = f"{_SUBJECT_PREFIX} New comment on {rev_label} — {project_name}"
    email_body = (
        f"{author_name} ({author_role}) commented on {rev_label} "
        f"in project \"{project_name}\":\n\n"
        f"{body}\n\n"
        f"Read and reply on the revision:\n{link}\n"
        f"{_FOOTER}"
    )
    send_email(recipients, subject, email_body)


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
    link = f"{settings.app_base_url.rstrip('/')}/projects/{project_id}/overview"
    subject = f"{_SUBJECT_PREFIX} {rev_label} {outcome} — {project_name}"
    body = (
        f"Your revision \"{rev_label}\" on project \"{project_name}\" was {outcome} "
        f"by {decided_by}.\n\n"
        f"Reason:\n{reason}\n\n"
        f"The activities have been unlocked so you can revise and resubmit:\n{link}\n"
        f"{_FOOTER}"
    )
    send_email([recipient], subject, body)
