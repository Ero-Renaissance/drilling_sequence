import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  Plus,
  RefreshCw,
  Trash2,
  UserCheck,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  listApprovers,
  addApprover,
  removeApprover,
  type Approver,
} from "@/api/approvers";

function initials(value: string): string {
  return value
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

interface ApproverSettingsProps {
  projectId: string;
}

export function ApproverSettings({ projectId }: ApproverSettingsProps) {
  const [approvers, setApprovers] = useState<Approver[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Disclosure — open by default so required approvers stay visible
  const [expanded, setExpanded] = useState(true);

  // Add-form state
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [roleLabel, setRoleLabel] = useState("Approver");
  const [adding, setAdding] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listApprovers(projectId);
      setApprovers(list);
      // Auto-expand when nothing's set up yet — the user clearly needs to act
      if (list.length === 0) setExpanded(true);
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const a = await addApprover(projectId, {
        email: email.trim(),
        name: name.trim() || undefined,
        role_label: roleLabel.trim() || "Approver",
      });
      setApprovers((prev) => [...prev, a]);
      setEmail("");
      setName("");
      setRoleLabel("Approver");
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add approver");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(approver: Approver) {
    try {
      await removeApprover(projectId, approver.id);
      setApprovers((prev) => prev.filter((a) => a.id !== approver.id));
    } catch {
      setError("Failed to remove approver");
    }
  }

  return (
    <div className="rounded-xl border border-border/70 bg-card shadow-soft-sm">
      {/* Header — clickable to toggle */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/30 rounded-t-xl"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <UserCheck className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">Required Approvers</h2>
          <p className="text-xs text-muted-foreground">
            {approvers.length === 0
              ? "Add at least one approver — revisions can't be approved until all sign"
              : `${approvers.length} required · revision is approved when all sign`}
          </p>
        </div>
        {loading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded && (
        <div className="border-t border-border/70 px-4 py-3">
          {error && (
            <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Approver chips */}
          {approvers.length > 0 && (
            <ul className="mb-3 space-y-1.5">
              {approvers.map((a) => (
                <li
                  key={a.id}
                  className="group flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm transition-colors hover:border-border"
                >
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="bg-primary/15 text-[10px] text-primary">
                      {initials(a.name ?? a.email)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="truncate font-medium text-foreground">
                      {a.name ?? a.email.split("@")[0]}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{a.email}</div>
                  </div>
                  <span className="shrink-0 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {a.role_label}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemove(a)}
                    className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    title="Remove approver"
                    data-testid="remove-approver"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Add form / trigger */}
          {showForm ? (
            <form
              onSubmit={handleAdd}
              className="space-y-2 rounded-lg border border-primary/25 bg-primary/[0.04] p-3"
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Input
                  type="email"
                  placeholder="email@company.com *"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  data-testid="approver-email-input"
                />
                <Input
                  type="text"
                  placeholder="Display name (optional)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <Input
                  type="text"
                  placeholder="Role (e.g. PM)"
                  value={roleLabel}
                  onChange={(e) => setRoleLabel(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={adding || !email.trim()}>
                  {adding ? "Adding…" : "Add approver"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowForm(false);
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
              data-testid="add-approver-btn"
            >
              <Plus className="h-3.5 w-3.5" />
              Add approver
            </button>
          )}
        </div>
      )}
    </div>
  );
}
