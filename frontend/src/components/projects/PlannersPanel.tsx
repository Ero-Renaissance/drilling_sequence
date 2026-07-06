import { useCallback, useEffect, useState } from "react";
import { ClipboardList, Plus, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { projectsApi } from "@/api/projects";
import { useAuthStore } from "@/store/auth";
import type { Project } from "@/types";

function initials(value: string): string {
  return value
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

interface PlannersPanelProps {
  projectId: string;
}

/** The campaign's planners — visible to everyone (org-wide read); add/remove
 *  restricted to the campaign's planners and admins. The strict rule (a
 *  co-planner must hold the global planner grant) is enforced server-side;
 *  a 409 from the backend surfaces as a toast. */
export function PlannersPanel({ projectId }: PlannersPanelProps) {
  const user = useAuthStore((s) => s.user);
  const [project, setProject] = useState<Project | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setProject(await projectsApi.get(projectId));
    } catch {
      /* non-critical panel; the page's main content reports load errors */
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const planners = (project?.members ?? []).filter((m) => m.role === "planner");
  const canManage =
    !!user &&
    (user.is_admin ||
      (user.can_plan && planners.some((m) => m.user_id === user.id)));

  async function add() {
    const value = email.trim();
    if (!value) return;
    setBusy(true);
    try {
      const updated = await projectsApi.addPlanner(projectId, value);
      setProject(updated);
      setEmail("");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to add planner");
    } finally {
      setBusy(false);
    }
  }

  async function remove(userId: string) {
    setBusy(true);
    try {
      await projectsApi.removePlanner(projectId, userId);
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to remove planner");
    } finally {
      setBusy(false);
    }
  }

  if (!project) return null;

  return (
    <div className="rounded-xl border border-border/70 bg-card shadow-soft-sm">
      <div className="flex items-center gap-2 border-b border-border/70 px-4 py-3">
        <ClipboardList className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">
          Planners
          <span className="ml-2 font-normal text-muted-foreground">{planners.length}</span>
        </h2>
      </div>

      <ul className="divide-y divide-border/60">
        {planners.map((m) => (
          <li key={m.user_id} className="flex items-center gap-3 px-4 py-2.5">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary/15 text-xs text-primary">
                {initials(m.user_name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm font-medium">{m.user_name}</div>
              <div className="truncate text-xs text-muted-foreground">{m.user_email}</div>
            </div>
            {canManage && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground"
                disabled={busy || planners.length <= 1}
                title={
                  planners.length <= 1
                    ? "A campaign must keep at least one planner"
                    : "Remove planner"
                }
                onClick={() => remove(m.user_id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </li>
        ))}
      </ul>

      {canManage && (
        <div className="flex items-center gap-2 border-t border-border/70 px-4 py-3">
          <Input
            type="email"
            placeholder="colleague@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            className="h-8 max-w-xs text-sm"
          />
          <Button size="sm" disabled={busy || !email.trim()} onClick={add}>
            <Plus className="h-3.5 w-3.5" />
            Add planner
          </Button>
          <span className="hidden text-xs text-muted-foreground sm:block">
            Must already hold the planner grant (Admin page).
          </span>
        </div>
      )}
    </div>
  );
}
