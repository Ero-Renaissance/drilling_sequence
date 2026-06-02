import { describe, it, expect } from "vitest";
import { buildDocRef, formatDocId, normalizeDocId, docIdMatches } from "@/lib/doc-id";

// A real 64-char SHA-256 from the backend integrity digest.
const DIGEST = "ccbe850655506a19cc6163e0923f4b53ebb93c56dc9310859dfa05629b3f71df";

describe("buildDocRef", () => {
  it("slugs the project name under the Renaissance prefix", () => {
    expect(buildDocRef("Q3 Rig Sequence — Print Demo", 1)).toBe(
      "Renaissance/DS/Q3-RIG-SEQUENCE-PRINT-DEMO/REV01",
    );
  });

  it("zero-pads the revision number and falls back when unnamed", () => {
    expect(buildDocRef(null, 5)).toBe("Renaissance/DS/SEQUENCE/REV05");
    expect(buildDocRef("A", 12)).toBe("Renaissance/DS/A/REV12");
  });
});

describe("formatDocId", () => {
  it("upper-cases and groups the first 24 hex in fours", () => {
    expect(formatDocId(DIGEST)).toBe("CCBE 8506 5550 6A19 CC61 63E0");
  });
});

describe("normalizeDocId", () => {
  it("keeps only hex chars, upper-cased", () => {
    expect(normalizeDocId("ccbe 8506-6a19!!")).toBe("CCBE85066A19");
    expect(normalizeDocId("xyz")).toBe("");
  });
});

describe("docIdMatches", () => {
  it("matches a grouped prefix the partner reads out", () => {
    expect(docIdMatches(DIGEST, "CCBE 8506 5550")).toBe(true);
    expect(docIdMatches(DIGEST, "ccbe85065550")).toBe(true);
    // The full printed 24-char ID matches the stored 64-char digest.
    expect(docIdMatches(DIGEST, formatDocId(DIGEST))).toBe(true);
  });

  it("rejects a wrong prefix and anything shorter than 8 hex", () => {
    expect(docIdMatches(DIGEST, "DEAD BEEF 0000")).toBe(false);
    expect(docIdMatches(DIGEST, "CCBE")).toBe(false);
    expect(docIdMatches(DIGEST, "")).toBe(false);
  });
});
