import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  FolderOpen,
  AlertTriangle,
  ArrowUpRight,
  ChevronRight,
  Gauge,
  ListChecks,
  Factory,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectsStore } from "@/store/projects";
import { useAuthStore } from "@/store/auth";
import { getLastApprovedDashboard, type LastApprovedDashboard } from "@/api/me";
import { cn } from "@/lib/utils";

type KpiTone = "primary" | "info" | "warning" | "success";

const TONE_STYLES: Record<KpiTone, { bubble: string; icon: string }> = {
  primary: { bubble: "bg-primary/10", icon: "text-primary" },
  info: { bubble: "bg-info/10", icon: "text-info" },
  warning: { bubble: "bg-warning/15", icon: "text-warning dark:text-warning" },
  success: { bubble: "bg-success/12", icon: "text-success" },
};

function KpiCard({
  title,
  value,
  icon: Icon,
  description,
  tone = "primary",
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  description?: string;
  tone?: KpiTone;
}) {
  const styles = TONE_STYLES[tone];
  return (
    <Card className="hover:shadow-soft-md transition-shadow">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 p-5 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {title}
          </CardTitle>
        </div>
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", styles.bubble)}>
          <Icon className={cn("h-[18px] w-[18px]", styles.icon)} strokeWidth={2.25} />
        </div>
      </CardHeader>
      <CardContent className="p-5 pt-0">
        <div className="text-3xl font-semibold tabular-nums tracking-tight">{value}</div>
        {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      </CardContent>
    </Card>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// The canonical rev identifier — not the free-text label, which can be anything
// (e.g. "Draft") and reads as misleading next to "approved" on a summary banner.
function revLabel(d: LastApprovedDashboard): string {
  return `Rev. ${String(d.rev_number ?? 0).padStart(2, "0")}`;
}

// ── Most-recently-approved KPI section ────────────────────────────────────────

function ApprovedKpis({ d }: { d: LastApprovedDashboard }) {
  const k = d.kpis!;
  const span =
    k.schedule_start && k.schedule_end
      ? `${fmtDate(k.schedule_start)} – ${fmtDate(k.schedule_end)}`
      : "In the approved sequence";
  return (
    <div className="space-y-4">
      {/* Context — which approved sequence these KPIs reflect */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-success/25 bg-success/[0.05] px-4 py-2.5 text-sm">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
        <span className="font-medium text-muted-foreground">Most recently approved:</span>
        {d.project_id ? (
          <Link
            to={`/projects/${d.project_id}/overview`}
            className="font-semibold text-foreground hover:underline"
          >
            {d.project_name}
          </Link>
        ) : (
          <span className="font-semibold text-foreground">{d.project_name}</span>
        )}
        <span className="text-muted-foreground/60">·</span>
        <span className="text-foreground">{revLabel(d)}</span>
        <span className="text-muted-foreground/60">·</span>
        <span className="text-muted-foreground">
          approved {fmtDate(d.approved_at)}
          {d.approved_by ? ` by ${d.approved_by}` : ""}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          title="Readiness"
          value={k.readiness_pct === null ? "—" : `${k.readiness_pct}%`}
          icon={Gauge}
          description="Approved plan · next 12 months"
          tone="success"
        />
        <KpiCard
          title="Activities"
          value={k.activities_total}
          icon={ListChecks}
          description={span}
          tone="primary"
        />
        <KpiCard
          title="Rigs in use"
          value={k.rigs_in_use}
          icon={Factory}
          description="Rigs in the approved plan"
          tone="info"
        />
        <KpiCard
          title="Contracts at risk"
          value={k.contracts_at_risk}
          icon={AlertTriangle}
          description="Expired or expiring within 90 days"
          tone="warning"
        />
      </div>
    </div>
  );
}

export function Dashboard() {
  const user = useAuthStore((s) => s.user);
  const { projects, loading, fetchProjects } = useProjectsStore();
  const [lastApproved, setLastApproved] = useState<LastApprovedDashboard | null>(null);
  const [kpiLoading, setKpiLoading] = useState(true);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    let cancelled = false;
    setKpiLoading(true);
    getLastApprovedDashboard()
      .then((d) => {
        if (!cancelled) setLastApproved(d);
      })
      .catch(() => {
        if (!cancelled) setLastApproved(null);
      })
      .finally(() => {
        if (!cancelled) setKpiLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeProjects = projects.filter((p) => p.status === "active");

  return (
    <div className="space-y-8">
      {/* Greeting */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome back{user ? `, ${user.name.split(" ")[0]}` : ""}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The state of your most recently approved rig sequence
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/projects">
            View all projects
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>

      {/* Most-recently-approved KPIs */}
      {kpiLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="p-5 pb-2">
                <Skeleton className="h-3 w-24" />
              </CardHeader>
              <CardContent className="p-5 pt-0">
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : lastApproved?.available && lastApproved.kpis ? (
        <ApprovedKpis d={lastApproved} />
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
              <CheckCircle2 className="h-5 w-5 text-primary" />
            </div>
            <p className="font-medium">No approved sequence yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Once a revision is approved, its KPIs will appear here. Submit a plan for
              approval from a project&apos;s Approvals tab.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Recent projects */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">Recent Projects</h2>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : activeProjects.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <FolderOpen className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="font-medium">No projects yet</p>
                <p className="text-sm text-muted-foreground">
                  Create your first drilling campaign to get started
                </p>
              </div>
              <Button asChild>
                <Link to="/projects">Go to Projects</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-soft-sm">
            <ul className="divide-y divide-border/70">
              {activeProjects.slice(0, 5).map((project) => (
                <li key={project.id}>
                  <Link
                    to={`/projects/${project.id}/overview`}
                    className="group flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-accent/40"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 text-primary">
                        <FolderOpen className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{project.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[project.field, project.region].filter(Boolean).join(" · ") ||
                            "No location set"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
                        {project.members.length} member
                        {project.members.length !== 1 ? "s" : ""}
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
