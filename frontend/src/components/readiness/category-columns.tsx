import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CatalogCheck } from "@/api/readiness";
import { categoryCell } from "@/lib/chart-layout";
import { codeWithLabel, groupByCategory } from "@/lib/readiness-categories";
import { categoryLine } from "@/lib/team-summary";
import { cn } from "@/lib/utils";
import { STATUS_ICON_COLOR, type ReadinessCell } from "./check-meta";
import { checkIcon } from "./icon-registry";

/**
 * Categories in the readiness grids (phase 7, spec §8.8): a team's core checks
 * are columns of their own, and each category is ONE folded column — its icon,
 * coloured by the worst of its types that apply, blank where none applies — that
 * a click on its header unfolds into one column per type. A folded cell is
 * read-only: it opens nothing (no icon opens a list of options, §3.5).
 */

/** One column group of a grid: a core check, or a category of checks. */
export type GridColumn =
  | { kind: "check"; check: CatalogCheck }
  | {
      kind: "category";
      name: string;
      items: CatalogCheck[];
      open: boolean;
      /** The category's icon — its first active check's by sort order across
       *  the team's FULL definitions (spec §3.9, `categoryIcons`), even where
       *  this grid shows only some of its types. */
      icon_key: string;
    };

/** Each category's icon, decided ONCE from one team's full definitions (catalog
 *  order = sort order, active checks only): its first check's icon (spec §3.9),
 *  as the chart strip, legend and prints draw it (`stripChecksOf`). A grid that
 *  shows only some types — the Field projects grid shows the project-level ones
 *  — still wears it, so a category reads as one icon across the page. */
export function categoryIcons(checks: readonly CatalogCheck[]): Map<string, string> {
  return new Map(groupByCategory(checks).categories.map((g) => [g.name, g.items[0].icon_key]));
}

/** A grid's columns from the definitions it shows (catalog order): the core
 *  checks first, then one group per category, unfolded where `open` says.
 *  `iconOf` is the team's `categoryIcons`; without it (a grid that shows every
 *  definition) a category wears its first item's icon — the same thing. */
export function gridColumns(
  checks: readonly CatalogCheck[],
  open: ReadonlySet<string> | null,
  iconOf?: ReadonlyMap<string, string>,
): GridColumn[] {
  const { core, categories } = groupByCategory(checks);
  return [
    ...core.map((check): GridColumn => ({ kind: "check", check })),
    ...categories.map(
      ({ name, items }): GridColumn => ({
        kind: "category",
        name,
        items,
        open: !!open?.has(name),
        icon_key: iconOf?.get(name) ?? items[0].icon_key,
      }),
    ),
  ];
}

/** How many table columns the groups take. */
export function columnSpan(columns: readonly GridColumn[]): number {
  return columns.reduce((n, c) => n + (c.kind === "category" && c.open ? c.items.length : 1), 0);
}

/** The text a category header's title gives: its name and every type in it,
 *  each with its label ("Vessels: DSV Diving Support Vessel · …"). */
export function categoryTitle(name: string, items: readonly CatalogCheck[]): string {
  return `${name}: ${items.map((c) => `${c.code} ${c.label}`).join(" · ")}`;
}

/** A category's header button: unfolds it into one column per type, or folds
 *  it back. Folded, it's as narrow as a check's column — the category's icon and
 *  type count; its name is in the key's chip, the hover and the button's label.
 *  Unfolded over two or more types, it names the category. */
export function CategoryToggle({
  name,
  items,
  iconKey,
  open,
  onToggle,
}: {
  name: string;
  items: readonly CatalogCheck[];
  /** The category's icon (`GridColumn.icon_key`). */
  iconKey: string;
  open: boolean;
  onToggle: () => void;
}) {
  const Icon = checkIcon(iconKey);
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${open ? "Fold" : "Unfold"} ${name}`}
      title={categoryTitle(name, items)}
      data-icon={iconKey}
      onClick={onToggle}
      className="inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground/80 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {open ? <ChevronLeft className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
      {open && items.length > 1 && <span className="min-w-0 truncate">{name}</span>}
      {!open && <span className="font-normal normal-case text-muted-foreground">{items.length}</span>}
    </button>
  );
}

/** A folded category on one target: its icon in the worst status of its types
 *  that apply, its title naming them worst first ("Vessels (2): PSV Behind ·
 *  DSV On Track"); blank when none applies. Read-only. */
export function CategoryCellIcon({
  name,
  items,
  iconKey,
  cells,
  lookAlikes,
}: {
  name: string;
  items: readonly CatalogCheck[];
  /** The category's icon (`GridColumn.icon_key`). */
  iconKey: string;
  cells: Readonly<Record<string, ReadinessCell>> | undefined;
  /** Codes worded with their label (lookAlikeCodes of the team's checks). */
  lookAlikes: ReadonlySet<string>;
}) {
  const cell = categoryCell(items, cells);
  if (!cell) return <NotSelectedCell />;
  const Icon = checkIcon(iconKey);
  const title = categoryLine(name, cell.types, (t) => codeWithLabel(t, lookAlikes));
  return (
    <span
      className="inline-flex h-7 w-7 items-center justify-center"
      title={title}
      aria-label={title}
      data-category={name}
      data-status={cell.status}
      data-icon={iconKey}
    >
      <Icon className={cn("h-[18px] w-[18px]", STATUS_ICON_COLOR[cell.status])} strokeWidth={2} />
    </span>
  );
}

/** A check that is NOT SELECTED for a target (spec §3.9): nothing at all — no
 *  icon, no "—" — so a well that needs a crane doesn't wade through 20 dashes.
 *  The empty box keeps the row's height. */
export function NotSelectedCell() {
  return <span aria-hidden className="inline-block h-7 w-7" data-not-selected="" />;
}
