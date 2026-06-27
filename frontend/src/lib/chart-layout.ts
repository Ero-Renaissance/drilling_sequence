/**
 * Pure layout decisions for the interactive sequence chart, extracted from
 * DrillChart's renderItem so the threshold logic — which readiness-strip tier a
 * bar gets, whether a project tag fits, which gate is "worst" — is unit-tested
 * without a canvas. The drawing stays in renderItem; only the decisions live here.
 */
import { CHECK_CODES, type CheckCode, type CheckStatus } from "@/api/readiness";

/**
 * Reduce the readiness gates to the single most-concerning one, for a bar too
 * small to show the full strip. Severity (high → low): Behind > On Track >
 * Completed > N/A. Returns the worst gate's code + status, or null.
 */
export function worstCheck(
  checks: Record<string, { status: CheckStatus }> | null | undefined,
): { code: CheckCode; status: CheckStatus } | null {
  if (!checks) return null;
  const rank: Record<CheckStatus, number> = {
    Behind: 3,
    "On Track": 2,
    Completed: 1,
    "N/A": 0,
  };
  let winner: { code: CheckCode; status: CheckStatus } | null = null;
  for (const code of CHECK_CODES) {
    const s = checks[code]?.status as CheckStatus | undefined;
    if (!s) continue;
    if (!winner || rank[s] > rank[winner.status]) {
      winner = { code, status: s };
    }
  }
  return winner;
}

/** Which readiness-strip layout a bar of `barWidth` px receives. */
export type IconTier = "full" | "half" | "grid" | "single";

/**
 * Pick the readiness-strip tier by bar width (px). Tuned for the 8-icon set:
 *   ≥135 → "full"  (8 × 14px, one row)
 *   ≥90  → "half"  (8 × 10px, one row)
 *   ≥45  → "grid"  (4 × 2 mini grid)
 *   <45  → "single" (worst-status icon only)
 */
export function iconTier(barWidth: number): IconTier {
  if (barWidth >= 135) return "full";
  if (barWidth >= 90) return "half";
  if (barWidth >= 45) return "grid";
  return "single";
}

/**
 * Whether the project tag fits as a text-hugging chip on a bar of `barWidth` px
 * (rough per-character estimate + chip padding). When false the caller renders a
 * bar-width truncating band instead.
 */
export function tagFits(text: string, barWidth: number): boolean {
  return text.length * 6 + 10 <= barWidth;
}
