import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ICON_GROUPS, checkIcon } from "@/components/readiness/icon-registry";
import { cn } from "@/lib/utils";

export interface IconGroup {
  label: string;
  keys: string[];
}

/** Groups the keys the server offers (the allow-list authority, `icon_keys`) by
 *  the registry's ICON_GROUPS (spec §8.5), keeping group order. A key this build
 *  doesn't group — a newer server's — goes under "Other" rather than vanishing. */
export function groupIconKeys(keys: readonly string[]): IconGroup[] {
  const offered = new Set(keys);
  const grouped = new Set<string>();
  const groups: IconGroup[] = [];
  for (const group of ICON_GROUPS) {
    const inGroup = group.keys.filter((key) => offered.has(key));
    inGroup.forEach((key) => grouped.add(key));
    if (inGroup.length > 0) groups.push({ label: group.label, keys: inGroup });
  }
  const other = Array.from(offered).filter((key) => !grouped.has(key));
  if (other.length > 0) groups.push({ label: "Other", keys: other });
  return groups;
}

const words = (text: string) => text.toLowerCase().replace(/-/g, " ");

/** Narrows the groups to a search: a group whose name matches keeps every icon;
 *  otherwise only the icons whose key matches ("ship" finds ship and ship-wheel,
 *  "marine" the whole Marine group). An empty search shows everything. */
export function filterIconGroups(groups: readonly IconGroup[], query: string): IconGroup[] {
  const q = words(query.trim());
  if (!q) return [...groups];
  const shown: IconGroup[] = [];
  for (const group of groups) {
    if (words(group.label).includes(q)) {
      shown.push(group);
      continue;
    }
    const keys = group.keys.filter((key) => words(key).includes(q));
    if (keys.length > 0) shown.push({ label: group.label, keys });
  }
  return shown;
}

/** The Admin catalog's icon picker: a search box over grouped icons. Admins pick
 *  an owned key; they never upload SVG. The current choice stays chosen (and is
 *  named beside the search) while a search hides it. */
export function IconPicker({
  keys,
  value,
  onChange,
}: {
  keys: string[];
  value: string;
  onChange: (key: string) => void;
}) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => groupIconKeys(keys), [keys]);
  const shown = useMemo(() => filterIconGroups(groups, query), [groups, query]);
  const SelectedIcon = checkIcon(value);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            aria-label="Search icons"
            placeholder="Search icons"
            value={query}
            maxLength={40}
            onChange={(e) => setQuery(e.target.value)}
            // The picker sits inside the dialog's form: Enter must not submit it.
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
            className="h-8 pl-7 text-xs"
          />
        </div>
        {value && (
          <span
            className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
            data-testid="icon-picker-selected"
          >
            <SelectedIcon className="h-4 w-4 text-primary" aria-hidden />
            {value}
          </span>
        )}
      </div>
      <div role="radiogroup" aria-label="Icon" className="max-h-56 space-y-2 overflow-y-auto pr-1">
        {shown.map((group) => (
          <div key={group.label} role="group" aria-label={group.label}>
            <p
              className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
              aria-hidden
            >
              {group.label}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {group.keys.map((key) => {
                const Icon = checkIcon(key);
                const selected = key === value;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={key}
                    title={key}
                    onClick={() => onChange(key)}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-md border transition-colors",
                      selected
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-accent/50",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {shown.length === 0 && (
          <p className="text-xs text-muted-foreground">No icons match this search.</p>
        )}
      </div>
    </div>
  );
}
