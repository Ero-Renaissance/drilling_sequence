/** The Value stream filter on the readiness pages: "All value streams", or one
 *  stream (the wells' Market; "No value stream" for wells with none). */
export function ValueStreamSelect({
  streams,
  value,
  onChange,
}: {
  /** The streams to offer, in display order. */
  streams: readonly string[];
  /** The chosen stream, or "" for all. */
  value: string;
  onChange: (stream: string) => void;
}) {
  return (
    <select
      aria-label="Value stream"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-border bg-background px-2 py-1 text-xs"
    >
      <option value="">All value streams</option>
      {streams.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
