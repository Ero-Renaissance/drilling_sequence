/**
 * Pure layout decisions for the interactive sequence chart, extracted from
 * DrillChart's renderItem so the threshold logic — which readiness-strip tier a
 * bar gets, whether a project tag fits, which gate is "worst" — is unit-tested
 * without a canvas. The drawing stays in renderItem; only the decisions live here.
 */
import type { CatalogCheck, CheckCode, CheckStatus } from "@/api/readiness";
import { STATUS_SEVERITY, applies, type ReadinessCell } from "@/components/readiness/check-meta";

/** A strip's checks, in catalog order — the lens's definitions (or, under the
 *  All lens, one synthetic check per team). Whether each locks with the plan
 *  decides how its cells read (`applies()`). */
export type StripCheck = Pick<CatalogCheck, "code" | "locks_with_plan">;

type Cells = Record<string, ReadinessCell> | null | undefined;

/**
 * Reduce a bar's readiness to the single most-concerning check, for a bar too
 * small to show the full strip. Severity (high → low): Behind > On Track >
 * Completed > N/A. Cells that don't apply (spec §5.1) are dropped first, so a
 * bar where nothing applies gives null — no icon — while all-N/A Project gates
 * still give N/A (the grey icon). Ties go to the earliest check of `checks`
 * (catalog order). Returns the worst check's code + status, or null.
 */
export function worstCheck(
  checks: Cells,
  defs: readonly StripCheck[],
): { code: CheckCode; status: CheckStatus } | null {
  if (!checks) return null;
  // By shared severity: blocked > in progress > done > not counted.
  const rank: Record<CheckStatus, number> = {
    Behind: 3,
    "Not available": 3,
    "On Track": 2,
    Pending: 2,
    Completed: 1,
    Available: 1,
    "N/A": 0,
  };
  let winner: { code: CheckCode; status: CheckStatus } | null = null;
  for (const def of defs) {
    const cell = checks[def.code];
    if (!cell || !applies(cell, def)) continue;
    const s = cell.status;
    if (!winner || rank[s] > rank[winner.status]) {
      winner = { code: def.code, status: s };
    }
  }
  return winner;
}

/**
 * The marker a project's OTHER pending bars carry (its earliest bar has the full
 * strip): its worst check that applies, shown only while that check is BLOCKED —
 * Behind, or Not available in a revision's history (spec §3.7: severity, never
 * status text). Silence means nothing is behind. Null when there is nothing to
 * flag.
 */
export function siblingMarker(
  checks: Cells,
  defs: readonly StripCheck[],
): { code: CheckCode; status: CheckStatus } | null {
  const worst = worstCheck(checks, defs);
  return worst && STATUS_SEVERITY[worst.status] === "blocked" ? worst : null;
}

/**
 * The icons one bar's strip draws, in strip order — packed left, since the
 * caller places them by index; an icon is told by its shape, not its position
 * (spec §8.3).
 * - Project gates: every gate, N/A ones grey; an unset gate shows its default.
 * - A team lens: only the checks that apply to the bar's target (`applies()` —
 *   an unticked or omitted cell isn't drawn), so a bar where nothing applies
 *   draws no strip.
 * - All: one badge per team that has readiness here and is drawn — no badge for
 *   a team where nothing applies (a grey Project gates badge stays).
 */
export function barStripCodes(
  defs: readonly StripCheck[],
  checks: Record<string, ReadinessCell>,
  allLens: boolean,
): CheckCode[] {
  return defs
    .filter((d) => (!allLens || checks[d.code] !== undefined) && applies(checks[d.code], d))
    .map((d) => d.code);
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
