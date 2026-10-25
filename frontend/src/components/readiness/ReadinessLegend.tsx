import type { CatalogCheck, CheckStatus } from "@/api/readiness";
import { groupByCategory } from "@/lib/readiness-categories";
import { cn } from "@/lib/utils";
import { categoryTitle } from "./category-columns";
import { NOT_APPLICABLE, STATUS_DOT } from "./check-meta";
import { checkIcon } from "./icon-registry";

/**
 * The key above a readiness grid — the same two sections on the Project gates
 * page and every team's grid, so the pages read as one: the status colours,
 * then the checks. A core check reads as its icon, code and label. A category
 * (phase 7, spec §8.8) is ONE chip — its icon, name and how many types it
 * holds — with its types on hover: the grid's columns already show every
 * category, so the key doesn't spell out all of a team's equipment.
 */
export function ReadinessLegend({
  statuses,
  notApplicable = false,
  checks,
}: {
  statuses: readonly CheckStatus[];
  /** Team checks key their "—" (unticked) cell; the Project gates key N/A instead. */
  notApplicable?: boolean;
  /** The checks the grid shows, in catalog order (a team's FULL definitions, so
   *  each category wears its first type's icon, as everywhere else). */
  checks: readonly CatalogCheck[];
}) {
  const { core, categories } = groupByCategory(checks);
  return (
    <div className="rounded-lg border border-border/70 bg-card/60 px-4 py-3">
      <div className="flex flex-col gap-3 md:flex-row md:gap-8">
        {/* Status colors */}
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Status
          </span>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="status-key">
            {statuses.map((s) => (
              <span key={s} className="flex items-center gap-1.5 text-xs text-foreground">
                <span className={cn("h-2.5 w-2.5 rounded-full", STATUS_DOT[s])} />
                {s}
              </span>
            ))}
            {notApplicable && (
              <span className="flex items-center gap-1.5 text-xs text-foreground">
                <span className="text-muted-foreground/60">—</span>
                {NOT_APPLICABLE}
              </span>
            )}
          </div>
        </div>

        {/* Separator on md+ */}
        <div className="hidden w-px bg-border/70 md:block" />

        {/* Check icons */}
        <div className="flex flex-1 flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Readiness Checks
          </span>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {core.map((check) => {
              const Icon = checkIcon(check.icon_key);
              return (
                <span
                  key={check.code}
                  className="flex items-center gap-1.5 whitespace-nowrap text-xs text-foreground"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
                  <span className="font-medium">{check.code}</span>
                  <span className="text-muted-foreground">{check.label}</span>
                </span>
              );
            })}
          </div>
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {categories.map((g) => (
                <CategoryChip key={g.name} name={g.name} items={g.items} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** A category in the key: its icon, name and type count; hovering it lists the
 *  types with their labels (screen readers get the same list). */
export function CategoryChip({ name, items }: { name: string; items: readonly CatalogCheck[] }) {
  const iconKey = items[0]?.icon_key ?? "";
  const Icon = checkIcon(iconKey);
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-border/70 px-2 py-0.5 text-xs text-foreground"
      title={categoryTitle(name, items)}
      data-testid="category-key"
      data-icon={iconKey}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
      <span className="font-medium">{name}</span>
      <span className="tabular-nums text-muted-foreground">{items.length}</span>
      <span className="sr-only">: {items.map((c) => `${c.code} ${c.label}`).join(", ")}</span>
    </span>
  );
}
