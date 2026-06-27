/**
 * The print/PDF document for a revision — a dedicated, document-first layout for
 * sharing the approved rig sequence with JV partners. Rendered print-only; the
 * interactive RevisionDetail page is hidden in print.
 *
 * Sections: title/approval block · static Gantt (sequence) · decoding legend ·
 * activity schedule table (with readiness gate icons) · formal sign-off table.
 */
import { Fragment } from "react";
import { AlarmClock, Droplet } from "lucide-react";
import { CHECK_META, STATUS_DOT, STATUS_ICON_COLOR, STATUS_LABEL } from "@/components/readiness/check-meta";
import { getActivityColor } from "@/lib/chart-colors";
import {
  classifyContract,
  URGENCY_VISUAL,
  type ContractUrgency,
} from "@/lib/contract-urgency";
import { buildDocRef, formatDocId } from "@/lib/doc-id";
import { computeFittedWindows, computeYearSpans, placeBarLabel } from "@/lib/print-gantt";
import { terrainRank } from "@/lib/gantt-rows";
import { cn } from "@/lib/utils";
import type { ContractStatus } from "@/api/contracts";
import type { CheckCode, CheckStatus } from "@/api/readiness";
import type { RevisionDetail } from "@/api/revisions";
import type { Project } from "@/types";

// The four in-force urgencies that have an end date to place on the timeline.
type DatedUrgency = "expired" | "critical" | "soon" | "healthy";
const DATED_URGENCIES: DatedUrgency[] = ["expired", "critical", "soon", "healthy"];

/** Urgency of a rig's contract from the snapshot's denormalised fields, or null
 *  unless it's an in-force ("Completed") contract with an end date to mark. */
function expiryUrgency(
  status: string | null | undefined,
  end: string | null | undefined,
): DatedUrgency | null {
  if (!end) return null;
  const u = classifyContract({ status: (status ?? undefined) as ContractStatus | undefined, contract_end: end });
  return u !== null && (DATED_URGENCIES as ContractUrgency[]).includes(u) ? (u as DatedUrgency) : null;
}

const CHECK_CODES: CheckCode[] = ["FDP", "LLI", "LOC", "FE", "FID", "EIA", "BUD", "CON"];
const STATUSES: CheckStatus[] = ["Completed", "In Progress", "Behind", "Not Started", "N/A"];
const WINDOW_YEARS = 2; // sequence paginates into ≤2-year chunks; each is then fitted to its data
const ROWS_PER_PAGE = 9; // rig rows per chart page, so a window never overflows / slices a page
const RIG_COL = "11rem"; // "Terrain – Rig" label column width
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Well-name placement on the readiness chart (all percentages of the page window).
// A name rides inside a bar at least NAME_INSIDE_MIN_PCT wide; otherwise it spills
// into the larger adjacent gap, clamped so it never runs into the neighbouring bar.
// A spill gap smaller than NAME_MIN_SIDE_PCT shows nothing (the schedule table is
// the fallback cross-reference). Tuned for the 1-year readiness window — adjust
// here if names spill too eagerly or truncate too soon.
const NAME_INSIDE_MIN_PCT = 10;
const NAME_MIN_SIDE_PCT = 4;
const LABEL_GAP_PAD_PCT = 0.5;

/** Chart row label = "TERRAIN – Rig" (matches the on-screen Gantt). */
function rowLabel(loc: string | null, rig: string | null): string {
  const t = loc?.trim();
  const r = rig?.trim();
  if (t && r) return `${t} – ${r}`;
  return r || t || "—";
}

export interface PrintRow {
  id: string;
  activity_type: string;
  start_date: string;
  end_date: string;
  well_name: string | null;
  well_project: string | null;
  rig_name: string | null;
  location: string | null; // terrain (LAND / SWAMP / OFFSHORE)
  plan_type: string | null;
  risk: string | null;
  readiness?: Record<string, CheckStatus>;
  rig_contract_status?: string | null;
  rig_contract_end?: string | null;
}

function parse(d: string | null | undefined): Date | null {
  if (!d) return null;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t;
}

function fmt(d: string | null | undefined): string {
  const t = parse(d);
  return t
    ? t.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })
    : "—";
}

// Stable 1..N ordering by start date (then well), so a bar's number on the Gantt
// matches its row in the schedule table's "#" column.
function orderRows(rows: PrintRow[]): PrintRow[] {
  return [...rows].sort((a, b) => {
    const sa = parse(a.start_date)?.getTime() ?? 0;
    const sb = parse(b.start_date)?.getTime() ?? 0;
    if (sa !== sb) return sa - sb;
    return (a.well_name ?? "").localeCompare(b.well_name ?? "");
  });
}

// ── Static Gantt — clean bars on a month grid, fitted to the data per window ───

/** Flood-risk water-drop — solid blue. Pass `onBar` (white edge) when it sits on
 *  a coloured bar so it stays legible; plain blue on white (table / legend). */
function FloodDrop({ className, onBar = false }: { className?: string; onBar?: boolean }) {
  return (
    <Droplet
      className={className}
      style={{ color: "#2563eb" }}
      fill="#2563eb"
      stroke={onBar ? "#ffffff" : "#2563eb"}
      strokeWidth={1.5}
    />
  );
}

function StaticGantt({
  rows,
  index,
  windowYears = WINDOW_YEARS,
  rowsPerPage = ROWS_PER_PAGE,
  showReadiness = false,
  dropEmptyRows = false,
}: {
  rows: PrintRow[];
  index: Map<string, number>;
  windowYears?: number;
  rowsPerPage?: number;
  /** Render the 8 readiness icons in a strip beneath each bar (taller rows). */
  showReadiness?: boolean;
  /** Per window, list only rigs that have an activity in it, and skip empty
   *  windows — keeps a one-year-per-page view from emitting pages of empty rows. */
  dropEmptyRows?: boolean;
}) {
  const acts = rows
    .map((r) => ({ ...r, s: parse(r.start_date), e: parse(r.end_date) }))
    .filter((a): a is PrintRow & { s: Date; e: Date } => a.s !== null && a.e !== null);
  if (acts.length === 0) return null;

  // Rows = terrain + rig, ordered Land → Swamp → Offshore, then rig. The contract
  // is per-rig (denormalised onto every activity), so capture it once per row.
  const meta = new Map<
    string,
    { loc: string | null; rig: string | null; contractEnd: string | null; urgency: DatedUrgency | null }
  >();
  for (const a of acts) {
    const k = rowLabel(a.location, a.rig_name);
    if (!meta.has(k)) {
      meta.set(k, {
        loc: a.location,
        rig: a.rig_name,
        contractEnd: a.rig_contract_end ?? null,
        urgency: expiryUrgency(a.rig_contract_status, a.rig_contract_end),
      });
    }
  }
  const rowKeys = Array.from(meta.keys()).sort((ka, kb) => {
    const A = meta.get(ka)!;
    const B = meta.get(kb)!;
    const d = terrainRank(A.loc) - terrainRank(B.loc);
    return d !== 0 ? d : (A.rig ?? "").localeCompare(B.rig ?? "");
  });

  // Fit each page's window to its activities (snapped to whole months) rather
  // than a fixed Jan–Dec span; empty chunks are dropped. See computeFittedWindows.
  const windows = computeFittedWindows(
    acts.map((a) => ({ s: a.s.getTime(), e: a.e.getTime() })),
    windowYears,
  );
  const now = Date.now();

  const activeInWindow = (key: string, w: { from: Date; to: Date }) =>
    acts.some(
      (a) =>
        rowLabel(a.location, a.rig_name) === key &&
        a.e.getTime() > w.from.getTime() &&
        a.s.getTime() < w.to.getTime(),
    );

  // Two-axis pagination: each page is one time window × a chunk of ≤rowsPerPage rig
  // rows (window-major). A window with more rigs than fit on a page is split across
  // pages instead of overflowing and slicing a row at the page edge. With
  // dropEmptyRows, a window only lists its active rigs (and empty windows are skipped).
  type ChartPage = { w: { from: Date; to: Date }; keys: string[]; firstRow: number; rowTotal: number };
  const pages: ChartPage[] = [];
  for (const w of windows) {
    const wKeys = dropEmptyRows ? rowKeys.filter((k) => activeInWindow(k, w)) : rowKeys;
    if (wKeys.length === 0) continue;
    for (let i = 0; i < wKeys.length; i += rowsPerPage) {
      pages.push({
        w,
        keys: wKeys.slice(i, i + rowsPerPage),
        firstRow: i + 1,
        rowTotal: wKeys.length,
      });
    }
  }

  return (
    <>
      {pages.map((pg, pi) => {
        const w = pg.w;
        const winStart = w.from.getTime();
        const winSpan = w.to.getTime() - winStart;
        // Year axis slices (centred labels + internal gridlines); `yb` = the
        // window's last visible year, used for the "2026–2027" page heading.
        const yb = new Date(w.to.getTime() - 1).getFullYear();
        const yearSpans = computeYearSpans(w.from, w.to);
        // Month columns — drive the alternating bands + month labels. A window begins
        // on a month boundary, so idx 0 is w.from's month and every odd one gets a band.
        const months: { left: number; width: number; idx: number; m: number }[] = [];
        for (
          let cur = new Date(w.from.getFullYear(), w.from.getMonth(), 1), idx = 0;
          cur.getTime() < w.to.getTime();
          cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1), idx++
        ) {
          const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
          months.push({
            left: ((cur.getTime() - winStart) / winSpan) * 100,
            width: ((Math.min(next.getTime(), w.to.getTime()) - cur.getTime()) / winSpan) * 100,
            idx,
            m: cur.getMonth(),
          });
        }
        const todayPct =
          now >= winStart && now < w.to.getTime() ? ((now - winStart) / winSpan) * 100 : null;
        const ya = w.from.getFullYear();
        const span = ya === yb ? `${ya}` : `${ya}–${yb}`;
        const rigRange =
          pg.rowTotal > rowsPerPage
            ? ` · rigs ${pg.firstRow}–${pg.firstRow + pg.keys.length - 1} of ${pg.rowTotal}`
            : "";
        return (
          <div key={pi} className={cn("mt-3 print:break-inside-avoid", pi > 0 && "break-before-page")}>
            {pi > 0 && (
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Sequence (continued) · {span}
                {rigRange}
              </p>
            )}
            <div className="overflow-hidden rounded-md border border-border bg-zinc-50">
              {/* Year axis */}
              <div className="flex h-5 border-b border-border bg-zinc-100 text-[9px] tabular-nums text-muted-foreground">
                <div className="shrink-0" style={{ width: RIG_COL }} />
                <div className="relative h-full flex-1">
                  {yearSpans.map((ys) => (
                    <span
                      key={ys.y}
                      className="absolute inset-y-0 flex items-center justify-center overflow-hidden px-1"
                      style={{ left: `${ys.left}%`, width: `${ys.width}%` }}
                    >
                      {ys.y}
                    </span>
                  ))}
                </div>
              </div>
              {/* Month axis — abbreviations let a reader read off the month directly */}
              <div className="flex h-4 border-b border-border/60 bg-zinc-50 text-[6.5px] uppercase tracking-tight text-muted-foreground">
                <div className="shrink-0" style={{ width: RIG_COL }} />
                <div className="relative h-full flex-1">
                  {months.map((mo) => (
                    <span
                      key={mo.left}
                      className="absolute inset-y-0 flex items-center justify-center overflow-hidden"
                      style={{ left: `${mo.left}%`, width: `${mo.width}%` }}
                    >
                      {MONTH_ABBR[mo.m]}
                    </span>
                  ))}
                </div>
              </div>
              {/* Rows + a gridline / today overlay across the plot area */}
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 right-0" style={{ left: RIG_COL }}>
                  {/* Subtle alternating month bands — drawn first so year gridlines
                      and the today line sit on top, and the activity bars cover them. */}
                  {months.map((mo) =>
                    mo.idx % 2 === 1 ? (
                      <div
                        key={`band-${mo.left}`}
                        className="absolute inset-y-0 bg-black/[0.035]"
                        style={{ left: `${mo.left}%`, width: `${mo.width}%` }}
                      />
                    ) : null,
                  )}
                  {yearSpans.map((ys) =>
                    ys.left > 0.5 && ys.left < 99.5 ? (
                      <div key={ys.y} className="absolute inset-y-0 w-px bg-border/60" style={{ left: `${ys.left}%` }} />
                    ) : null,
                  )}
                  {todayPct !== null && (
                    <div
                      className="absolute inset-y-0 border-l border-dashed border-red-400/70"
                      style={{ left: `${todayPct}%` }}
                    />
                  )}
                </div>
                {pg.keys.map((key) => {
                  const m = meta.get(key);
                  // Contract-expiry marker — only when the rig's in-force contract
                  // ends inside this window; placed at that date along the row.
                  const cEnd = m?.urgency ? parse(m.contractEnd) : null;
                  const expiryPct =
                    cEnd && cEnd.getTime() >= winStart && cEnd.getTime() < w.to.getTime()
                      ? ((cEnd.getTime() - winStart) / winSpan) * 100
                      : null;
                  const expiryHex = m?.urgency ? URGENCY_VISUAL[m.urgency].hex : undefined;
                  // Bars on this row, left→right, with their %-geometry — so each can
                  // see its neighbours' edges and place a spilled label in the gap
                  // without overrunning them.
                  const rowActs = acts
                    .filter(
                      (a) =>
                        rowLabel(a.location, a.rig_name) === key &&
                        a.e.getTime() > winStart &&
                        a.s.getTime() < w.to.getTime(),
                    )
                    .sort((x, y) => x.s.getTime() - y.s.getTime());
                  const geom = rowActs.map((a) => ({
                    l: Math.max(0, ((a.s.getTime() - winStart) / winSpan) * 100),
                    r: Math.min(100, ((a.e.getTime() - winStart) / winSpan) * 100),
                  }));
                  return (
                    <div
                      key={key}
                      className={cn(
                        "flex items-stretch border-b border-border/40 last:border-b-0",
                        showReadiness ? "h-11" : "h-9",
                      )}
                    >
                    <div
                      className="flex shrink-0 items-center truncate border-r border-border/60 px-2 text-[9px] font-medium text-foreground"
                      style={{ width: RIG_COL }}
                    >
                      {key}
                    </div>
                    <div className="relative flex-1">
                      {rowActs.map((a, ai) => {
                          const { l, r } = geom[ai];
                          const wpct = Math.max(0.8, r - l);
                          // Neighbour edges on this row (0 / 100 at the ends) — the walls
                          // a spilled label must stop short of.
                          const prevR = ai > 0 ? geom[ai - 1].r : 0;
                          const nextL = ai < geom.length - 1 ? geom[ai + 1].l : 100;
                          // Readiness chart: name inside a wide-enough bar, else spilled
                          // into the larger gap (clamped). Standard chart is untouched.
                          const namePlacement =
                            showReadiness && a.well_name
                              ? placeBarLabel({
                                  leftPct: l,
                                  rightPct: r,
                                  prevRightPct: prevR,
                                  nextLeftPct: nextL,
                                  insideMinPct: NAME_INSIDE_MIN_PCT,
                                  minSidePct: NAME_MIN_SIDE_PCT,
                                  gapPadPct: LABEL_GAP_PAD_PCT,
                                })
                              : ({ side: "inside", maxWidthPct: r - l } as const);
                          // Project chip rides above the bar; clamp it to the gap so a
                          // long name can't bleed across the next bar (it could before).
                          const projectMaxPct = Math.max(0, nextL - l - LABEL_GAP_PAD_PCT);
                          const n = index.get(a.id);
                          // Every bar carries its schedule number — legible even a few days
                          // wide (a min-width keeps the digit from being clipped). The well
                          // name rides along only when the bar is wide enough.
                          // Standard bars lead with the well name and keep the number
                          // as a fallback cross-reference to the schedule table; a small
                          // font lets the name fit on most bars. (Readiness bars show the
                          // name only — handled below.) Truncates on the narrowest bars.
                          const showName = wpct >= 5 && !!a.well_name;
                          // The well's project rides above the standard bar (muted, like the
                          // live Sequence chart) — but only on a wide-enough bar, so dense rows
                          // of narrow bars don't collide. The schedule table's Project column is
                          // the complete reference for the narrow ones that omit it.
                          const showProject = wpct >= 6 && !!a.well_project;
                          // Flood-risk droplet on the bar (both modes), gated to a
                          // wide-enough bar; the table + legend cover the narrow ones.
                          const showFlood = a.risk === "Flood Risk" && wpct >= 4;
                          return (
                            <Fragment key={a.id}>
                              {showReadiness ? (
                                <>
                                  {/* Project label above the bar (muted), like the live Sequence
                                      chart. Dark-on-white so the full project reads; only shown
                                      when the well belongs to a project. */}
                                  {a.well_project && (
                                    <span
                                      className="pointer-events-none absolute top-0 truncate rounded-[2px] bg-black/10 px-0.5 py-px text-[6px] font-semibold leading-none text-foreground"
                                      style={{ left: `${l}%`, maxWidth: `${projectMaxPct}%` }}
                                    >
                                      {a.well_project}
                                    </span>
                                  )}
                                  {/* Colored bar; the well name rides INSIDE only when the bar is
                                      wide enough — otherwise it spills beside the bar (below). */}
                                  <span
                                    title={`#${n ?? "?"} · ${a.activity_type}${a.well_name ? ` · ${a.well_name}` : ""}${a.well_project ? ` · ${a.well_project}` : ""}`}
                                    className="absolute top-[0.55rem] flex h-[0.95rem] items-center justify-center overflow-hidden rounded px-0.5 text-[6px] font-medium text-white"
                                    style={{ left: `${l}%`, width: `${wpct}%`, minWidth: "1.15rem", backgroundColor: getActivityColor(a.activity_type) }}
                                  >
                                    {namePlacement.side === "inside" && a.well_name ? (
                                      <span className="truncate">{a.well_name}</span>
                                    ) : null}
                                    {showFlood && (
                                      <FloodDrop onBar className="pointer-events-none absolute right-0.5 top-1/2 h-2 w-2 -translate-y-1/2" />
                                    )}
                                  </span>
                                  {/* Well name spilled into the whitespace beside a too-narrow bar
                                      (dark on the page), clamped to the gap so it can't run into the
                                      neighbouring bar; the schedule table covers the truly cramped. */}
                                  {a.well_name &&
                                    (namePlacement.side === "right" || namePlacement.side === "left") && (
                                      <span
                                        className={cn(
                                          "pointer-events-none absolute top-[0.55rem] h-[0.95rem] overflow-hidden whitespace-nowrap text-[6px] font-medium leading-[0.95rem] text-foreground",
                                          namePlacement.side === "right" ? "text-ellipsis" : "text-right",
                                        )}
                                        style={
                                          namePlacement.side === "right"
                                            ? { left: `${r}%`, maxWidth: `${namePlacement.maxWidthPct}%`, paddingLeft: "0.15rem" }
                                            : { right: `${100 - l}%`, maxWidth: `${namePlacement.maxWidthPct}%`, paddingRight: "0.15rem" }
                                        }
                                      >
                                        {a.well_name}
                                      </span>
                                    )}
                                  {/* Readiness strip beneath the bar — scaled to the bar
                                      width (capped) and centred, so the 8 gates never spill
                                      past the bar into a neighbour's strip. Narrow bars get
                                      smaller icons; the schedule table keeps them full size. */}
                                  <span
                                    className="pointer-events-none absolute top-[1.75rem] flex justify-center"
                                    style={{ left: `${l}%`, width: `${wpct}%` }}
                                  >
                                    <span className="w-full max-w-[6rem]">
                                      <ReadinessIcons readiness={a.readiness} fill />
                                    </span>
                                  </span>
                                </>
                              ) : (
                                <>
                                  {showProject && (
                                    <span
                                      className="pointer-events-none absolute top-0 whitespace-nowrap rounded-[2px] bg-black/10 px-0.5 py-px text-[6px] font-semibold leading-none text-foreground"
                                      style={{ left: `${l}%` }}
                                    >
                                      {a.well_project}
                                    </span>
                                  )}
                                  <span
                                    title={`#${n ?? "?"} · ${a.activity_type}${a.well_name ? ` · ${a.well_name}` : ""}${a.well_project ? ` · ${a.well_project}` : ""}`}
                                    className="absolute top-[0.5rem] flex h-6 items-center justify-center gap-1 overflow-hidden rounded px-1 text-[6.5px] font-semibold text-white"
                                    style={{ left: `${l}%`, width: `${wpct}%`, minWidth: "1.15rem", backgroundColor: getActivityColor(a.activity_type) }}
                                  >
                                    {/* Order number as a white "index badge" — its own
                                        container + mono digits read as a marker into the
                                        schedule table's # column, not part of the well name. */}
                                    <span className="shrink-0 rounded-[2px] bg-white px-0.5 py-px font-mono font-semibold leading-none tabular-nums text-zinc-800">
                                      {n}
                                    </span>
                                    {showName && (
                                      <span className="truncate font-medium opacity-90">{a.well_name}</span>
                                    )}
                                    {showFlood && (
                                      <FloodDrop onBar className="pointer-events-none absolute right-0.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2" />
                                    )}
                                  </span>
                                </>
                              )}
                            </Fragment>
                          );
                        })}
                      {/* Contract-expiry marker: alarm at the expiry date + a faint
                          tick down the row, coloured by urgency. */}
                      {expiryPct !== null && expiryHex && (
                        <span
                          className="pointer-events-none absolute inset-y-0 z-10 flex flex-col items-center"
                          style={{ left: `${expiryPct}%`, transform: "translateX(-50%)" }}
                          title={`Contract expires ${fmt(m!.contractEnd)}`}
                        >
                          <span className="rounded-full bg-white/85 leading-none">
                            <AlarmClock className="h-2.5 w-2.5" style={{ color: expiryHex }} strokeWidth={2.5} />
                          </span>
                          <span className="w-px flex-1" style={{ backgroundColor: expiryHex, opacity: 0.5 }} />
                        </span>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
            {/* Legends ride with the chart so every page is self-decoding: the
                activity colours always, and the readiness key when icons are shown. */}
            <ActivityLegend rows={rows} showOrderKey={!showReadiness} />
            {showReadiness && (
              <div className="mt-2">
                <ReadinessKey />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

// ── Legends — chart colours go with the chart; readiness icons with the table ──

function ActivityLegend({ rows, showOrderKey = false }: { rows: PrintRow[]; showOrderKey?: boolean }) {
  const types = Array.from(new Set(rows.map((r) => r.activity_type).filter(Boolean))).sort();
  // Show the contract-expiry key only when some rig has an in-force contract.
  const hasExpiry = rows.some((r) => expiryUrgency(r.rig_contract_status, r.rig_contract_end) !== null);
  const hasFlood = rows.some((r) => r.risk === "Flood Risk");
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-zinc-50 px-3 py-2 text-[9px] print:break-inside-avoid">
      <span className="font-semibold uppercase tracking-wider text-muted-foreground">Activity</span>
      {types.map((t) => (
        <span key={t} className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: getActivityColor(t) }} />
          {t}
        </span>
      ))}
      {showOrderKey && (
        <>
          <span className="mx-0.5 h-3 w-px bg-border" />
          <span className="inline-flex items-center gap-1">
            <span className="rounded-[2px] border border-border bg-white px-1 font-mono text-[8px] font-semibold leading-none text-zinc-800">1</span>
            <span className="text-muted-foreground">order in the schedule</span>
          </span>
        </>
      )}
      {hasFlood && (
        <>
          <span className="mx-0.5 h-3 w-px bg-border" />
          <span className="inline-flex items-center gap-1">
            <FloodDrop className="h-3 w-3" /> Flood risk
          </span>
        </>
      )}
      {hasExpiry && (
        <>
          <span className="mx-0.5 h-3 w-px bg-border" />
          <span className="inline-flex items-center gap-1 font-semibold uppercase tracking-wider text-muted-foreground">
            <AlarmClock className="h-3 w-3" strokeWidth={2.25} /> Rig Contract Expiration
          </span>
          {DATED_URGENCIES.map((u) => (
            <span key={u} className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: URGENCY_VISUAL[u].hex }} />
              {URGENCY_VISUAL[u].label}
            </span>
          ))}
        </>
      )}
    </div>
  );
}

function ReadinessKey() {
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-zinc-50 px-3 py-2 text-[9px] print:break-inside-avoid">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="w-16 shrink-0 font-semibold uppercase tracking-wider text-muted-foreground">Readiness</span>
        {CHECK_CODES.map((c) => {
          const Icon = CHECK_META[c].icon;
          return (
            <span key={c} className="inline-flex items-center gap-1">
              <Icon className="h-3 w-3" />
              <span className="font-medium">{c}</span>
              <span className="text-muted-foreground">{CHECK_META[c].label}</span>
            </span>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="w-16 shrink-0 font-semibold uppercase tracking-wider text-muted-foreground">Status</span>
        {STATUSES.map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <span className={cn("inline-block h-2.5 w-2.5 rounded-full", STATUS_DOT[s])} />
            {STATUS_LABEL[s]}
          </span>
        ))}
      </div>
    </div>
  );
}

function ReadinessIcons({
  readiness,
  fill = false,
}: {
  readiness?: Record<string, CheckStatus>;
  /** Scale the 8 gates to fill the parent's width (the Gantt strip) instead of a
   *  fixed 12px each (the schedule table). Lets a strip shrink to a narrow bar's
   *  width so it never overruns into the next well's strip. */
  fill?: boolean;
}) {
  if (fill) {
    return (
      <span className="grid w-full grid-cols-8 gap-px">
        {CHECK_CODES.map((c) => {
          const Icon = CHECK_META[c].icon;
          const st = (readiness?.[c] ?? "Not Started") as CheckStatus;
          return <Icon key={c} className={cn("h-auto w-full", STATUS_ICON_COLOR[st])} />;
        })}
      </span>
    );
  }
  return (
    <span className="inline-flex gap-0.5">
      {CHECK_CODES.map((c) => {
        const Icon = CHECK_META[c].icon;
        const st = (readiness?.[c] ?? "Not Started") as CheckStatus;
        return <Icon key={c} className={cn("h-3 w-3", STATUS_ICON_COLOR[st])} />;
      })}
    </span>
  );
}

const SCHEDULE_ROWS_PER_PAGE = 20; // explicit pagination — browser auto-breaks slice a row

function ScheduleTable({ rows, index }: { rows: PrintRow[]; index: Map<string, number> }) {
  // Chunk to a fixed count per page rather than letting the browser paginate the
  // tbody: under print it occasionally slices a row at the page edge despite
  // break-inside:avoid. Each chunk is its own table that reprints the header.
  const pages: PrintRow[][] = [];
  for (let i = 0; i < rows.length; i += SCHEDULE_ROWS_PER_PAGE) {
    pages.push(rows.slice(i, i + SCHEDULE_ROWS_PER_PAGE));
  }
  return (
    <>
      {pages.map((chunk, pi) => (
        <table
          key={pi}
          className={cn("w-full border-collapse text-[9.5px]", pi > 0 && "break-before-page")}
        >
          {/* Both rows sit in <thead> so the readiness key AND the column labels
              head every page of the table. */}
          <thead>
            <tr>
              <td colSpan={11} className="pb-2 pt-1">
                <ReadinessKey />
              </td>
            </tr>
            <tr className="bg-muted/40 text-left text-[8px] uppercase tracking-wider text-muted-foreground">
              {["#", "Activity", "Well", "Project", "Terrain", "Rig", "Start", "End", "Plan", "Risk", "Readiness"].map((h) => (
                <th key={h} className="px-1.5 py-1">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chunk.map((r) => (
              <tr key={r.id}>
                <td className="px-1.5 py-1 tabular-nums font-semibold text-foreground">{index.get(r.id)}</td>
                <td className="px-1.5 py-1 font-medium text-foreground">{r.activity_type}</td>
                <td className="px-1.5 py-1 text-muted-foreground">{r.well_name ?? "—"}</td>
                <td className="px-1.5 py-1 text-muted-foreground">{r.well_project ?? "—"}</td>
                <td className="px-1.5 py-1 text-muted-foreground">{r.location ?? "—"}</td>
                <td className="px-1.5 py-1 text-muted-foreground">{r.rig_name ?? "—"}</td>
                <td className="px-1.5 py-1 tabular-nums text-muted-foreground">{fmt(r.start_date)}</td>
                <td className="px-1.5 py-1 tabular-nums text-muted-foreground">{fmt(r.end_date)}</td>
                <td className="px-1.5 py-1 text-muted-foreground">{r.plan_type ?? "—"}</td>
                <td className="px-1.5 py-1 text-muted-foreground">
                  {r.risk === "Flood Risk" ? (
                    <span className="inline-flex items-center gap-1 whitespace-nowrap">
                      <FloodDrop className="h-3 w-3 shrink-0" /> Flood Risk
                    </span>
                  ) : (
                    r.risk ?? "—"
                  )}
                </td>
                <td className="px-1.5 py-1">
                  <ReadinessIcons readiness={r.readiness} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </>
  );
}

interface SignRow {
  name: string;
  role: string;
  when: string | null;
}

function SignOff({ revision }: { revision: RevisionDetail }) {
  const reviewers: SignRow[] = revision.reviewer_status.map((r) => ({
    name: r.signer_name ?? r.name ?? r.email,
    role: r.role_label,
    when: r.signed ? r.signed_at : null,
  }));
  const approvers: SignRow[] =
    revision.approver_status.length > 0
      ? revision.approver_status.map((a) => ({
          name: a.signer_name ?? a.name ?? a.email,
          role: a.role_label,
          when: a.signed ? a.signed_at : null,
        }))
      : revision.signatures.map((s) => ({
          name: s.user_name ?? "—",
          role: s.role_label,
          when: s.signed_at,
        }));

  if (reviewers.length === 0 && approvers.length === 0) return null;

  const group = (title: string, items: SignRow[]) =>
    items.length === 0 ? null : (
      <>
        <tr>
          <td colSpan={3} className="bg-muted/30 px-2 py-1 text-[8px] font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </td>
        </tr>
        {items.map((s, i) => (
          <tr key={`${title}-${i}`}>
            <td className="px-2 py-1 font-medium text-foreground">{s.name}</td>
            <td className="px-2 py-1 text-muted-foreground">{s.role}</td>
            <td className="px-2 py-1 tabular-nums text-foreground">{s.when ? fmt(s.when) : "— not signed"}</td>
          </tr>
        ))}
      </>
    );

  return (
    <div className="mt-4 print:break-inside-avoid">
      <h2 className="mb-1 text-[11px] font-semibold text-foreground">Approval signatures</h2>
      <table className="w-full max-w-lg border-collapse text-[10px]">
        <thead>
          <tr className="text-left text-[8px] uppercase tracking-wider text-muted-foreground">
            <th className="px-2 py-1">Name</th>
            <th className="px-2 py-1">Role</th>
            <th className="px-2 py-1">Signed</th>
          </tr>
        </thead>
        <tbody>
          {group("Reviewers", reviewers)}
          {group("Approvers", approvers)}
        </tbody>
      </table>
    </div>
  );
}

// ── Manual sign-off — wet-ink lines for the print-and-route workflow ───────────

function ManualSignOff({ revision }: { revision: RevisionDetail }) {
  const reviewers = revision.reviewer_status.map((r) => ({
    name: r.signer_name ?? r.name ?? r.email,
    role: r.role_label,
  }));
  const approvers = revision.approver_status.map((a) => ({
    name: a.signer_name ?? a.name ?? a.email,
    role: a.role_label,
  }));

  // Tall cells so there's room to sign by hand; the print stylesheet rules every
  // cell with a bottom border, which doubles as the signature/date line.
  const cell = "h-10 px-2 align-bottom pb-1";

  const group = (title: string, items: { name: string; role: string }[], spares: number) => (
    <>
      <tr>
        <td colSpan={4} className="bg-muted/30 px-2 py-1 text-[8px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </td>
      </tr>
      {items.map((s, i) => (
        <tr key={`${title}-${i}`}>
          <td className={cn(cell, "font-medium text-foreground")}>{s.name}</td>
          <td className={cn(cell, "text-muted-foreground")}>{s.role}</td>
          <td className={cell} />
          <td className={cell} />
        </tr>
      ))}
      {Array.from({ length: spares }).map((_, i) => (
        <tr key={`${title}-spare-${i}`}>
          <td className={cell} />
          <td className={cell} />
          <td className={cell} />
          <td className={cell} />
        </tr>
      ))}
    </>
  );

  return (
    <div className="mt-5 print:break-inside-avoid">
      <h2 className="mb-1 text-[11px] font-semibold text-foreground">Review &amp; approval signatures</h2>
      <p className="mb-2 text-[9px] text-muted-foreground">
        Each reviewer and approver signs and dates below to record their review/approval of
        this rig sequence.
      </p>
      <table className="w-full max-w-3xl border-collapse text-[10px]">
        <thead>
          <tr className="text-left text-[8px] uppercase tracking-wider text-muted-foreground">
            <th className="px-2 py-1">Name</th>
            <th className="px-2 py-1">Role</th>
            <th className="px-2 py-1">Signature</th>
            <th className="w-28 px-2 py-1">Date</th>
          </tr>
        </thead>
        <tbody>
          {group("Reviewers", reviewers, 2)}
          {group("Approvers", approvers, 2)}
        </tbody>
      </table>
    </div>
  );
}

// ── Authenticity — how a recipient verifies the document is genuine ────────────

function VerifyBox({ docId }: { docId: string }) {
  if (!docId) return null;
  return (
    <div className="mt-4 max-w-2xl rounded-md border border-border bg-zinc-50 px-3 py-2 text-[9px] leading-relaxed text-muted-foreground print:break-inside-avoid">
      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground">
        Verifying this document
      </p>
      <p>
        This is a rendering of an approved revision held in Renaissance Africa Energy&apos;s
        system of record. To confirm it is genuine and unaltered:
      </p>
      <ol className="mt-1 list-decimal space-y-0.5 pl-4">
        <li>
          If the file carries a digital signature, open it in Adobe Reader and validate the
          signature panel.
        </li>
        <li>
          Otherwise, quote the Document ID below to your Renaissance Africa Energy Company
          representative — any change to the sequence, dates, or approvals changes this ID.
        </li>
      </ol>
      <p className="mt-1 font-mono text-[10px] tracking-wide text-foreground">
        Document ID&nbsp;&nbsp;{formatDocId(docId)}
      </p>
    </div>
  );
}

// ── The document ───────────────────────────────────────────────────────────────

export function RevisionPrintDoc({
  revision,
  project,
  rows,
  chart = "standard",
  includeSchedule = true,
  signatures = "system",
}: {
  revision: RevisionDetail;
  project: Project | null;
  rows: PrintRow[];
  /** "standard" → the 2-year sequence Gantt (numbered bars).
   *  "readiness"→ one year per page with the readiness icons under each bar. */
  chart?: "standard" | "readiness";
  /** Append the activity-schedule table after the chart. */
  includeSchedule?: boolean;
  /** "system" → the system-recorded sign-off (their actual signatures + Document ID
   *  on the standard JV record). "wetink" → blank lines to sign by hand. */
  signatures?: "system" | "wetink";
}) {
  const isReadiness = chart === "readiness";
  const isWetInk = signatures === "wetink";
  const isApproved = revision.status === "approved";
  const docRef = buildDocRef(project?.name, revision.rev_number);
  // The JV-partner record (standard chart, recorded signatures) is the only output
  // that carries the integrity Document ID + verify block and the draft watermark.
  const isJvRecord = !isReadiness && !isWetInk;

  // One stable number per activity, shared by the Gantt bars and the table "#" column.
  const ordered = orderRows(rows);
  const index = new Map(ordered.map((r, i) => [r.id, i + 1]));

  // Controlled-document date: a recorded-signature output dates to the latest
  // approval; a wet-ink form is a fresh routing sheet, always "generated".
  const approvedAt = isApproved
    ? revision.signatures.reduce<string | null>(
        (latest, s) => (latest === null || s.signed_at > latest ? s.signed_at : latest),
        null,
      )
    : null;
  const generated = `Generated ${new Date().toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}`;
  const docDate = !isWetInk && approvedAt ? `Approved ${fmt(approvedAt)}` : generated;

  return (
    // Internal padding guarantees visible whitespace even when the browser print
    // dialog overrides the @page margin (the "Margins: None/Default" trap).
    <div className="relative hidden px-[6mm] py-[4mm] text-foreground print:block">
      {/* Watermark — only the JV record warns "not for distribution" when not yet
          approved. Wet-ink forms are meant to be distributed; the readiness view is
          a working document. */}
      {isJvRecord && !isApproved && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
          <span className="rotate-[-28deg] text-center text-[64px] font-black uppercase leading-none tracking-widest text-red-500/15">
            Draft
            <br />
            Not for distribution
          </span>
        </div>
      )}

      {/* Title block */}
      <div className="flex items-end justify-between gap-6">
        <img src="/raec-logo.png" alt="Renaissance Africa Energy" className="h-11 w-auto" />
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Renaissance Africa Energy Company Limited
          </p>
          <h1 className="text-xl font-bold tracking-tight">
            Rig Sequence —{" "}
            {isReadiness
              ? "Readiness"
              : isWetInk
                ? "For Review & Approval"
                : isApproved
                  ? "Approved Sequence"
                  : "Draft (Not for distribution)"}
          </h1>
        </div>
      </div>
      <img src="/raec-linebar.png" alt="" className="mt-1.5 h-[5px] w-full object-cover" />
      <div className="mt-2 flex items-start justify-between gap-6 text-xs">
        <div>
          <p className="text-base font-semibold">{project?.name ?? "Drilling Sequence"}</p>
          <p className="text-muted-foreground">
            {[project?.field, project?.region].filter(Boolean).join(" · ") || "—"}
          </p>
          {/* Wet-ink forms are standalone (no system references). Recorded-signature
              outputs show the doc ref; only the JV record adds the Document ID. */}
          {!isWetInk && (
            <>
              <p className="mt-0.5 text-[10px] tracking-wider text-muted-foreground">Ref {docRef}</p>
              {isJvRecord && revision.integrity_digest && (
                <p className="mt-0.5 font-mono text-[9px] tracking-wide text-muted-foreground">
                  Document ID {formatDocId(revision.integrity_digest)}
                </p>
              )}
            </>
          )}
        </div>
        <div className="text-right">
          <p className="font-semibold tabular-nums">Rev. {String(revision.rev_number).padStart(2, "0")}</p>
          <p
            className={cn(
              "font-medium",
              !isWetInk && isApproved ? "text-emerald-700" : "text-muted-foreground",
            )}
          >
            {isWetInk
              ? "For review & approval"
              : isApproved
                ? "Approved"
                : revision.status.replace(/_/g, " ")}
          </p>
          <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">{docDate}</p>
        </div>
      </div>

      {/* Sequence — each chart page carries its own legends (in StaticGantt). The
          readiness view zooms to one year per page and shows the icons on the chart. */}
      <h2 className="mt-3 text-sm font-semibold">{isReadiness ? "Sequence readiness" : "Sequence"}</h2>
      {isReadiness ? (
        <StaticGantt rows={rows} index={index} windowYears={1} rowsPerPage={6} showReadiness dropEmptyRows />
      ) : (
        <StaticGantt rows={rows} index={index} />
      )}

      {/* Activity schedule — optional; on its own page when present. */}
      {includeSchedule && (
        <>
          <h2 className="mt-4 break-before-page text-sm font-semibold">Activity schedule</h2>
          <ScheduleTable rows={ordered} index={index} />
        </>
      )}

      {/* Sign-off — blank wet-ink lines, or the system-recorded signatures (plus the
          Document ID verify block on the JV record). */}
      {isWetInk ? (
        <ManualSignOff revision={revision} />
      ) : (
        <>
          <SignOff revision={revision} />
          {/* Authenticity — leaves the lower page free for an appended Adobe signature */}
          {isJvRecord && <VerifyBox docId={revision.integrity_digest} />}
        </>
      )}
    </div>
  );
}
