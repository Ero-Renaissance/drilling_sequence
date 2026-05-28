import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  FolderOpen,
  AlertTriangle,
  Clock,
  Activity,
  ArrowUpRight,
  ChevronRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectsStore } from "@/store/projects";
import { useAuthStore } from "@/store/auth";
import { listContracts } from "@/api/contracts";
import { getPendingApprovals } from "@/api/me";
import { cn } from "@/lib/utils";

type KpiTone = "primary" | "info" | "warning" | "success";

const TONE_STYLES: Record<KpiTone, { bubble: string; icon: string }> = {
  primary: {
    bubble: "bg-primary/10",
    icon: "text-primary",
  },
  info: {
    bubble: "bg-info/10",
    icon: "text-info",
  },
  warning: {
    bubble: "bg-warning/15",
    icon: "text-warning dark:text-warning",
  },
  success: {
    bubble: "bg-success/12",
    icon: "text-success",
  },
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
        {description && (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function Dashboard() {
  const user = useAuthStore((s) => s.user);
  const { projects, loading, fetchProjects } = useProjectsStore();
  const [contractAlerts, setContractAlerts] = useState<number | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<number | null>(null);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    let cancelled = false;
    getPendingApprovals()
      .then((items) => {
        if (!cancelled) setPendingApprovals(items.length);
      })
      .catch(() => {
        if (!cancelled) setPendingApprovals(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeProjects = projects.filter((p) => p.status === "active");

  // Count distinct rigs (across active projects) whose contract expires within 90 days.
  useEffect(() => {
    if (activeProjects.length === 0) {
      setContractAlerts(0);
      return;
    }
    let cancelled = false;
    (async () => {
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + 90);
      const seen = new Set<string>();

      const results = await Promise.all(
        activeProjects.map((p) => listContracts(p.id).catch(() => [])),
      );

      results.forEach((contracts, i) => {
        const pid = activeProjects[i].id;
        for (const c of contracts) {
          // Only count in-force contracts — draft / not-started / N/A contracts
          // don't have a real expiry to alert on.
          if (c.status !== "Completed") continue;
          if (!c.contract_end) continue;
          // Counts both expiring-soon (end within next 90d) and already expired.
          if (new Date(c.contract_end) <= horizon) {
            seen.add(`${pid}:${c.rig_name}`);
          }
        }
      });

      if (!cancelled) setContractAlerts(seen.size);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProjects]);

  return (
    <div className="space-y-8">
      {/* Greeting */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome back{user ? `, ${user.name.split(" ")[0]}` : ""}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Here&apos;s an overview of your drilling campaigns
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/projects">
            View all projects
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="p-5 pb-2">
                <Skeleton className="h-3 w-24" />
              </CardHeader>
              <CardContent className="p-5 pt-0">
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <KpiCard
              title="Active Projects"
              value={activeProjects.length}
              icon={FolderOpen}
              description="Drilling campaigns in progress"
              tone="primary"
            />
            <KpiCard
              title="Total Members"
              value={
                new Set(activeProjects.flatMap((p) => p.members.map((m) => m.user_id))).size
              }
              icon={Activity}
              description="Across all active projects"
              tone="info"
            />
            <KpiCard
              title="Pending Approvals"
              value={pendingApprovals ?? "—"}
              icon={Clock}
              description="Revisions awaiting your sign-off"
              tone="warning"
            />
            <KpiCard
              title="Contract Alerts"
              value={contractAlerts ?? "—"}
              icon={AlertTriangle}
              description="Rigs expiring within 90 days"
              tone="warning"
            />
          </>
        )}
      </div>

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
                    to={`/projects/${project.id}/chart`}
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
