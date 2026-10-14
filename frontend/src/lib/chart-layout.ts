/**
 * Pure layout decisions for the interactive sequence chart, extracted from
 * DrillChart's renderItem so the threshold logic — which readiness-strip tier a
 * bar gets, whether a project tag fits, which gate is "worst" — is unit-tested
 * without a canvas. The drawing stays in renderItem; only the decisions live here.
 */
import type { CheckCode, CheckStatus } from "@/api/readiness";

/**
 * Reduce the readiness gates to the single most-concerning one, for a bar too
 * small to show the full strip. Severity (high → low): Behind > On Track >
 * Completed > N/A. Returns the worst gate's code + status, or null.
 *
 * `order` is the catalog's gate order (ties go to the earliest gate); it
 * defaults to the order of `checks`' keys.
 */
export function worstCheck(
  checks: Record<string, { status: CheckStatus }> | null | undefined,
  order?: readonly CheckCode[],
): { code: CheckCode; status: CheckStatus } | null {
  if (!checks) return null;
  // By shared severity: blocked > in progress > done > not counted.
  const rank: Record<CheckStatus, number> = {
    Behind: 3,
    "Not available": 3,
    "On Track": 2,
    Completed: 1,
    Available: 1,
    "N/A": 0,
  };
  let winner: { code: CheckCode; status: CheckStatus } | null = null;
  for (const code of order ?? Object.keys(checks)) {
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
 * Pick the readiness-strip tier by bar width (px) and the number of icons in the
 * strip (the lens's check count). The cutoffs scale with `count` and reproduce
 * the tuned 7-gate values exactly (135 / 90 / 45), keeping the same slack:
 *   ≥ 16·count + 23        → "full"  (count × 14px, one row)
 *   ≥ 11·count + 13        → "half"  (count × 10px, one row)
 *   ≥ 10·gridCols(count)+5 → "grid"  (mini grid, two rows)
 *   otherwise              → "single" (worst-status icon only)
 */
export function iconTier(barWidth: number, count = 7): IconTier {
  if (barWidth >= 16 * count + 23) return "full";
  if (barWidth >= 11 * count + 13) return "half";
  if (barWidth >= 10 * gridCols(count) + 5) return "grid";
  return "single";
}

/** Columns of the two-row mini grid ("grid" tier): 7 icons → 4 + 3. */
export function gridCols(count: number): number {
  return Math.max(1, Math.ceil(count / 2));
}

/**
 * Whether the project tag fits as a text-hugging chip on a bar of `barWidth` px
 * (rough per-character estimate + chip padding). When false the caller renders a
 * bar-width truncating band instead.
 */
export function tagFits(text: string, barWidth: number): boolean {
  return text.length * 6 + 10 <= barWidth;
}
