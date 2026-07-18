import { useState } from "react";
import { Plus } from "lucide-react";

import { createResource } from "@/api/resources";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";

const TERRAINS = ["LAND", "SWAMP", "OFFSHORE"] as const;

/**
 * Register a unit directly from the Fleet page — procurement often runs ahead
 * of scheduling. A unit added here appears in the registry, counts and the
 * procurement watchlist immediately, and joins the sequence chart once an
 * activity is scheduled on it.
 */
export function AddResourceDialog({
  projectId,
  disabled,
  onCreated,
}: {
  projectId: string;
  /** Plan locked — the trigger is disabled; the write would 423 anyway. */
  disabled?: boolean;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"rig" | "hwu">("rig");
  const [name, setName] = useState("");
  const [terrain, setTerrain] = useState<(typeof TERRAINS)[number]>("LAND");
  const [planned, setPlanned] = useState(false);
  const [saving, setSaving] = useState(false);
  const selectClass =
    "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

  async function submit() {
    if (!name.trim()) {
      toast.error("Give the unit a name.");
      return;
    }
    setSaving(true);
    try {
      await createResource(projectId, {
        kind,
        name: name.trim(),
        terrain: kind === "rig" ? terrain : undefined,
        is_placeholder: planned,
      });
      toast.success(`${kind === "rig" ? "Rig" : "HWU"} registered.`);
      setOpen(false);
      setName("");
      setPlanned(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to register the unit");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={disabled} data-testid="add-resource">
          <Plus className="h-4 w-4" />
          <span className="ml-1">Add rig / HWU</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Register a unit</DialogTitle>
          <DialogDescription>
            For fleet known ahead of scheduling — a unit under tender or newly awarded. It joins
            the sequence chart once an activity is scheduled on it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              Kind
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as "rig" | "hwu")}
                className={selectClass}
              >
                <option value="rig">Rig</option>
                <option value="hwu">HWU</option>
              </select>
            </label>
            {kind === "rig" ? (
              <label className="space-y-1 text-xs font-medium text-muted-foreground">
                Terrain
                <select
                  value={terrain}
                  onChange={(e) => setTerrain(e.target.value as (typeof TERRAINS)[number])}
                  className={selectClass}
                >
                  {TERRAINS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="self-end pb-2 text-xs text-muted-foreground">
                HWUs are mobile — no terrain.
              </p>
            )}
          </div>
          <label className="block space-y-1 text-xs font-medium text-muted-foreground">
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={256}
              placeholder={kind === "rig" ? "e.g. 10K Rig 3" : "e.g. HWU Unit 2"}
              className={selectClass}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={planned}
              onChange={(e) => setPlanned(e.target.checked)}
              className="h-4 w-4"
            />
            Planned slot (not yet awarded — raises procurement alerts)
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Registering…" : "Register"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
