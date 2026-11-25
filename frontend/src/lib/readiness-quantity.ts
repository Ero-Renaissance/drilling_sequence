/**
 * Equipment quantity (docs/equipment-quantity-spec.md §3): how many of one
 * equipment type a target needs — "PSV ×2". Only a check that `takes_quantity`
 * has one; it is information beside the status, so no readiness figure reads
 * it. A field project's number is the need of the WHOLE field project: a well
 * repeats it until it has its own, and wells are never added together.
 *
 * Kept out of the components so the rules are unit-tested without a page.
 */
import type { CatalogCheck, CheckCode, TeamCheckState } from "@/api/readiness";
import { applies, type ReadinessCell } from "@/components/readiness/check-meta";

/** The bounds the server enforces (backend `MIN_QUANTITY` / `MAX_QUANTITY`). */
export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 999;

/** A cell as any view holds it (live team cells carry the number). */
type Cell = ReadinessCell & Pick<TeamCheckState, "quantity" | "quantity_source">;
type Check = Pick<CatalogCheck, "code" | "locks_with_plan" | "takes_quantity">;

/** What a number field holds: a whole number in range, `null` for an empty
 *  field (clear the target's own number), or "invalid" — zero, a fraction, text
 *  or out of range. Zero is not a quantity: the type is deselected instead. */
export function parseQuantity(text: string): number | null | "invalid" {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/^\d{1,3}$/.test(trimmed)) return "invalid";
  const value = Number(trimmed);
  return value >= MIN_QUANTITY && value <= MAX_QUANTITY ? value : "invalid";
}

/** The number a cell SHOWS: only for a check that takes a quantity, where the
 *  check applies to the target and a number is stated; else null. */
export function quantityOf(cell: Cell | null | undefined, check: Check): number | null {
  if (!check.takes_quantity || !cell || !applies(cell, check)) return null;
  return typeof cell.quantity === "number" && cell.quantity >= MIN_QUANTITY ? cell.quantity : null;
}

/** The number that is the target's OWN — a well's ("well") or a field
 *  project's ("project") — never one a well only follows. */
export function ownQuantity(
  cell: Pick<TeamCheckState, "quantity" | "quantity_source"> | null | undefined,
  scope: "project" | "well",
): number | null {
  if (!cell || typeof cell.quantity !== "number") return null;
  return cell.quantity_source === scope ? cell.quantity : null;
}

/** A folded category's total on one row: the numbers stated for its types that
 *  apply there, added up ("Vessels · 3"); null when none states one. One row's
 *  types — never wells added together. */
export function categoryQuantity(
  items: readonly Check[],
  cells: Readonly<Partial<Record<CheckCode, Cell>>> | undefined,
): number | null {
  let total = 0;
  for (const item of items) total += quantityOf(cells?.[item.code], item) ?? 0;
  return total > 0 ? total : null;
}

/**
 * A cell's quantity as a line of text words it, away from the Readiness sheet
 * (the sequence chart's hover): "×3" for a well's own number, "×2 (project)"
 * for one the well only repeats from its field project — the need of the WHOLE
 * project, which every one of its wells shows, so it must not be read as "2 per
 * well" and added up. "" where no number shows (`quantityOf`).
 */
export function quantityNote(cell: Cell | null | undefined, check: Check): string {
  const quantity = quantityOf(cell, check);
  if (quantity === null) return "";
  return cell?.quantity_source === "project"
    ? `${quantityLabel(quantity)} (project)`
    : quantityLabel(quantity);
}

/** "×2" — how every view writes a quantity. */
export function quantityLabel(quantity: number): string {
  return `×${quantity}`;
}
