import { useSyncExternalStore } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Minimal owned toast system (no dependency). `toast.error("…")` can be called
 * from anywhere — API callers, components — and a single <Toaster/> mounted at
 * the app root renders the queue. Used to surface action failures that would
 * otherwise revert silently (e.g. editing a plan locked for approval).
 */

export type ToastVariant = "error" | "success" | "info";

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

let items: ToastItem[] = [];
const listeners = new Set<() => void>();
let counter = 0;

function emit() {
  for (const l of listeners) l();
}

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

function push(message: string, variant: ToastVariant): number {
  const id = ++counter;
  items = [...items, { id, message, variant }];
  emit();
  // Auto-dismiss; errors linger a little longer so they aren't missed.
  window.setTimeout(() => dismiss(id), variant === "error" ? 7000 : 4000);
  return id;
}

export const toast = {
  error: (message: string) => push(message, "error"),
  success: (message: string) => push(message, "success"),
  info: (message: string) => push(message, "info"),
  dismiss,
};

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): ToastItem[] {
  return items;
}

const VARIANT: Record<ToastVariant, { Icon: typeof Info; cls: string }> = {
  error: {
    Icon: AlertTriangle,
    cls: "border-red-500/30 bg-red-50 text-red-700 dark:border-red-500/40 dark:bg-red-950/50 dark:text-red-300",
  },
  success: {
    Icon: CheckCircle2,
    cls: "border-emerald-500/30 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-950/50 dark:text-emerald-300",
  },
  info: {
    Icon: Info,
    cls: "border-border bg-card text-foreground",
  },
};

export function Toaster() {
  const toasts = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (toasts.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((t) => {
        const { Icon, cls } = VARIANT[t.variant];
        return (
          <div
            key={t.id}
            role={t.variant === "error" ? "alert" : "status"}
            aria-live={t.variant === "error" ? "assertive" : "polite"}
            className={cn(
              "pointer-events-auto flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm shadow-lg",
              cls,
            )}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1 leading-snug">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
