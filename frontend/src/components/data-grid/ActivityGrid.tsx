import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
  type RowData,
} from "@tanstack/react-table";
import { ArrowUpDown, ArrowUp, ArrowDown, Trash2, RefreshCw, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  listActivities,
  updateActivity,
  deleteActivity,
  ConflictError,
  type Activity,
} from "@/api/activities";
import {
  CHECK_CODES,
  listReadiness,
  upsertCheck,
  type CheckCode,
  type CheckState,
  type CheckStatus,
} from "@/api/readiness";
import { ReadinessDot } from "@/components/readiness/ReadinessDot";
import { ContractEditorDialog } from "@/components/readiness/ContractEditorDialog";
import { EditableCell } from "./EditableCell";
import { ActivityFormDialog, LOCATIONS, PLAN_TYPES, RISKS } from "./ActivityFormDialog";
import { HistoryPanel } from "@/components/activity/HistoryPanel";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface TableMeta<TData extends RowData> {
    updateCell: (id: string, field: keyof Activity, value: string | null) => void;
    deleteRow: (id: string) => void;
    openHistory: (id: string) => void;
    readinessByActivity: Map<string, Record<CheckCode, CheckState>>;
    onReadinessChange: (activityId: string, code: CheckCode, next: CheckStatus) => void;
    onEditContract: (rigName: string | null) => void;
    savingReadinessKey: string | null;
  }
}

const helper = createColumnHelper<Activity>();

function SortIcon({ sorted }: { sorted: false | "asc" | "desc" }) {
  if (sorted === "asc") return <ArrowUp className="ml-1 inline h-3 w-3" />;
  if (sorted === "desc") return <ArrowDown className="ml-1 inline h-3 w-3" />;
  return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-40" />;
}

function relativeTime(iso: string | undefined): string {
  if (!iso) return "";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── Chips for Risk and Plan Type display ─────────────────────────────────────

function RiskChip({ value }: { value: string | null }) {
  if (!value) return <span className="text-xs italic text-muted-foreground/60">—</span>;
  const map: Record<string, string> = {
    Low: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25",
    Medium: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30",
    High: "bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/30",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        map[value] ?? "bg-muted text-muted-foreground",
      )}
    >
      {value}
    </span>
  );
}

function PlanTypeChip({ value }: { value: string | null }) {
  if (!value) return <span className="text-xs italic text-muted-foreground/60">—</span>;
  const isFirm = value === "Firm";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium",
        isFirm
          ? "bg-primary/10 text-primary border border-primary/20"
          : "border border-border text-muted-foreground",
      )}
    >
      {value}
    </span>
  );
}

// ── Readiness inline strip ───────────────────────────────────────────────────

function ReadinessStrip({
  activityId,
  rigName,
  checks,
  onChange,
  onEditContract,
  savingKey,
}: {
  activityId: string;
  rigName: string | null;
  checks: Record<CheckCode, CheckState> | undefined;
  onChange: (code: CheckCode, next: CheckStatus) => void;
  onEditContract: (rigName: string | null) => void;
  savingKey: string | null;
}) {
  if (!checks) {
    return (
      <div className="flex items-center gap-1 px-2 text-xs text-muted-foreground/60">
        <span className="italic">no checks</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-0.5 px-1">
      {CHECK_CODES.map((code) => {
        if (code === "CON") {
          return (
            <ReadinessDot
              key={code}
              code={code}
              status={checks[code].status}
              size="sm"
              onClick={() => onEditContract(rigName)}
              disabled={!rigName}
            />
          );
        }
        return (
          <ReadinessDot
            key={code}
            code={code}
            status={checks[code].status}
            size="sm"
            onChange={(next) => onChange(code, next)}
            disabled={savingKey === `${activityId}:${code}`}
          />
        );
      })}
    </div>
  );
}

interface ActivityGridProps {
  projectId: string;
}

export function ActivityGrid({ projectId }: ActivityGridProps) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [readinessByActivity, setReadinessByActivity] = useState<
    Map<string, Record<CheckCode, CheckState>>
  >(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [historyActivityId, setHistoryActivityId] = useState<string | null>(null);
  const [savingReadinessKey, setSavingReadinessKey] = useState<string | null>(null);
  const [editingContractRig, setEditingContractRig] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [acts, readiness] = await Promise.all([
        listActivities(projectId),
        listReadiness(projectId).catch(() => []),
      ]);
      setActivities(acts);
      setReadinessByActivity(new Map(readiness.map((r) => [r.activity_id, r.checks])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load activities");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const updateCell = useCallback(
    async (id: string, field: keyof Activity, value: string | null) => {
      const prev = activities.find((a) => a.id === id);
      if (!prev) return;

      setActivities((all) => all.map((a) => (a.id === id ? { ...a, [field]: value } : a)));
      try {
        const updated = await updateActivity(
          projectId,
          id,
          { [field]: value } as Record<string, unknown>,
          prev.updated_at,
        );
        setActivities((all) => all.map((a) => (a.id === id ? { ...a, ...updated } : a)));
      } catch (err) {
        setActivities((all) => all.map((a) => (a.id === id ? prev : a)));
        if (err instanceof ConflictError) {
          setError(
            `Conflict: ${err.updatedBy} modified this activity after you loaded it. Refresh to see the latest version.`,
          );
        } else {
          setError(`Failed to save "${String(field).replace(/_/g, " ")}". Change reverted.`);
        }
      }
    },
    [activities, projectId],
  );

  const deleteRow = useCallback(
    async (id: string) => {
      const prev = [...activities];
      setActivities((all) => all.filter((a) => a.id !== id));
      try {
        await deleteActivity(projectId, id);
      } catch {
        setActivities(prev);
        setError("Failed to delete activity.");
      }
    },
    [activities, projectId],
  );

  const openHistory = useCallback((id: string) => {
    setHistoryActivityId((prev) => (prev === id ? null : id));
  }, []);

  const onReadinessChange = useCallback(
    async (activityId: string, code: CheckCode, next: CheckStatus) => {
      const key = `${activityId}:${code}`;
      const checks = readinessByActivity.get(activityId);
      if (!checks) return;
      const previous = checks[code].status;

      // Optimistic update
      setReadinessByActivity((prev) => {
        const updated = new Map(prev);
        const existing = updated.get(activityId);
        if (existing) {
          updated.set(activityId, {
            ...existing,
            [code]: { ...existing[code], status: next },
          });
        }
        return updated;
      });

      setSavingReadinessKey(key);
      try {
        await upsertCheck(projectId, activityId, code, next);
      } catch {
        setReadinessByActivity((prev) => {
          const reverted = new Map(prev);
          const existing = reverted.get(activityId);
          if (existing) {
            reverted.set(activityId, {
              ...existing,
              [code]: { ...existing[code], status: previous },
            });
          }
          return reverted;
        });
        setError(`Failed to save ${code} status.`);
      } finally {
        setSavingReadinessKey(null);
      }
    },
    [readinessByActivity, projectId],
  );

  const columns = useMemo(
    () => [
      helper.accessor("activity_type", {
        header: "Activity Type",
        size: 180,
        cell: ({ getValue, row, table }) => (
          <EditableCell
            value={getValue()}
            required
            readOnly={!!row.original.locked_by_revision_id}
            onSave={(v) => table.options.meta?.updateCell(row.original.id, "activity_type", v)}
          />
        ),
      }),
      helper.accessor("start_date", {
        header: "Start",
        size: 130,
        cell: ({ getValue, row, table }) => (
          <EditableCell
            value={getValue()}
            type="date"
            required
            readOnly={!!row.original.locked_by_revision_id}
            onSave={(v) => table.options.meta?.updateCell(row.original.id, "start_date", v)}
          />
        ),
      }),
      helper.accessor("end_date", {
        header: "End",
        size: 130,
        cell: ({ getValue, row, table }) => (
          <EditableCell
            value={getValue()}
            type="date"
            required
            readOnly={!!row.original.locked_by_revision_id}
            onSave={(v) => table.options.meta?.updateCell(row.original.id, "end_date", v)}
          />
        ),
      }),
      helper.accessor("well_name", {
        header: "Well",
        size: 130,
        cell: ({ getValue, row, table }) => (
          <EditableCell
            value={getValue() ?? null}
            readOnly={!!row.original.locked_by_revision_id}
            onSave={(v) => table.options.meta?.updateCell(row.original.id, "well_name", v)}
          />
        ),
      }),
      helper.accessor("rig_name", {
        header: "Rig",
        size: 130,
        cell: ({ getValue, row, table }) => (
          <EditableCell
            value={getValue() ?? null}
            readOnly={!!row.original.locked_by_revision_id}
            onSave={(v) => table.options.meta?.updateCell(row.original.id, "rig_name", v)}
          />
        ),
      }),
      helper.accessor("location", {
        header: "Location",
        size: 100,
        cell: ({ getValue, row, table }) => (
          <EditableCell
            value={getValue() ?? null}
            options={LOCATIONS}
            readOnly={!!row.original.locked_by_revision_id}
            onSave={(v) => table.options.meta?.updateCell(row.original.id, "location", v)}
          />
        ),
      }),
      helper.accessor("plan_type", {
        header: "Plan Type",
        size: 100,
        cell: ({ getValue, row, table }) => (
          <EditableCell
            value={getValue() ?? null}
            options={PLAN_TYPES}
            readOnly={!!row.original.locked_by_revision_id}
            renderValue={(v) => <PlanTypeChip value={v} />}
            onSave={(v) => table.options.meta?.updateCell(row.original.id, "plan_type", v)}
          />
        ),
      }),
      helper.accessor("risk", {
        header: "Risk",
        size: 90,
        cell: ({ getValue, row, table }) => (
          <EditableCell
            value={getValue() ?? null}
            options={RISKS}
            readOnly={!!row.original.locked_by_revision_id}
            renderValue={(v) => <RiskChip value={v} />}
            onSave={(v) => table.options.meta?.updateCell(row.original.id, "risk", v)}
          />
        ),
      }),
      helper.display({
        id: "readiness",
        header: "Readiness",
        size: 220,
        cell: ({ row, table }) => {
          const meta = table.options.meta;
          if (!meta) return null;
          return (
            <ReadinessStrip
              activityId={row.original.id}
              rigName={row.original.rig_name ?? null}
              checks={meta.readinessByActivity.get(row.original.id)}
              savingKey={meta.savingReadinessKey}
              onChange={(code, next) => meta.onReadinessChange(row.original.id, code, next)}
              onEditContract={meta.onEditContract}
            />
          );
        },
      }),
      helper.accessor("comment", {
        header: "Comment",
        size: 200,
        cell: ({ getValue, row, table }) => (
          <EditableCell
            value={getValue() ?? null}
            readOnly={!!row.original.locked_by_revision_id}
            onSave={(v) => table.options.meta?.updateCell(row.original.id, "comment", v)}
          />
        ),
      }),
      helper.display({
        id: "last_edit",
        header: "Last Edit",
        size: 130,
        cell: ({ row }) => {
          const { updated_by_name, updated_at } = row.original;
          if (!updated_by_name) return null;
          return (
            <div className="px-2 text-xs leading-tight text-muted-foreground">
              <div className="truncate font-medium text-foreground/70">{updated_by_name}</div>
              <div>{relativeTime(updated_at)}</div>
            </div>
          );
        },
      }),
      helper.display({
        id: "actions",
        size: 72,
        cell: ({ row, table }) => (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => table.options.meta?.openHistory(row.original.id)}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="View change history"
              data-testid="history-activity"
            >
              <History className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => table.options.meta?.deleteRow(row.original.id)}
              disabled={!!row.original.locked_by_revision_id}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30"
              title={
                row.original.locked_by_revision_id
                  ? "Locked — in pending revision"
                  : "Delete activity"
              }
              data-testid="delete-activity"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ),
      }),
    ],
    [],
  );

  const table = useReactTable({
    data: activities,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    meta: {
      updateCell,
      deleteRow,
      openHistory,
      readinessByActivity,
      onReadinessChange,
      onEditContract: setEditingContractRig,
      savingReadinessKey,
    },
  });

  const historyActivity = historyActivityId
    ? activities.find((a) => a.id === historyActivityId)
    : null;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-card px-3 py-2 shadow-soft-sm">
        <ActivityFormDialog
          projectId={projectId}
          onCreated={(a) => setActivities((prev) => [...prev, a])}
          existingActivityTypes={activities.map((a) => a.activity_type)}
          existingRigNames={activities
            .map((a) => a.rig_name)
            .filter((n): n is string => !!n)}
        />
        <div className="mx-1 h-4 w-px bg-border" />
        <Button
          variant="ghost"
          size="sm"
          onClick={load}
          disabled={loading}
          className="text-muted-foreground"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          <span className="ml-1.5">Refresh</span>
        </Button>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {activities.length} {activities.length === 1 ? "activity" : "activities"}
        </span>
      </div>

      {error && (
        <p
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-border/70 bg-card shadow-soft-sm">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border/70 bg-muted/30">
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    style={{ width: header.getSize() }}
                    className="px-2 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {header.column.getCanSort() ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="inline-flex items-center transition-colors hover:text-foreground"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <SortIcon sorted={header.column.getIsSorted()} />
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="py-16 text-center text-sm text-muted-foreground"
                >
                  {loading ? "Loading…" : "No activities yet. Add one above or import a CSV file."}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row, i) => (
                <React.Fragment key={row.id}>
                  <tr
                    className={cn(
                      "border-b border-border/40 transition-colors hover:bg-accent/30",
                      i % 2 === 1 && "bg-muted/15",
                      historyActivityId === row.original.id && "bg-primary/5",
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-1 py-1.5">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                  {historyActivityId === row.original.id && historyActivity && (
                    <tr>
                      <td colSpan={columns.length} className="p-0">
                        <HistoryPanel
                          projectId={projectId}
                          activityId={historyActivity.id}
                          activityLabel={historyActivity.activity_type}
                          onClose={() => setHistoryActivityId(null)}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Click any cell to edit · Press{" "}
        <kbd className="rounded border border-border bg-muted px-1 text-[10px] font-medium text-foreground/80">
          Enter
        </kbd>{" "}
        or click away to save ·{" "}
        <kbd className="rounded border border-border bg-muted px-1 text-[10px] font-medium text-foreground/80">
          Esc
        </kbd>{" "}
        to cancel
      </p>

      <ContractEditorDialog
        projectId={projectId}
        rigName={editingContractRig}
        open={editingContractRig !== null}
        onOpenChange={(open) => {
          if (!open) setEditingContractRig(null);
        }}
        onSaved={load}
      />
    </div>
  );
}
