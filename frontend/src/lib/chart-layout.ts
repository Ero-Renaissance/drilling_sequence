/**
 * Pure layout decisions for the interactive sequence chart, extracted from
 * DrillChart's renderItem so the threshold logic — which readiness-strip tier a
 * bar gets, whether a project tag fits, which gate is "worst" — is unit-tested
 * without a canvas. The drawing stays in renderItem; only the decisions live here.
 */
import type { CatalogCheck, CheckCode, CheckStatus, Severity } from "@/api/readiness";
import { STATUS_SEVERITY, applies, type ReadinessCell } from "@/components/readiness/check-meta";
import { groupByCategory, type Categorised } from "./readiness-categories";

/** A strip's checks, in catalog order — the lens's definitions (or, under the
 *  All lens, one synthetic check per team; under a team lens with categories,
 *  one synthetic check per category — `stripChecksOf`). Whether each locks with
 *  the plan decides how its cells read (`applies()`). */
export type StripCheck = Pick<CatalogCheck, "code" | "locks_with_plan">;

type Cells = Record<string, ReadinessCell> | null | undefined;

// ── Categories on a strip (phase 7, spec §3.9, §8.8) ─────────────────────────

/** What prefixes a category's strip code. A check code matches
 *  `^[A-Z][A-Z0-9-]{1,7}$` and a team code `^[a-z][a-z0-9-]{1,31}$`, so a
 *  category's code never collides with either in a row's cells. */
export const CATEGORY_CODE_PREFIX = "category:";

/** A category's code on a strip, e.g. "category:Vessels". */
export function categoryCode(name: string): string {
  return `${CATEGORY_CODE_PREFIX}${name}`;
}

/** Whether a strip code is a category's synthetic check. */
export function isCategoryCode(code: string): boolean {
  return code.startsWith(CATEGORY_CODE_PREFIX);
}

/** One icon's definition on a strip: a check, or a category's synthetic check
 *  (it has `members`). */
export interface StripDefinition extends CatalogCheck {
  /** A category's synthetic check only: its types' codes, in catalog order. */
  members?: readonly string[];
}

/**
 * The strip a lens draws (spec §8.8 "How it's built"): its checks with no
 * category, as they are, then ONE synthetic check per category — so a seeded
 * Logistics strip has 6 core icons + 6 category icons, not 27. The synthetic
 * check is coded `categoryCode(name)`, labelled with the category, wears its
 * FIRST type's icon (catalog order, spec §3.9) and doesn't lock with the plan
 * (only checks that don't lock with the plan take a category). The Project
 * gates, the All lens's team badges and a definition frozen before categories
 * existed have none, so they come back as given. Pass one team's definitions
 * in catalog order. Idempotent: a synthetic check has no category itself.
 */
export function stripChecksOf(defs: readonly CatalogCheck[]): StripDefinition[] {
  const { core, categories } = groupByCategory(defs);
  return [
    ...core,
    ...categories.map(({ name, items }): StripDefinition => {
      const first = items[0];
      return {
        code: categoryCode(name),
        label: name,
        team_code: first.team_code,
        applies_project: items.some((c) => c.applies_project),
        applies_well: items.some((c) => c.applies_well),
        status_set: first.status_set,
        icon_key: first.icon_key,
        locks_with_plan: false,
        sort_order: first.sort_order,
        members: items.map((c) => c.code),
      };
    }),
  ];
}

/** How many columns a print strip has (spec §8.4, §8.8): the lens's checks with
 *  no category plus its categories — 12 for the seeded Logistics, not 27. Icon
 *  size comes from it, so a lone icon doesn't grow. */
export function stripColumnCount(defs: readonly CatalogCheck[]): number {
  return stripChecksOf(defs).length;
}

/** One type behind a category's icon. */
export interface CategoryType {
  code: CheckCode;
  label: string;
  status: CheckStatus;
}

/** A category's synthetic cell: the worst status of its types that apply. */
export interface CategoryCell extends ReadinessCell {
  applies: true;
  /** Its types that apply here, worst first (ties in catalog order) — what the
   *  tooltip names ("Vessels (2): PSV Behind · DSV On Track") and the panel
   *  counts. Never empty: a category where nothing applies has no cell. */
  types: CategoryType[];
}

const SEVERITY_RANK: Record<Severity, number> = {
  blocked: 3,
  in_progress: 2,
  done: 1,
  not_counted: 0,
};

/** A status's rank by its shared severity (spec §3.7) — never its text. An
 *  unknown status ranks as in progress, as `worstStatus` reads it. */
function severityRank(status: CheckStatus): number {
  return SEVERITY_RANK[STATUS_SEVERITY[status] ?? "in_progress"];
}

/**
 * One category's cell on a target (spec §3.9): the worst of its types that
 * apply — each type read by `applies()` against its own definition, so a type
 * that is not selected, doesn't apply because of a row, recorded N/A in a
 * snapshot, or has no cell here is left out. Undefined when no type applies:
 * the category draws no icon.
 */
export function categoryCell(
  types: readonly (Pick<CatalogCheck, "code" | "label"> & StripCheck)[],
  cells: Cells,
): CategoryCell | undefined {
  const shown = types.flatMap((t): CategoryType[] => {
    const cell = cells?.[t.code];
    return cell && applies(cell, t) ? [{ code: t.code, label: t.label, status: cell.status }] : [];
  });
  if (shown.length === 0) return undefined;
  // Array#sort is stable, so equal severities keep catalog order.
  const worstFirst = [...shown].sort((a, b) => severityRank(b.status) - severityRank(a.status));
  return { status: worstFirst[0].status, applies: true, types: worstFirst };
}

/**
 * A target's cells with each category's synthetic cell added (spec §8.8): the
 * cells as served pass through untouched — the tooltip and the panel still read
 * every type — and `categoryCode(name)` holds the category's `categoryCell`, or
 * nothing when none of its types applies. `defs` are the definitions the view
 * rendered from (a lens's; a revision's frozen catalog). Recomputed from the
 * type cells each time, so applying it twice changes nothing.
 */
export function withCategoryCells<C extends ReadinessCell>(
  defs: readonly (Pick<CatalogCheck, "code" | "label"> & StripCheck & Categorised)[],
  cells: Readonly<Record<string, C>>,
): Record<string, C | CategoryCell> {
  const out: Record<string, C | CategoryCell> = {};
  for (const [code, cell] of Object.entries(cells)) {
    if (!isCategoryCode(code)) out[code] = cell;
  }
  for (const { name, items } of groupByCategory(defs).categories) {
    const cell = categoryCell(items, cells);
    if (cell) out[categoryCode(name)] = cell;
  }
  return out;
}

/**
 * A strip's definitions and cells in one go — what the chart hands
 * `barStripCodes`, `worstCheck` and `siblingMarker` (spec §8.8): one synthetic
 * check per category, whose cell is the worst of its types that apply. So the
 * single-icon tier and the marker on a project's other bars show the category,
 * and a bar where no type of a category applies draws no icon for it.
 */
export function categoryStrip<C extends ReadinessCell>(
  defs: readonly CatalogCheck[],
  cells: Readonly<Record<string, C>> | null | undefined,
): { defs: StripDefinition[]; cells: Record<string, C | CategoryCell> | null } {
  return { defs: stripChecksOf(defs), cells: cells ? withCategoryCells(defs, cells) : null };
}

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
 *   an unticked, not-selected or omitted cell isn't drawn), so a bar where
 *   nothing applies draws no strip. With categories, pass `categoryStrip`'s
 *   definitions and cells: a category is one icon, drawn where a type applies.
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
