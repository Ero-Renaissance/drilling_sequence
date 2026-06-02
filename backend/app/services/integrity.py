"""Document integrity fingerprint for the JV-partner print/PDF export.

A revision's approved content is a *system of record* — the frozen snapshot plus
the set of cast signatures. The printed PDF is only a rendering of that record, so
on its own it proves nothing. This module derives a deterministic SHA-256 digest
("Document ID") over the canonical content, printed on the export.

Trust model (Phase 0 — no new dependencies, no workflow change):
  • Any change to the sequence, dates, or the approval set changes the digest.
  • A recipient confirms the printed Document ID against the value the system
    shows for that revision (recomputed here from the immutable record).
  • This complements — does not replace — a certificate signature applied in
    Adobe: the certificate proves the *file* was untampered for savvy partners /
    online use; the Document ID is the human-checkable fallback that survives
    printing and needs no special software.

The digest is intentionally derived only from immutable, server-held facts
(snapshot JSON, rev number, project id, and each signature's stage/email/time) so
it is reproducible — never from rendering details or client input.
"""
import hashlib
from collections.abc import Iterable

from app.models.revision import Signature

# Bump if the canonical serialisation ever changes, so an old printed digest is
# never silently compared against a new scheme.
_SCHEME = "v1"


def _signature_lines(signatures: Iterable[Signature]) -> list[str]:
    """One stable line per signature: ``stage|email|signed_at``.

    Email (lowercased) is the signer's durable identity; signed_at pins when.
    Sorted so the digest is independent of row/insert order.
    """
    lines: list[str] = []
    for sig in signatures:
        email = sig.user.email.lower() if sig.user and sig.user.email else ""
        signed_at = sig.signed_at.isoformat() if sig.signed_at else ""
        lines.append(f"{sig.stage}|{email}|{signed_at}")
    return sorted(lines)


def revision_integrity_digest(
    rev_number: int,
    project_id: object,
    snapshot_json: str,
    signatures: Iterable[Signature],
) -> str:
    """Return the full 64-char hex SHA-256 fingerprint of a revision's content."""
    payload = "\n".join(
        [
            f"scheme:{_SCHEME}",
            f"rev:{rev_number}",
            f"project:{project_id}",
            "snapshot:",
            snapshot_json,
            "signatures:",
            *_signature_lines(signatures),
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
