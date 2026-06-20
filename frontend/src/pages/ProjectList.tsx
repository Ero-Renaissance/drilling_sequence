import { useEffect } from "react";
import { FolderOpen, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { CreateProjectDialog } from "@/components/projects/CreateProjectDialog";
import { useProjectsStore } from "@/store/projects";
import { useState } from "react";

export function ProjectList() {
  const { projects, loading, fetchProjects, archiveProject } = useProjectsStore();
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const filtered = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.field?.toLowerCase().includes(search.toLowerCase()) ||
      p.region?.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Campaigns</h1>
          <p className="text-sm text-muted-foreground">
            {projects.length} active drilling campaign{projects.length !== 1 ? "s" : ""}
          </p>
        </div>
        <CreateProjectDialog />
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search campaigns..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <FolderOpen className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="font-medium">
                {search ? "No campaigns match your search" : "No campaigns yet"}
              </p>
              <p className="text-sm text-muted-foreground">
                {search
                  ? "Try a different keyword"
                  : "Create your first campaign to start planning your rig sequence"}
              </p>
            </div>
            {!search && <CreateProjectDialog />}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onArchive={archiveProject}
            />
          ))}
        </div>
      )}
    </div>
  );
}
