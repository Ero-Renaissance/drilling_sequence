/**
 * Waits for the LIVE readiness catalog in chart tests. ReadinessCatalogProvider
 * starts from the built-in Project gates and swaps in the fetched catalog later,
 * so a tooltip header ("LOGISTICS READINESS", "READINESS BY TEAM") can render
 * before a team's checks exist — on a slow runner the assertions then read the
 * fallback. Render <CatalogProbe team="logistics" /> inside the provider and
 * await `catalogLoaded()`: the probe and the chart re-render in the same commit.
 */
import { screen } from "@testing-library/react";

import { useCatalogChecks, useReadinessTeams } from "@/components/readiness/catalog";

export function CatalogProbe({ team }: { team: string }) {
  const teams = useReadinessTeams();
  const checks = useCatalogChecks();
  const loaded = teams.some((t) => t.code === team) && checks.some((c) => c.team_code === team);
  return loaded ? <span data-testid="catalog-loaded" hidden /> : null;
}

export function catalogLoaded(): Promise<HTMLElement> {
  return screen.findByTestId("catalog-loaded");
}
