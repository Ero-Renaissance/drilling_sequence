/**
 * The print/PDF document for a revision — a dedicated, document-first layout for
 * sharing the approved rig sequence with JV partners. Rendered print-only; the
 * interactive RevisionDetail page is hidden in print.
 *
 * Sections: title/approval block · static Gantt (sequence) · decoding legend ·
 * activity schedule table (with readiness gate icons) · formal sign-off table.
 */
import { CHECK_META, STATUS_DOT, STATUS_ICON_COLOR } from "@/components/readiness/check-meta";
import { getActivityColor } from "@/lib/chart-colors";
import { cn } from "@/lib/utils";
import type { CheckCode, CheckStatus } from "@/api/readiness";
import type { RevisionDetail } from "@/api/revisions";
import type { Project } from "@/types";

const CHECK_CODES: CheckCode[] = ["BUD", "LLI", "LOC", "FID", "EIA", "FLOOD", "SUBS", "CON"];
const STATUSES: CheckStatus[] = ["Completed", "In Progress", "Behind", "Not Started", "N/A"];
const WINDOW_YEARS = 2; // sequence paginates into ≤2-year windows so bar labels stay legible
const RIG_COL = "11rem"; // "Terrain – Rig" label column width
// Terrain order on the chart: land rigs, then swamp, then offshore.
const TERRAIN_ORDER: Record<string, number> = { LAND: 0, SWAMP: 1, OFFSHORE: 2 };

function terrainRank(loc: string | null | undefined): number {
  return TERRAIN_ORDER[(loc ?? "").trim().toUpperCase()] ?? 99;
}

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
  rig_name: string | null;
  location: string | null; // terrain (LAND / SWAMP / OFFSHORE)
  plan_type: string | null;
  risk: string | null;
  readiness?: Record<string, CheckStatus>;
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

// ── Static Gantt — clean bars on a year grid, paginated by 2-year windows ──────

function StaticGantt({ rows, index }: { rows: PrintRow[]; index: Map<string, number> }) {
  const acts = rows
    .map((r) => ({ ...r, s: parse(r.start_date), e: parse(r.end_date) }))
    .filter((a): a is PrintRow & { s: Date; e: Date } => a.s !== null && a.e !== null);
  if (acts.length === 0) return null;

  const startYear = new Date(Math.min(...acts.map((a) => a.s.getTime()))).getFullYear();
  const endYear = new Date(Math.max(...acts.map((a) => a.e.getTime()))).getFullYear();

  // Rows = terrain + rig, ordered Land → Swamp → Offshore, then rig.
  const meta = new Map<string, { loc: string | null; rig: string | null }>();
  for (const a of acts) {
    const k = rowLabel(a.location, a.rig_name);
    if (!meta.has(k)) meta.set(k, { loc: a.location, rig: a.rig_name });
  }
  const rowKeys = Array.from(meta.keys()).sort((ka, kb) => {
    const A = meta.get(ka)!;
    const B = meta.get(kb)!;
    const d = terrainRank(A.loc) - terrainRank(B.loc);
    return d !== 0 ? d : (A.rig ?? "").localeCompare(B.rig ?? "");
  });

  const windows: { from: Date; to: Date }[] = [];
  for (let y = startYear; y <= endYear; y += WINDOW_YEARS) {
    windows.push({ from: new Date(y, 0, 1), to: new Date(Math.min(y + WINDOW_YEARS, endYear + 1), 0, 1) });
  }
  const now = Date.now();

  return (
    <>
      {windows.map((w, wi) => {
        const winStart = w.from.getTime();
        const winSpan = w.to.getTime() - winStart;
        const years: number[] = [];
        for (let y = w.from.getFullYear(); y < w.to.getFullYear(); y++) years.push(y);
        const todayPct =
          now >= winStart && now < w.to.getTime() ? ((now - winStart) / winSpan) * 100 : null;
        return (
          <div key={wi} className={cn("mt-3", wi > 0 && "break-before-page")}>
            {wi > 0 && (
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Sequence (continued)
              </p>
            )}
            <div className="overflow-hidden rounded-md border border-border bg-zinc-50">
              {/* Year axis */}
              <div className="flex h-5 border-b border-border bg-zinc-100 text-[9px] tabular-nums text-muted-foreground">
                <div className="shrink-0" style={{ width: RIG_COL }} />
                <div className="relative h-full flex-1">
                  {years.map((y) => {
                    const left = ((new Date(y, 0, 1).getTime() - winStart) / winSpan) * 100;
                    return (
                      <span key={y} className="absolute top-0.5 -translate-x-1/2 px-1" style={{ left: `${left}%` }}>
                        {y}
                      </span>
                    );
                  })}
                </div>
              </div>
              {/* Rows + a gridline / today overlay across the plot area */}
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 right-0" style={{ left: RIG_COL }}>
                  {years.map((y) => {
                    const left = ((new Date(y, 0, 1).getTime() - winStart) / winSpan) * 100;
                    return left > 0.5 && left < 99.5 ? (
                      <div key={y} className="absolute inset-y-0 w-px bg-border/60" style={{ left: `${left}%` }} />
                    ) : null;
                  })}
                  {todayPct !== null && (
                    <div
                      className="absolute inset-y-0 border-l border-dashed border-red-400/70"
                      style={{ left: `${todayPct}%` }}
                    />
                  )}
                </div>
                {rowKeys.map((key) => (
                  <div key={key} className="flex h-10 items-stretch border-b border-border/40 last:border-b-0">
                    <div
                      className="flex shrink-0 items-center truncate border-r border-border/60 px-2 text-[9px] font-medium text-foreground"
                      style={{ width: RIG_COL }}
                    >
                      {key}
                    </div>
                    <div className="relative flex-1">
                      {acts
                        .filter(
                          (a) =>
                            rowLabel(a.location, a.rig_name) === key &&
                            a.e.getTime() > winStart &&
                            a.s.getTime() < w.to.getTime(),
                        )
                        .map((a) => {
                          const l = Math.max(0, ((a.s.getTime() - winStart) / winSpan) * 100);
                          const r = Math.min(100, ((a.e.getTime() - winStart) / winSpan) * 100);
                          const wpct = Math.max(0.8, r - l);
                          const n = index.get(a.id);
                          // Every bar carries its schedule number — legible even a few days
                          // wide (a min-width keeps the digit from being clipped). The well
                          // name rides along only when the bar is wide enough; full names
                          // live in the numbered schedule table, keyed by the same number.
                          const showName = wpct >= 10 && !!a.well_name;
                          return (
                            <span
                              key={a.id}
                              title={`#${n ?? "?"} · ${a.activity_type}${a.well_name ? ` · ${a.well_name}` : ""}`}
                              className="absolute top-1/2 flex h-6 -translate-y-1/2 items-center justify-center gap-1 overflow-hidden rounded px-1 text-[8px] font-semibold text-white"
                              style={{ left: `${l}%`, width: `${wpct}%`, minWidth: "1.15rem", backgroundColor: getActivityColor(a.activity_type) }}
                            >
                              <span className="shrink-0 tabular-nums">{n}</span>
                              {showName && <span className="truncate font-medium opacity-90">{a.well_name}</span>}
                            </span>
                          );
                        })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* The colour key rides with the chart so every chart page is self-decoding. */}
            <ActivityLegend rows={rows} />
          </div>
        );
      })}
    </>
  );
}

// ── Legends — chart colours go with the chart; readiness icons with the table ──

function ActivityLegend({ rows }: { rows: PrintRow[] }) {
  const types = Array.from(new Set(rows.map((r) => r.activity_type).filter(Boolean))).sort();
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-zinc-50 px-3 py-2 text-[9px] print:break-inside-avoid">
      <span className="font-semibold uppercase tracking-wider text-muted-foreground">Activity</span>
      {types.map((t) => (
        <span key={t} className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: getActivityColor(t) }} />
          {t}
        </span>
      ))}
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
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

function ReadinessIcons({ readiness }: { readiness?: Record<string, CheckStatus> }) {
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

function ScheduleTable({ rows, index }: { rows: PrintRow[]; index: Map<string, number> }) {
  return (
    <table className="w-full border-collapse text-[9.5px]">
      {/* Both rows sit in <thead> (table-header-group) so the readiness key AND the
          column labels reprint at the top of every table page. */}
      <thead>
        <tr>
          <td colSpan={10} className="pb-2 pt-1">
            <ReadinessKey />
          </td>
        </tr>
        <tr className="bg-muted/40 text-left text-[8px] uppercase tracking-wider text-muted-foreground">
          {["#", "Activity", "Well", "Terrain", "Rig", "Start", "End", "Plan", "Risk", "Readiness"].map((h) => (
            <th key={h} className="px-1.5 py-1">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="px-1.5 py-1 tabular-nums font-semibold text-foreground">{index.get(r.id)}</td>
            <td className="px-1.5 py-1 font-medium text-foreground">{r.activity_type}</td>
            <td className="px-1.5 py-1 text-muted-foreground">{r.well_name ?? "—"}</td>
            <td className="px-1.5 py-1 text-muted-foreground">{r.location ?? "—"}</td>
            <td className="px-1.5 py-1 text-muted-foreground">{r.rig_name ?? "—"}</td>
            <td className="px-1.5 py-1 tabular-nums text-muted-foreground">{fmt(r.start_date)}</td>
            <td className="px-1.5 py-1 tabular-nums text-muted-foreground">{fmt(r.end_date)}</td>
            <td className="px-1.5 py-1 text-muted-foreground">{r.plan_type ?? "—"}</td>
            <td className="px-1.5 py-1 text-muted-foreground">{r.risk ?? "—"}</td>
            <td className="px-1.5 py-1">
              <ReadinessIcons readiness={r.readiness} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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

// ── The document ───────────────────────────────────────────────────────────────

export function RevisionPrintDoc({
  revision,
  project,
  rows,
}: {
  revision: RevisionDetail;
  project: Project | null;
  rows: PrintRow[];
}) {
  const isApproved = revision.status === "approved";
  const docRef = `RAEC/DS/${(project?.name ?? "SEQUENCE")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}/REV${String(revision.rev_number).padStart(2, "0")}`;

  // One stable number per activity, shared by the Gantt bars and the table "#" column.
  const ordered = orderRows(rows);
  const index = new Map(ordered.map((r, i) => [r.id, i + 1]));

  // Controlled-document date: when approved, the latest approval signature; otherwise
  // the print date, clearly labelled as generated (not a formal approval date).
  const approvedAt = isApproved
    ? revision.signatures.reduce<string | null>(
        (latest, s) => (latest === null || s.signed_at > latest ? s.signed_at : latest),
        null,
      )
    : null;
  const docDate = approvedAt
    ? `Approved ${fmt(approvedAt)}`
    : `Generated ${new Date().toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}`;

  return (
    // Internal padding guarantees visible whitespace even when the browser print
    // dialog overrides the @page margin (the "Margins: None/Default" trap).
    <div className="relative hidden px-[6mm] py-[4mm] text-foreground print:block">
      {/* Watermark — anything not approved must be unmistakable as non-final. */}
      {!isApproved && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
          <span className="rotate-[-28deg] text-center text-[64px] font-black uppercase leading-none tracking-widest text-red-500/15">
            Draft
            <br />
            Not for distribution
          </span>
        </div>
      )}

      {/* Title / approval block */}
      <div className="flex items-end justify-between gap-6">
        <img src="/raec-logo.png" alt="Renaissance Africa Energy" className="h-11 w-auto" />
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Renaissance Africa Energy Company Limited
          </p>
          <h1 className="text-xl font-bold tracking-tight">
            Rig Sequence — {isApproved ? "Approved Sequence" : "Draft (Not for distribution)"}
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
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">Ref {docRef}</p>
        </div>
        <div className="text-right">
          <p className="font-semibold tabular-nums">Rev. {String(revision.rev_number).padStart(2, "0")}</p>
          <p className={cn("font-medium", isApproved ? "text-emerald-700" : "text-muted-foreground")}>
            {isApproved ? "Approved" : revision.status.replace(/_/g, " ")}
          </p>
          <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">{docDate}</p>
        </div>
      </div>

      {/* Sequence — each chart page carries its own activity colour key (in StaticGantt) */}
      <h2 className="mt-3 text-sm font-semibold">Sequence</h2>
      <StaticGantt rows={rows} index={index} />

      {/* Activity schedule — on its own page; the readiness key reprints in the table header */}
      <h2 className="mt-4 break-before-page text-sm font-semibold">Activity schedule</h2>
      <ScheduleTable rows={ordered} index={index} />

      {/* Formal sign-off */}
      <SignOff revision={revision} />
    </div>
  );
}
