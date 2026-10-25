import { useCallback, useState } from "react";
import { FolderKanban, Drill } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";

/**
 * A team grid shows ONE view at a time (spec §8.8): its field projects
 * ("Projects", the default — where a team nominates and sets what wells
 * inherit) or its wells. Everything on the page follows the view: the table,
 * the count, the summary, the banners, the window's label and the search.
 *
 * - `?view=projects|wells` — a deep link wins: the Overview's team cards open
 *   the Projects view (they count field projects), the All grid's Open the
 *   Wells view (its rows are wells);
 * - else the browser's remembered choice for this team;
 * - else Projects. A team with checks at one level only has that one view.
 */
export type TeamView = "projects" | "wells";

export const TEAM_VIEW_KEY = "ds.readiness-team-view";
/** The Wells view, narrowed to one field project's wells ("Wells →" on a project row). */
export const PROJECT_PARAM = "project";

function asView(value: unknown): TeamView | null {
  return value === "projects" || value === "wells" ? value : null;
}

/** The stored `{ [team code]: view }` — own keys only, as team codes are any
 *  `^[a-z][a-z0-9-]{1,31}$` ("constructor" included). Storage can be
 *  unavailable or hold anything: every read is checked, every access wrapped. */
function readAll(): Map<string, TeamView> {
  const out = new Map<string, TeamView>();
  try {
    const raw = window.localStorage.getItem(TEAM_VIEW_KEY);
    if (!raw) return out;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return out;
    for (const [team, view] of Object.entries(parsed as Record<string, unknown>)) {
      const v = asView(view);
      if (v) out.set(team, v);
    }
  } catch {
    // unreadable — the default applies
  }
  return out;
}

function remember(team: string, view: TeamView): void {
  try {
    const all = readAll();
    all.set(team, view);
    window.localStorage.setItem(TEAM_VIEW_KEY, JSON.stringify(Object.fromEntries(all)));
  } catch {
    // storage unavailable — the link still carries the choice this session
  }
}

/** The stored view for a team, if any (a Map: own entries only). */
export function storedTeamView(team: string): TeamView | null {
  return readAll().get(team) ?? null;
}

/** Which view a team grid shows, and a setter that records it in the link and
 *  remembers it for this team. `has` says which views the team's checks allow. */
export function useTeamView(
  teamCode: string,
  has: { projects: boolean; wells: boolean },
): [TeamView, (next: TeamView) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const [stored] = useState(() => storedTeamView(teamCode));
  const wanted = asView(searchParams.get("view")) ?? stored ?? "projects";
  const view: TeamView = !has.projects ? "wells" : !has.wells ? "projects" : wanted;
  const setView = useCallback(
    (next: TeamView) => {
      remember(teamCode, next);
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.set("view", next);
          // The project narrowing belongs to one visit of the Wells view.
          params.delete(PROJECT_PARAM);
          return params;
        },
        { replace: true },
      );
    },
    [teamCode, setSearchParams],
  );
  return [view, setView];
}

/** The Readiness tab's query after a lens change: the new lens; a team grid's
 *  view and project narrowing belong to one team, so they're dropped — each team
 *  opens on its own remembered view — unless the caller asks for a view (the
 *  All grid's Open: its rows are wells). Everything else (the window) stays. */
export function lensChangeParams(prev: URLSearchParams, lens: string, view?: TeamView): URLSearchParams {
  const params = new URLSearchParams(prev);
  params.set("lens", lens);
  params.delete(PROJECT_PARAM);
  if (view) params.set("view", view);
  else params.delete("view");
  return params;
}

/** The Projects | Wells switch, styled like the lens picker. */
export function TeamViewSwitch({
  value,
  onChange,
}: {
  value: TeamView;
  onChange: (view: TeamView) => void;
}) {
  const options: { view: TeamView; label: string; Icon: typeof Drill }[] = [
    { view: "projects", label: "Projects", Icon: FolderKanban },
    { view: "wells", label: "Wells", Icon: Drill },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Show"
      className="inline-flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5"
    >
      {options.map(({ view, label, Icon }) => (
        <button
          key={view}
          type="button"
          role="radio"
          aria-checked={value === view}
          onClick={() => onChange(view)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
            value === view
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
