import { useCallback, useState } from "react";

/**
 * Which check categories a team grid shows unfolded (phase 7, spec §8.8): every
 * category starts folded to one column, a click on its header unfolds it, and
 * the choice is remembered per browser — a viewing habit, like the lens and the
 * print years. Stored as `{ [team code]: category names }` under one key; the
 * store can be unavailable or hold anything, so every read is checked and every
 * access is wrapped (the grid works the same without it).
 */
export const CATEGORY_FOLDS_KEY = "ds.readiness-categories-open";

// Bounds on what a stored value may hold, so a tampered or stale entry can't
// bloat the state: a category is at most 64 characters (the catalog's limit).
const MAX_NAMES = 64;
const MAX_NAME_LENGTH = 64;

// A Map, never a plain object: a team code is any `^[a-z][a-z0-9-]{1,31}$`, so
// "constructor" or "valueOf" would read an inherited Object member (and a stored
// "__proto__" key would re-prototype the object) instead of the team's entry.
type Stored = Map<string, string[]>;

function readAll(): Stored {
  try {
    const raw = window.localStorage.getItem(CATEGORY_FOLDS_KEY);
    if (!raw) return new Map();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
    const out: Stored = new Map();
    for (const [team, names] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(names)) continue;
      out.set(
        team,
        names
          .filter((n): n is string => typeof n === "string" && n.length > 0 && n.length <= MAX_NAME_LENGTH)
          .slice(0, MAX_NAMES),
      );
    }
    return out;
  } catch {
    return new Map();
  }
}

/** The categories a team has unfolded, as stored (empty when none or unreadable). */
function savedOpen(team: string): Set<string> {
  return new Set(readAll().get(team) ?? []);
}

function writeTeam(team: string, names: readonly string[]): void {
  try {
    const all = readAll();
    if (names.length > 0) all.set(team, [...names].slice(0, MAX_NAMES));
    else all.delete(team);
    // Object.fromEntries defines own properties, so even a "__proto__" key stays data.
    window.localStorage.setItem(CATEGORY_FOLDS_KEY, JSON.stringify(Object.fromEntries(all)));
  } catch {
    // storage unavailable — the in-session choice still applies
  }
}

/** The categories a team's grid shows unfolded, and a toggle for one. */
export function useOpenCategories(teamCode: string): [ReadonlySet<string>, (name: string) => void] {
  const [state, setState] = useState<{ team: string; open: ReadonlySet<string> }>(() => ({
    team: teamCode,
    open: savedOpen(teamCode),
  }));
  // Another team's grid (the lens switched): read its remembered choice.
  const open =
    state.team === teamCode ? state.open : savedOpen(teamCode);
  const toggle = useCallback(
    (name: string) => {
      setState((prev) => {
        const current =
          prev.team === teamCode ? prev.open : savedOpen(teamCode);
        const next = new Set(current);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        writeTeam(teamCode, [...next]);
        return { team: teamCode, open: next };
      });
    },
    [teamCode],
  );
  return [open, toggle];
}
