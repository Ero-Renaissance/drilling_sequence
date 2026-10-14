import { useState, type FormEvent } from "react";
import { Archive, ArchiveRestore, Loader2, Pencil, Plus, Tags } from "lucide-react";
import { adminApi, type AdminReadinessCatalog, type AdminTagItem } from "@/api/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

// Mirrors the server's pattern (the API stays the authority).
const TAG_CODE_RE = /^[A-Z][A-Z0-9-]{1,15}$/;

const LIST_TITLE: Record<string, string> = { equipment: "Equipment types" };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Request failed";
}

function TagDialog({
  tagList,
  item,
  nextOrder,
  onClose,
  onSaved,
}: {
  tagList: string;
  /** null → add a new item. */
  item: AdminTagItem | null;
  nextOrder: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [code, setCode] = useState(item?.code ?? "");
  const [label, setLabel] = useState(item?.label ?? "");
  const [category, setCategory] = useState(item?.category ?? "");
  const [order, setOrder] = useState(String(item?.sort_order ?? nextOrder));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const sortOrder = Number(order);
    if (!item && !TAG_CODE_RE.test(code)) {
      setError("Code: 2–16 upper-case letters, digits or hyphens, starting with a letter.");
      return;
    }
    if (!label.trim() || label.trim().length > 64) {
      setError("Label: 1–64 characters.");
      return;
    }
    if (category.trim().length > 64) {
      setError("Category: up to 64 characters.");
      return;
    }
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000) {
      setError("Order: a whole number from 0 to 10000.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = { label: label.trim(), category: category.trim(), sort_order: sortOrder };
      if (item) {
        await adminApi.updateTag(tagList, item.code, body);
        onSaved(`${item.code} updated`);
      } else {
        await adminApi.createTag({ tag_list: tagList, code, ...body });
        onSaved(`${code} added`);
      }
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{item ? `Edit ${item.code}` : `Add to ${LIST_TITLE[tagList] ?? tagList}`}</DialogTitle>
            <DialogDescription>
              {item
                ? "The code can't change."
                : "A code is permanent and never reused — retire an item instead of deleting it."}
            </DialogDescription>
          </DialogHeader>
          {!item && (
            <div className="space-y-1.5">
              <Label htmlFor="tag-code">Code</Label>
              <Input
                id="tag-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. PSV"
                maxLength={16}
                autoComplete="off"
                className="w-36 font-mono"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="tag-label">Label</Label>
            <Input
              id="tag-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Platform Support Vessel"
              maxLength={64}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tag-category">Category</Label>
            <Input
              id="tag-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Vessels"
              maxLength={64}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tag-order">Order</Label>
            <Input
              id="tag-order"
              type="number"
              min={0}
              max={10000}
              value={order}
              onChange={(e) => setOrder(e.target.value)}
              className="w-28"
            />
          </div>
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {item ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Admin: the controlled tag lists (today: the nominated equipment types). */
export function TagListAdmin({
  catalog,
  onChanged,
  defaultOpen = true,
  storageKeyPrefix,
}: {
  catalog: AdminReadinessCatalog;
  onChanged: () => void;
  /** Whether each list starts unfolded (before any remembered choice). */
  defaultOpen?: boolean;
  /** Remember each list's folded/unfolded choice under `${prefix}.${list}`. */
  storageKeyPrefix?: string;
}) {
  const [dialog, setDialog] = useState<{ tagList: string; item: AdminTagItem | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const lists = catalog.tag_lists ?? [];
  if (lists.length === 0) return null;

  async function toggleRetired(item: AdminTagItem) {
    const key = `${item.tag_list}:${item.code}`;
    setBusy(key);
    try {
      if (item.retired_at) await adminApi.restoreTag(item.tag_list, item.code);
      else await adminApi.retireTag(item.tag_list, item.code);
      toast.success(`${item.code} ${item.retired_at ? "restored" : "retired"}`);
      onChanged();
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {lists.map((list) => {
        const items = (catalog.tag_items ?? []).filter((t) => t.tag_list === list);
        const nextOrder = items.length ? Math.max(...items.map((i) => i.sort_order)) + 10 : 10;
        return (
          <CollapsibleSection
            key={list}
            title={LIST_TITLE[list] ?? list}
            icon={Tags}
            count={items.filter((i) => i.retired_at === null).length}
            defaultOpen={defaultOpen}
            storageKey={storageKeyPrefix ? `${storageKeyPrefix}.${list}` : undefined}
            actions={
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDialog({ tagList: list, item: null })}
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </Button>
            }
          >
            <p className="px-4 pt-3 text-xs text-muted-foreground">
              Picked on the Nominated Equipment check for a field project or a well. Retiring keeps
              the type on entries that already have it but stops it being added again.
            </p>
            <div className="overflow-x-auto px-4 pb-3">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-1.5 pr-3 font-semibold">Code</th>
                    <th className="py-1.5 pr-3 font-semibold">Label</th>
                    <th className="py-1.5 pr-3 font-semibold">Category</th>
                    <th className="py-1.5 pr-3 font-semibold">Order</th>
                    <th className="py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const retired = item.retired_at !== null;
                    return (
                      <tr
                        key={item.code}
                        className={cn("border-t border-border/40", retired && "opacity-60")}
                      >
                        <td className="py-1.5 pr-3">
                          <code className="text-xs font-semibold">{item.code}</code>
                          {retired && (
                            <Badge variant="outline" className="ml-2 text-[10px]">
                              Retired
                            </Badge>
                          )}
                        </td>
                        <td className="py-1.5 pr-3">{item.label}</td>
                        <td className="py-1.5 pr-3 text-xs text-muted-foreground">{item.category}</td>
                        <td className="py-1.5 pr-3 text-xs tabular-nums">{item.sort_order}</td>
                        <td className="py-1.5">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`Edit ${item.code}`}
                              onClick={() => setDialog({ tagList: list, item })}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy === `${item.tag_list}:${item.code}`}
                              onClick={() => toggleRetired(item)}
                            >
                              {retired ? (
                                <ArchiveRestore className="h-3.5 w-3.5" />
                              ) : (
                                <Archive className="h-3.5 w-3.5" />
                              )}
                              {retired ? "Restore" : "Retire"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {dialog?.tagList === list && (
              <TagDialog
                tagList={list}
                item={dialog.item}
                nextOrder={nextOrder}
                onClose={() => setDialog(null)}
                onSaved={(message) => {
                  setDialog(null);
                  toast.success(message);
                  onChanged();
                }}
              />
            )}
          </CollapsibleSection>
        );
      })}
    </>
  );
}
