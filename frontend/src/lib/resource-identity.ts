/**
 * Resource identity helpers — the frontend mirror of the backend registry's
 * identity rules (app/models/resource_registry.py).
 *
 * The registry treats "10k rig 3" and "10K Rig 3" as ONE physical unit (names
 * are trimmed and case-folded before comparison), so every frontend map or
 * comparison keyed by unit must collapse the same variants — otherwise a
 * casing drift between an activity and its contract silently drops the
 * expiry marker, the contract editor shows "No contract" for a unit that has
 * one, and the conflict banner misses a real double-booking.
 */

/** Canonical lookup key for a resource name — trimmed, case-folded. */
export function normalizeResourceName(name: string): string {
  return name.trim().toLowerCase();
}

/** Lookup key for a rig's contract lane — rig identity is (terrain, name);
 *  terrain "" = unassigned/legacy (and HWU-style mobile lanes). */
export function rigLaneKey(terrain: string | null | undefined, name: string): string {
  return `${(terrain ?? "").trim()}|${normalizeResourceName(name)}`;
}
