/**
 * A well's VALUE STREAM is its activity's Market ("Oil", "Domestic Gas"…) —
 * the user-facing name for the same field. Wells with none set form their own
 * group, listed last. One place for the wording and the order, shared by the
 * Readiness pages and the Sequence chart's filter.
 */

/** A well with no Market set — its own group, listed last. */
export const NO_VALUE_STREAM = "No value stream";

/** The value stream a Market value names (trimmed; blank = none). */
export function valueStreamOf(market: string | null | undefined): string {
  return market?.trim() || NO_VALUE_STREAM;
}

/** Value streams by name; wells with none last. */
export function byValueStream(a: string, b: string): number {
  if (a === b) return 0;
  if (a === NO_VALUE_STREAM) return 1;
  if (b === NO_VALUE_STREAM) return -1;
  return a.localeCompare(b);
}

/** The distinct value streams of some Market values, in display order. */
export function valueStreamsOf(markets: Iterable<string | null | undefined>): string[] {
  return [...new Set([...markets].map(valueStreamOf))].sort(byValueStream);
}

/** Whether a value-stream filter is worth offering: at least one well names a
 *  stream (when none does there is nothing to choose between). */
export function hasValueStreams(markets: Iterable<string | null | undefined>): boolean {
  for (const market of markets) if (market?.trim()) return true;
  return false;
}
