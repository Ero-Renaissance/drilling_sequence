/**
 * Document-control reference + integrity "Document ID" helpers, shared by the
 * print/PDF export and the on-screen authenticity panel so both render and
 * compare the identifier identically.
 */

/** Controlled-document reference, e.g. "Renaissance/DS/Q3-RIG-SEQUENCE/REV05". */
export function buildDocRef(
  projectName: string | null | undefined,
  revNumber: number,
): string {
  const slug = (projectName ?? "SEQUENCE")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `Renaissance/DS/${slug}/REV${String(revNumber).padStart(2, "0")}`;
}

/**
 * The printed "Document ID" — the first 24 hex of the content digest, upper-cased
 * and grouped in fours so it's quotable over the phone. The full 64-char hash lives
 * in the system of record; matching this prefix is enough to confirm authenticity.
 */
export function formatDocId(digest: string): string {
  return digest
    .slice(0, 24)
    .toUpperCase()
    .replace(/(.{4})/g, "$1 ")
    .trim();
}

/** Hex-only, upper-cased form of whatever a verifier pasted (tolerates spaces/case). */
export function normalizeDocId(input: string): string {
  return input.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
}

/**
 * True when a pasted Document ID matches this revision's digest. Accepts any
 * prefix of at least 8 hex chars so a partial read still resolves, and so the
 * printed 24-char ID matches the stored 64-char digest.
 */
export function docIdMatches(fullDigest: string, input: string): boolean {
  const norm = normalizeDocId(input);
  return norm.length >= 8 && fullDigest.toUpperCase().startsWith(norm);
}
