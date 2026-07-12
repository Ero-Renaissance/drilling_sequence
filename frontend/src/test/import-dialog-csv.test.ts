import { describe, it, expect } from "vitest";
import { csvCell } from "@/components/chart/ImportDialog";

describe("csvCell", () => {
  it("passes plain text through and quotes per RFC 4180", () => {
    expect(csvCell("Well-1")).toBe("Well-1");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("neutralizes leading formula characters (CSV injection)", () => {
    // A well name like =cmd|... from an imported sheet must re-export inert.
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("+1234")).toBe("'+1234");
    expect(csvCell("-HYPERLINK(...)")).toBe("'-HYPERLINK(...)");
    expect(csvCell("@cmd")).toBe("'@cmd");
    // Formula prefix composes with RFC quoting when the value also has commas.
    expect(csvCell("=a,b")).toBe("\"'=a,b\"");
  });
});
