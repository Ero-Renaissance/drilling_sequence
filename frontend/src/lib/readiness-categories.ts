/**
 * Check categories (phase 7, docs/readiness-framework-spec.md §3.9, §8.8): an
 * optional, admin-edited group a check belongs to within its team — the 21
 * equipment checks sit in Aviation, Vessels, Barges, Land transport, Lifting and
 * Permits; the core checks have none. Categories group the tick list, the grids,
 * the panel and the legend; on the chart and prints a category draws ONE icon
 * (lib/chart-layout.ts `stripChecksOf` / `withCategoryCells`).
 *
 * - Checks group by their EXACT text (the server trims it) within one team, so
 *   callers pass one team's definitions — a lens — in catalog order.
 * - A check that locks with the plan never groups: the Project gates take no
 *   category and keep their seven icons, grid and prints (decision 31), whatever
 *   a definition says.
 * - A definition without the field (frozen before migration 039) has none, so
 *   it draws on its own, as before.
 */
import type { CatalogCheck } from "@/api/readiness";

/** The part of a definition that decides its category. */
export type Categorised = Pick<CatalogCheck, "locks_with_plan" | "category">;

/** A check's category — "" for none (a core check, a Project gate, or a
 *  definition frozen before categories existed). */
export function categoryOf(check: Categorised): string {
  return check.locks_with_plan ? "" : (check.category ?? "");
}

export interface CategoryGroup<T> {
  name: string;
  /** Its items, in the order given (catalog order). */
  items: T[];
}

export interface CategoryGroups<T> {
  /** The items with no category, in the order given — shown first. */
  core: T[];
  /** One group per category, ordered by its first item; empty groups never
   *  appear. */
  categories: CategoryGroup<T>[];
}

/**
 * Split items into the core ones and one group per category: the core first,
 * then the categories in the order their first item appears (spec §8.8 — "the
 * team's core checks first, then one … group per category"). `categoryOfItem`
 * reads an item's category (`categoryOf` on its definition).
 */
export function groupItemsByCategory<T>(
  items: readonly T[],
  categoryOfItem: (item: T) => string,
): CategoryGroups<T> {
  const core: T[] = [];
  const byName = new Map<string, T[]>();
  for (const item of items) {
    const name = categoryOfItem(item);
    if (!name) {
      core.push(item);
      continue;
    }
    const group = byName.get(name);
    if (group) group.push(item);
    else byName.set(name, [item]);
  }
  // A Map keeps insertion order: each category sits where its first item was met.
  return { core, categories: [...byName].map(([name, grouped]) => ({ name, items: grouped })) };
}

/** `groupItemsByCategory` for definitions themselves. */
export function groupByCategory<T extends Categorised>(checks: readonly T[]): CategoryGroups<T> {
  return groupItemsByCategory(checks, categoryOf);
}

/** The categories among one team's definitions, in display order — what a
 *  grid's folded columns, a legend and an Admin form's suggestions list. */
export function categoriesOf(checks: readonly Categorised[]): string[] {
  return groupByCategory(checks).categories.map((g) => g.name);
}

// ── Look-alike codes (spec §3.4) ────────────────────────────────────────────

/**
 * Whether two check codes are easy to mistake for each other — `CR`/`CTR`,
 * `PC`/`PO`, `CB`/`CBG` (spec §3.4): one edit apart (a letter added, dropped or
 * changed) and starting with the same letter, or one is the other with a letter
 * put in front (`CB`/`ACB`). Codes that differ in their first letter only
 * (`PSV`/`DSV`) read apart, so the spec's "Vessels (2): PSV Behind · DSV On
 * Track" names neither. Display only: it decides where a code is worded with
 * its label, never what a check is.
 */
export function codesLookAlike(a: string, b: string): boolean {
  if (a === b || !a || !b) return false;
  if (!oneEditApart(a, b)) return false;
  return a[0] === b[0] || a.endsWith(b) || b.endsWith(a);
}

function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    return diff === 1;
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  for (let i = 0; i < long.length; i++) {
    if (long.slice(0, i) + long.slice(i + 1) === short) return true;
  }
  return false;
}

/** The codes among `codes` (one lens's checks) that look like another of them —
 *  worded with their label wherever a line lists codes on their own. */
export function lookAlikeCodes(codes: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < codes.length; i++) {
    for (let j = i + 1; j < codes.length; j++) {
      if (codesLookAlike(codes[i], codes[j])) {
        out.add(codes[i]);
        out.add(codes[j]);
      }
    }
  }
  return out;
}

/** A code as a line that lists codes words it: with its label after it when it
 *  looks like another code of the lens ("PC (Personnel Carrier)"), else bare. */
export function codeWithLabel(
  check: { code: string; label: string },
  lookAlikes: ReadonlySet<string>,
): string {
  return lookAlikes.has(check.code) ? `${check.code} (${check.label})` : check.code;
}
