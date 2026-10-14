import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  fetchReadinessCatalog,
  type CatalogCheck,
  type CatalogTeam,
  type CheckStatus,
  type TagItem,
} from "@/api/readiness";
import { logger } from "@/lib/logger";
import { useAuthStore } from "@/store/auth";

/** The team that owns the field-project gates (the "Project gates" lens). */
export const PROJECTS_TEAM = "projects";

function gate(code: string, label: string, icon_key: string, sort_order: number): CatalogCheck {
  return {
    code,
    label,
    team_code: PROJECTS_TEAM,
    applies_project: true,
    applies_well: false,
    status_set: "standard",
    icon_key,
    locks_with_plan: true,
    sort_order,
  };
}

/**
 * The original seven field-project gates — mirrors `BUILTIN_CHECKS` in
 * backend/app/models/readiness.py (a test keeps them identical). Used until the
 * live catalog loads, if it can't load, and outside the app shell (tests, dev
 * fixtures). Revisions bring their own frozen catalog from the API.
 */
export const BUILTIN_PROJECT_GATES: readonly CatalogCheck[] = [
  gate("FDP", "Field Development Plan", "land-plot", 10),
  gate("LLI", "Long Lead Items", "rotary-table", 20),
  gate("LOC", "Location", "map-pin", 30),
  gate("FE", "Wells Front End", "drafting-compass", 40),
  gate("FID", "Final Inv. Decision", "gavel", 50),
  gate("EIA", "Env. Assessment", "leaf", 60),
  gate("BUD", "Budget", "banknote", 70),
];

/** The built-in team (the field-project gates), mirroring `BUILTIN_TEAMS`. */
export const BUILTIN_TEAMS: readonly CatalogTeam[] = [
  { code: PROJECTS_TEAM, name: "Projects", editor_source: "planner", icon_key: "land-plot", sort_order: 0 },
];

const CatalogContext = createContext<readonly CatalogCheck[]>(BUILTIN_PROJECT_GATES);
const TeamsContext = createContext<readonly CatalogTeam[]>(BUILTIN_TEAMS);
const TagItemsContext = createContext<readonly TagItem[]>([]);
// Re-fetch the live catalog (after an admin edits it). A no-op outside the provider.
const RefreshContext = createContext<() => void>(() => undefined);

/** Loads the live catalog for the signed-in app (and again on refresh). On
 *  failure the built-in gates stay in place, so the readiness UI still renders. */
export function ReadinessCatalogProvider({ children }: { children: ReactNode }) {
  const [checks, setChecks] = useState<readonly CatalogCheck[]>(BUILTIN_PROJECT_GATES);
  const [teams, setTeams] = useState<readonly CatalogTeam[]>(BUILTIN_TEAMS);
  const [tagItems, setTagItems] = useState<readonly TagItem[]>([]);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let active = true;
    fetchReadinessCatalog()
      .then((catalog) => {
        if (!active) return;
        setChecks(catalog.checks);
        setTeams(catalog.teams);
        setTagItems(catalog.tag_items ?? []);
      })
      .catch((err: unknown) => {
        logger.warn("Readiness catalog unavailable; using the built-in gates", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      active = false;
    };
  }, [version]);
  return (
    <RefreshContext.Provider value={refresh}>
      <TeamsContext.Provider value={teams}>
        <TagItemsContext.Provider value={tagItems}>
          <CatalogContext.Provider value={checks}>{children}</CatalogContext.Provider>
        </TagItemsContext.Provider>
      </TeamsContext.Provider>
    </RefreshContext.Provider>
  );
}

/** Call after changing the catalog so every view picks up the new definitions. */
export function useRefreshReadinessCatalog(): () => void {
  return useContext(RefreshContext);
}

/** Pins a subtree to a fixed catalog — a revision renders with the definitions
 *  frozen at its submit, whatever the live catalog says now. */
export function FrozenCatalogProvider({
  checks,
  children,
}: {
  checks: readonly CatalogCheck[] | undefined;
  children: ReactNode;
}) {
  const value = checks && checks.length > 0 ? checks : BUILTIN_PROJECT_GATES;
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

/** Pure filter behind `useProjectGates` — for code outside React's tree. */
export function projectGatesOf(checks: readonly CatalogCheck[]): CatalogCheck[] {
  return checks
    .filter((c) => c.team_code === PROJECTS_TEAM && c.applies_project)
    .sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code));
}

/** The field-project gates in display order — the columns of the readiness grid,
 *  the chart's icon strip and the print legend. */
export function useProjectGates(): CatalogCheck[] {
  const checks = useContext(CatalogContext);
  return useMemo(() => projectGatesOf(checks), [checks]);
}

/** A single check's definition by code; falls back to the built-in gates, then to
 *  a bare definition labelled by its code (never throws on an unknown code). */
export function useCheckDef(code: string): CatalogCheck {
  const checks = useContext(CatalogContext);
  return useMemo(() => checkDefOf(checks, code), [checks, code]);
}

export function checkDefOf(checks: readonly CatalogCheck[], code: string): CatalogCheck {
  return (
    checks.find((c) => c.code === code) ??
    BUILTIN_PROJECT_GATES.find((c) => c.code === code) ??
    gate(code, code, "", 0)
  );
}

/** A gate's status on a row, or the standard default when the row has no value
 *  for it (e.g. the catalog gained a check the row predates). */
export function statusOf(
  checks: Partial<Record<string, { status: CheckStatus }>> | null | undefined,
  code: string,
): CheckStatus {
  return checks?.[code]?.status ?? "On Track";
}

// ── Lenses (Phase 3): one team's checks at a time keeps each view uncluttered ──

/** A lens is a team code, or "none" (a print with no readiness icons). */
export type Lens = string;
export const NO_LENS: Lens = "none";

/** Active teams in lens order. */
export function useReadinessTeams(): readonly CatalogTeam[] {
  return useContext(TeamsContext);
}

/** What a lens is called: the built-in team reads "Project gates". */
export function lensLabel(team: Pick<CatalogTeam, "code" | "name">): string {
  return team.code === PROJECTS_TEAM ? "Project gates" : team.name;
}

/** Pure filter behind `useLensChecks`. */
export function lensChecksOf(checks: readonly CatalogCheck[], lens: Lens): CatalogCheck[] {
  if (lens === NO_LENS) return [];
  if (lens === PROJECTS_TEAM) return projectGatesOf(checks);
  return checks
    .filter((c) => c.team_code === lens)
    .sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code));
}

const LensContext = createContext<Lens>(PROJECTS_TEAM);

/** Renders a subtree (chart, legend, print) through one team's lens. */
export function ReadinessLensProvider({ lens, children }: { lens: Lens; children: ReactNode }) {
  return <LensContext.Provider value={lens}>{children}</LensContext.Provider>;
}

export function useLens(): Lens {
  return useContext(LensContext);
}

/** The checks the current lens shows (chart strip, legend, print icons). */
export function useLensChecks(): CatalogCheck[] {
  const checks = useContext(CatalogContext);
  const lens = useContext(LensContext);
  return useMemo(() => lensChecksOf(checks, lens), [checks, lens]);
}

const LENS_KEY = "ds.readiness-lens";

/** The lens a user starts on: their own team (first grant, in team order), else
 *  the project gates. A convenience, not a restriction — reads are org-wide. */
export function defaultLens(
  teams: readonly CatalogTeam[],
  userTeams: readonly string[] | undefined,
): Lens {
  const own = teams.find((t) => t.editor_source === "team_grant" && userTeams?.includes(t.code));
  return own?.code ?? PROJECTS_TEAM;
}

/** The current lens + setter, remembered per user (localStorage) and falling
 *  back to `defaultLens` when the saved team no longer exists. */
export function useReadinessLens(): [Lens, (lens: Lens) => void] {
  const teams = useReadinessTeams();
  const userTeams = useAuthStore((s) => s.user?.teams);
  const [saved, setSaved] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(LENS_KEY);
    } catch {
      return null;
    }
  });
  const lens = saved && teams.some((t) => t.code === saved) ? saved : defaultLens(teams, userTeams);
  const setLens = useCallback((next: Lens) => {
    setSaved(next);
    try {
      window.localStorage.setItem(LENS_KEY, next);
    } catch {
      // storage unavailable — the in-session choice still applies
    }
  }, []);
  return [lens, setLens];
}

/** Active items of one tag list (e.g. the equipment types), in display order. */
export function useTagItems(tagList: string | undefined): TagItem[] {
  const items = useContext(TagItemsContext);
  return useMemo(
    () =>
      tagList
        ? items
            .filter((t) => t.tag_list === tagList)
            .sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code))
        : [],
    [items, tagList],
  );
}
