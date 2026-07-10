import { describe, expect, it } from "vitest";
import { classifyContract, URGENCY_VISUAL } from "@/lib/contract-urgency";

/** Tiers are keyed to the QUARTERLY approval cadence: soon = two approval
 *  cycles left (3–6 months), critical = less than one cycle (< 3 months) —
 *  the current sitting is the last formal chance to act before lapse. */
describe("classifyContract — cadence-keyed thresholds", () => {
  // Everything anchored to UTC midnight: contract_end strings parse as UTC, so
  // a UTC `now` keeps the day arithmetic exact in every timezone the suite runs.
  const now = new Date("2026-01-01T00:00:00Z");
  const endIn = (days: number) => ({
    contract_end: new Date(Date.UTC(2026, 0, 1 + days)).toISOString().slice(0, 10),
  });

  it("expired: end date in the past", () => {
    expect(classifyContract(endIn(-1), now)).toBe("expired");
  });

  it("critical: anything under one approval cycle (< 90 days)", () => {
    expect(classifyContract(endIn(0), now)).toBe("critical");
    expect(classifyContract(endIn(45), now)).toBe("critical"); // was 'soon' pre-change
    expect(classifyContract(endIn(89), now)).toBe("critical");
  });

  it("soon: two approval cycles out (90–179 days)", () => {
    expect(classifyContract(endIn(90), now)).toBe("soon");
    expect(classifyContract(endIn(120), now)).toBe("soon"); // was 'healthy' pre-change
    expect(classifyContract(endIn(179), now)).toBe("soon");
  });

  it("healthy: more than six months out", () => {
    expect(classifyContract(endIn(180), now)).toBe("healthy");
    expect(classifyContract(endIn(400), now)).toBe("healthy");
  });

  it("a contract IS its end date — no date means no contract", () => {
    // Legacy date-less rows (pre-024) classify the same as no record at all.
    expect(classifyContract({ contract_end: null }, now)).toBeNull();
    expect(classifyContract(null, now)).toBeNull();
    expect(classifyContract(undefined, now)).toBeNull();
  });

  it("labels speak the cadence, not stale day counts", () => {
    expect(URGENCY_VISUAL.critical.label).toBe("Critical (< 3 months)");
    expect(URGENCY_VISUAL.soon.label).toBe("Expiring soon");
  });
});
