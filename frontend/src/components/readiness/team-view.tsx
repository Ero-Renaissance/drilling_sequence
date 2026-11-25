/**
 * The Readiness tab's link parameters that belong to ONE team's page. Every
 * team's page is the same sheet (one row per well), so there is no view to
 * choose; an old link's `?view=` is dropped on the next lens change.
 */

/** The page narrowed to one field project's wells (`?project=`). */
export const PROJECT_PARAM = "project";

/** The Readiness tab's query after a lens change: the new lens; the project
 *  narrowing belongs to one team's page, so it is dropped — as is a `view` left
 *  by a link from before the sheet. Everything else (the years) stays. */
export function lensChangeParams(prev: URLSearchParams, lens: string): URLSearchParams {
  const params = new URLSearchParams(prev);
  params.set("lens", lens);
  params.delete(PROJECT_PARAM);
  params.delete("view");
  return params;
}
