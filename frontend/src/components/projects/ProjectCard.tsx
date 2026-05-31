import { useNavigate } from "react-router-dom";
import { MapPin, Users, Calendar, Archive, ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { CloneProjectDialog } from "@/components/projects/CloneProjectDialog";
import type { Project } from "@/types";

interface ProjectCardProps {
  project: Project;
  onArchive?: (id: string) => void;
}

export function ProjectCard({ project, onArchive }: ProjectCardProps) {
  const navigate = useNavigate();
  const plannerCount = project.members.filter((m) => m.role === "planner").length;

  return (
    <Card
      className="group relative cursor-pointer overflow-hidden transition-all hover:-translate-y-0.5 hover:border-border hover:shadow-soft-md"
      onClick={() => navigate(`/projects/${project.id}/overview`)}
      data-testid="project-card"
    >
      {/* Top accent stripe */}
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/80 via-primary to-amber-600" />

      <CardContent className="space-y-4 p-5 pt-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold tracking-tight">{project.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {project.field && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {project.field}
                </span>
              )}
              {project.region && (
                <Badge variant="outline" className="text-[10px] font-normal">
                  {project.region}
                </Badge>
              )}
              {plannerCount > 0 && (
                <Badge variant="secondary" className="text-[10px] font-normal">
                  {plannerCount} planner{plannerCount !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <CloneProjectDialog project={project} />
            {onArchive && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  onArchive(project.id);
                }}
                title="Archive project"
              >
                <Archive className="h-3.5 w-3.5" />
              </Button>
            )}
            <ArrowUpRight className="h-4 w-4 text-muted-foreground/60" />
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center justify-between gap-3 border-t border-border/70 pt-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            <span className="tabular-nums">{project.members.length}</span>
            member{project.members.length !== 1 ? "s" : ""}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" />
            {formatDate(project.created_at)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
