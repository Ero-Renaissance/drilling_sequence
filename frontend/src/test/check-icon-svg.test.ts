import { describe, expect, it } from "vitest";
import {
  buildCheckSvg,
  buildContractBadgeSvg,
  buildContractBadgeSvgDataUri,
} from "@/lib/check-icon-svg";

describe("buildContractBadgeSvg", () => {
  it("is a SOLID badge: urgency disc + surface ring + white clock glyph", () => {
    const svg = buildContractBadgeSvg("#dc2626", "#18181b");
    expect(svg).toContain('fill="#dc2626"'); // urgency disc
    expect(svg).toContain('fill="#18181b"'); // surface ring (dark theme bg)
    expect(svg).toContain('stroke="#ffffff"'); // clock hands read on the disc
    // The discs are filled (stroke-only circles would vanish on busy rows).
    expect(svg).not.toMatch(/<circle[^>]*fill="none"/);
  });

  it("encodes to a data URI consumable by ECharts image style", () => {
    const uri = buildContractBadgeSvgDataUri("#dc2626", "#ffffff");
    expect(uri.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    expect(decodeURIComponent(uri)).toContain("#dc2626");
  });
});

describe("buildCheckSvg", () => {
  it("renders the LLI gate as the rotary table, stroke-colored by status", () => {
    const svg = buildCheckSvg("LLI", "Behind");
    expect(svg).toContain('circle cx="12" cy="12" r="9"'); // the table rim
    expect(svg).toContain('rect width="7"'); // the kelly-drive square
    expect(svg).toContain('stroke="#ef4444"'); // Behind → red
  });
});
