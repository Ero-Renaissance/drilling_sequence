import { useEffect, useState } from "react";
import { History, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getActivityHistory, type AuditEntry } from "@/api/audit";

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function fieldLabel(field: string): string {
  return field.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface HistoryPanelProps {
  projectId: string;
  activityId: string;
  activityLabel: string;
  onClose: () => void;
}

export function HistoryPanel({ projectId, activityId, activityLabel, onClose }: HistoryPanelProps) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getActivityHistory(projectId, activityId)
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [projectId, activityId]);

  return (
    <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <History className="h-4 w-4 text-slate-400" />
          Change history — <span className="text-slate-500">{activityLabel}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-6 w-6 p-0 text-slate-400">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {loading ? (
        <p className="py-4 text-center text-xs text-slate-400">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-400">No changes recorded yet.</p>
      ) : (
        <div className="max-h-48 overflow-y-auto space-y-1">
          {entries.map((e) => (
            <div
              key={e.id}
              className="flex items-start gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"
            >
              <div className="min-w-0 flex-1">
                <span className="font-medium text-slate-700">{fieldLabel(e.field)}</span>
                <span className="ml-1 text-slate-400">changed</span>
                {e.old_value !== null && (
                  <span className="ml-1 line-through text-slate-400">{e.old_value}</span>
                )}
                <span className="mx-1 text-slate-300">→</span>
                <span className="font-medium text-slate-800">{e.new_value ?? "—"}</span>
              </div>
              <div className="shrink-0 text-right text-slate-400">
                <div>{e.user_name ?? "Unknown"}</div>
                <div>{relativeTime(e.timestamp)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
