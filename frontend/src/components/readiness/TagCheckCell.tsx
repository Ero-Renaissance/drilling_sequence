import { useMemo, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import type { CatalogCheck, CheckStatus, TagItem } from "@/api/readiness";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useTagItems } from "./catalog";
import { STATUS_DOT, STATUS_ICON_COLOR, STATUS_LABEL, statusesOf } from "./check-meta";
import { checkIcon } from "./icon-registry";

/**
 * A grid cell for a check that carries a tag list — Nominated Equipment: the
 * status icon plus the effective tags (field project's + the well's own) under
 * it. Clicking opens a dialog to set the status and the entry's own tags.
 */
export function TagCheckCell({
  check,
  targetLabel,
  status,
  tags,
  inheritedTags,
  inherited,
  disabled,
  onSave,
  onReset,
}: {
  check: CatalogCheck;
  /** e.g. "W-1 · Bonga Phase 3" — names the target in the dialog. */
  targetLabel: string;
  status: CheckStatus;
  tags: string[];
  inheritedTags: string[];
  /** The status shown is the field project's (no own entry for this well). */
  inherited: boolean;
  disabled: boolean;
  onSave: (status: CheckStatus, tags: string[]) => Promise<void>;
  /** "Reset to project" — offered when this well has its own value. */
  onReset?: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const Icon = checkIcon(check.icon_key);
  const effective = [...new Set([...inheritedTags, ...tags])];
  const title = `${check.label}: ${STATUS_LABEL[status]}${inherited ? " (from field project)" : ""}${
    effective.length ? ` — ${effective.join(", ")}` : ""
  }`;
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        title={title}
        aria-label={`${title}. Click to change.`}
        onClick={() => setOpen(true)}
        className={cn(
          "group inline-flex flex-col items-center gap-0.5 rounded-md px-1 py-0.5 transition-colors",
          "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <Icon
          className={cn("h-[18px] w-[18px]", STATUS_ICON_COLOR[status], inherited && "opacity-50")}
          strokeWidth={2}
        />
        {effective.length > 0 && (
          <span className="max-w-[5.5rem] truncate text-[9px] font-medium leading-none text-muted-foreground">
            {effective.join(" · ")}
          </span>
        )}
      </button>
      {open && (
        <TagStatusDialog
          check={check}
          targetLabel={targetLabel}
          status={status}
          tags={tags}
          inheritedTags={inheritedTags}
          onClose={() => setOpen(false)}
          onSave={async (s, t) => {
            await onSave(s, t);
            setOpen(false);
          }}
          onReset={
            onReset
              ? async () => {
                  await onReset();
                  setOpen(false);
                }
              : undefined
          }
        />
      )}
    </>
  );
}

function TagStatusDialog({
  check,
  targetLabel,
  status,
  tags,
  inheritedTags,
  onClose,
  onSave,
  onReset,
}: {
  check: CatalogCheck;
  targetLabel: string;
  status: CheckStatus;
  tags: string[];
  inheritedTags: string[];
  onClose: () => void;
  onSave: (status: CheckStatus, tags: string[]) => Promise<void>;
  onReset?: () => Promise<void>;
}) {
  const items = useTagItems(check.tag_list);
  const [nextStatus, setNextStatus] = useState<CheckStatus>(status);
  const [selected, setSelected] = useState<string[]>(tags);
  const [saving, setSaving] = useState(false);

  // Group active items by category; a tag this entry already carries that has
  // since been retired stays listed (so it can be removed) but can't be re-added.
  const groups = useMemo(() => {
    const byCategory = new Map<string, TagItem[]>();
    for (const item of items) {
      const key = item.category || "Other";
      byCategory.set(key, [...(byCategory.get(key) ?? []), item]);
    }
    return [...byCategory.entries()];
  }, [items]);
  const retiredHeld = tags.filter((t) => !items.some((i) => i.code === t));
  const label = (code: string) => items.find((i) => i.code === code)?.label ?? code;

  const toggle = (code: string, on: boolean) =>
    setSelected((prev) => (on ? [...prev, code] : prev.filter((c) => c !== code)));

  async function run(action: () => Promise<void>) {
    setSaving(true);
    try {
      await action();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{check.label}</DialogTitle>
          <DialogDescription>{targetLabel}</DialogDescription>
        </DialogHeader>

        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Status</legend>
          <div className="flex flex-wrap gap-2">
            {statusesOf(check.status_set).map((s) => (
              <label
                key={s}
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm",
                  nextStatus === s ? "border-primary bg-primary/10" : "border-border",
                )}
              >
                <input
                  type="radio"
                  name="tag-check-status"
                  className="sr-only"
                  checked={nextStatus === s}
                  onChange={() => setNextStatus(s)}
                />
                <span className={cn("h-2.5 w-2.5 rounded-full", STATUS_DOT[s])} />
                {STATUS_LABEL[s]}
              </label>
            ))}
          </div>
        </fieldset>

        {inheritedTags.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-sm font-medium">From field project</p>
            <div className="flex flex-wrap gap-1.5">
              {inheritedTags.map((t) => (
                <span
                  key={t}
                  title={label(t)}
                  className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium">
            {inheritedTags.length > 0 ? "Also nominated for this well" : "Nominated"}
          </p>
          {groups.map(([category, groupItems]) => (
            <fieldset key={category} className="space-y-1">
              <legend className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {category}
              </legend>
              <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                {groupItems.map((item) => (
                  <label key={item.code} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={selected.includes(item.code)}
                      disabled={inheritedTags.includes(item.code)}
                      onChange={(e) => toggle(item.code, e.target.checked)}
                    />
                    <span className="font-mono text-xs font-semibold">{item.code}</span>
                    <span className="truncate text-muted-foreground">{item.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          {retiredHeld.map((code) => (
            <label key={code} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={selected.includes(code)}
                onChange={(e) => toggle(code, e.target.checked)}
                disabled={!selected.includes(code)}
              />
              <span className="font-mono text-xs font-semibold line-through">{code}</span>
              <span className="text-muted-foreground">(retired)</span>
            </label>
          ))}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {onReset ? (
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => run(onReset)}
              title="Drop this well's own value so it follows its field project again"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset to project
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={saving}
              onClick={() => run(() => onSave(nextStatus, selected))}
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
