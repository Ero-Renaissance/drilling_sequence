import { useCallback, useEffect, useState } from "react";
import {
  History,
  PenLine,
  CheckCircle2,
  Trash2,
  UserPlus,
  UserMinus,
  FolderPlus,
  Copy,
  Pencil,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getProjectAudit, type AuditEntry } from "@/api/audit";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fieldLabel(field: string): string {
  return field.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function iconFor(entry: AuditEntry): LucideIcon {
  if (entry.entity_type === "revision") {
    if (entry.field === "approved") return CheckCircle2;
    if (entry.field === "discarded") return Trash2;
    return PenLine;
  }
  if (entry.entity_type === "approver") {
    return entry.field === "removed" ? UserMinus : UserPlus;
  }
  if (entry.entity_type === "project") {
    return entry.field === "cloned" ? Copy : FolderPlus;
  }
  return Pencil; // activity field edit
}

function describe(entry: AuditEntry): React.ReactNode {
  // Governance events carry a human-readable detail in new_value.
  if (entry.entity_type && entry.entity_type !== "activity") {
    return entry.new_value ?? fieldLabel(entry.field);
  }
  // Activity field edit: "Field changed old → new"
  return (
    <>
      <span className="font-medium text-foreground">{fieldLabel(entry.field)}</span>
      <span className="ml-1 text-muted-foreground">changed</span>
      {entry.old_value !== null && (
        <span className="ml-1 text-muted-foreground line-through">{entry.old_value}</span>
      )}
      <span className="mx-1 text-muted-foreground/50">→</span>
      <span className="font-medium text-foreground">{entry.new_value ?? "—"}</span>
    </>
  );
}

export function ProjectAuditLog({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await getProjectAudit(projectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load activity log");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="rounded-xl border border-border/70 bg-card shadow-soft-sm">
      <div className="flex items-center gap-2 border-b border-border/70 px-4 py-3">
        <History className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Activity log</h2>
        <span className="ml-1 text-xs font-normal text-muted-foreground">
          {entries === null ? "" : entries.length}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={load}
          disabled={loading}
          className="ml-auto text-muted-foreground"
        >
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        </Button>
      </div>

      {error && (
        <div className="px-4 py-3 text-sm text-destructive" role="alert">
          {error}
        </div>
      )}

      {entries === null && loading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : entries && entries.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          No activity recorded yet.
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {entries?.map((entry) => {
            const Icon = iconFor(entry);
            return (
              <li key={entry.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1 leading-snug">
                  <div className="truncate">{describe(entry)}</div>
                  <div className="text-xs text-muted-foreground">
                    {entry.user_name ?? "Unknown"} · {formatTime(entry.timestamp)}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
