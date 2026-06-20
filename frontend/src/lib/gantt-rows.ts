/**
 * The one place the two Gantt row models genuinely agree: terrain ordering.
 *
 * The interactive chart and the static print otherwise build and sort their rows
 * differently *by design* — the chart's category axis is `inverse: true`, so it
 * sorts rigs descending to read ascending on screen, and its row label falls back
 * to the well name; the print sorts ascending and falls back to "—". Only the
 * shared piece lives here; forcing the rest together would change behaviour.
 */

/** Canonical terrain order on every Gantt: land, then swamp, then offshore. */
export const TERRAIN_ORDER: Record<string, number> = { LAND: 0, SWAMP: 1, OFFSHORE: 2 };

/** Rank a terrain for row ordering (unknown or blank sorts last). Trims and
 *  uppercases, so "land" and " LAND " rank the same as "LAND". */
export function terrainRank(loc: string | null | undefined): number {
  return TERRAIN_ORDER[(loc ?? "").trim().toUpperCase()] ?? 99;
}
