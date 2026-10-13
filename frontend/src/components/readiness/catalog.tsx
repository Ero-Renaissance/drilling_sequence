import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { fetchReadinessCatalog, type CatalogCheck, type CheckStatus } from "@/api/readiness";
import { logger } from "@/lib/logger";

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

const CatalogContext = createContext<readonly CatalogCheck[]>(BUILTIN_PROJECT_GATES);
// Re-fetch the live catalog (after an admin edits it). A no-op outside the provider.
const RefreshContext = createContext<() => void>(() => undefined);

/** Loads the live catalog for the signed-in app (and again on refresh). On
 *  failure the built-in gates stay in place, so the readiness UI still renders. */
export function ReadinessCatalogProvider({ children }: { children: ReactNode }) {
  const [checks, setChecks] = useState<readonly CatalogCheck[]>(BUILTIN_PROJECT_GATES);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let active = true;
    fetchReadinessCatalog()
      .then((catalog) => {
        if (active) setChecks(catalog.checks);
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
      <CatalogContext.Provider value={checks}>{children}</CatalogContext.Provider>
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
