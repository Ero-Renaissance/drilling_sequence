import { Fragment, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useProjectsStore } from "@/store/projects";

const STATIC_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  projects: "Campaigns",
  chart: "Sequence",
  data: "Activities",
  readiness: "Readiness",
  signatures: "Approvals",
  revisions: "Revisions",
};

interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const projects = useProjectsStore((s) => s.projects);

  const crumbs = useMemo<Crumb[]>(() => {
    const parts = pathname.split("/").filter(Boolean);
    const out: Crumb[] = [];
    let accumulated = "";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      accumulated += `/${part}`;
      const prev = parts[i - 1];

      let label = STATIC_LABELS[part];

      if (!label && prev === "projects") {
        const project = projects.find((p) => p.id === part);
        label = project?.name ?? "Campaign";
      } else if (!label && prev === "revisions") {
        label = "Revision";
      } else if (!label) {
        label = part.charAt(0).toUpperCase() + part.slice(1);
      }

      out.push({ label, to: i < parts.length - 1 ? accumulated : undefined });
    }

    return out;
  }, [pathname, projects]);

  if (crumbs.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm">
      {crumbs.map((crumb, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" strokeWidth={2} />
          )}
          {crumb.to ? (
            <Link
              to={crumb.to}
              className="rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              {crumb.label}
            </Link>
          ) : (
            <span className="px-1.5 py-0.5 font-medium text-foreground">{crumb.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
